package plugin

import (
	"fmt"
	"math"
	"math/big"
	"regexp"
	"strconv"
	"strings"
)

// Query types understood by the backend.
const (
	queryTypeSearch  = "search"
	queryTypeTraceID = "traceId"
)

// maxSpansPerTrace caps how many spans a single trace drill-down fetches.
// OpenObserve's generic _search needs an explicit size; a trace rarely exceeds
// this and it bounds memory/response size.
const maxSpansPerTrace = 5000

// defaultSearchLimit is the number of traces returned by a search when the
// query does not specify a limit.
const defaultSearchLimit = 50

// maxSearchLimit is the largest page a trace search may request. The
// datasource query path owns enforcing this contract when it chooses a limit.
const maxSearchLimit = 500

// tagFilter is a structured attribute filter from the search builder.
type tagFilter struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

// queryModel is the JSON sent from the frontend query editor. It must stay in
// sync with the O2Query interface in src/types.ts.
type queryModel struct {
	QueryType string `json:"queryType"`

	// Trace-by-id mode.
	TraceID string `json:"traceId"`

	// Search builder fields.
	Service     string      `json:"service"`     // service_name = '...'
	SpanName    string      `json:"spanName"`    // operation_name = '...'
	StatusError bool        `json:"statusError"` // span_status = 'ERROR'
	MinDuration string      `json:"minDuration"` // e.g. "1.5ms", "100us"
	MaxDuration string      `json:"maxDuration"`
	Tags        []tagFilter `json:"tags"`
	Limit       int         `json:"limit"`

	// Stream override; falls back to the datasource default stream.
	Stream string `json:"stream"`

	// NodeGraph, when true (and the datasource option is enabled), emits
	// node-graph frames for trace-by-id queries.
	NodeGraph bool `json:"nodeGraph"`
}

// hexID matches the OpenTelemetry trace-id invariant: exactly 32 hexadecimal
// characters, with no separators.
var hexID = regexp.MustCompile(`^[0-9a-fA-F]{32}$`)

// validateTraceID guards against SQL injection before a trace id is
// interpolated into SQL. OpenObserve trace ids are 32 hex chars.
func validateTraceID(id string) (string, error) {
	id = strings.TrimSpace(id)
	if id == "" {
		return "", fmt.Errorf("trace id is empty")
	}
	if !hexID.MatchString(id) {
		return "", fmt.Errorf("invalid trace id %q: must be hexadecimal", id)
	}
	if strings.Trim(id, "0") == "" {
		return "", fmt.Errorf("invalid trace id %q: must contain a non-zero hexadecimal byte", id)
	}
	return id, nil
}

// sqlQuote single-quotes a string literal, escaping embedded quotes, for safe
// interpolation into a WHERE clause.
func sqlQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", "''") + "'"
}

// sqlIdent quotes a column identifier, stripping anything that is not a safe
// identifier character. OpenObserve flattens attribute names to
// [a-z0-9_]+, so this is conservative but sufficient.
var identUnsafe = regexp.MustCompile(`[^a-zA-Z0-9_]`)

func sqlIdent(s string) string {
	return identUnsafe.ReplaceAllString(s, "")
}

// buildTraceDetailSQL returns the SQL that fetches every span of one trace.
func buildTraceDetailSQL(stream, traceID string) string {
	return fmt.Sprintf(
		`SELECT * FROM %s WHERE trace_id = %s ORDER BY start_time`,
		quoteStream(stream), sqlQuote(traceID),
	)
}

// buildSearchSQL builds the GROUP BY trace_id aggregation that powers the
// search results table. Span predicates are conditional aggregate predicates:
// they select traces while retaining every span in each selected trace. The
// predicates are combined inside one CASE expression so all filters match the
// same span. Duration bounds are trace-level HAVING predicates.
func buildSearchSQL(stream string, filters, having []string, limit int) string {
	havingClause := ""
	clauses := make([]string, 0, len(having)+1)
	if len(filters) > 0 {
		clauses = append(clauses, "sum(CASE WHEN "+strings.Join(filters, " AND ")+" THEN 1 ELSE 0 END) > 0")
	}
	clauses = append(clauses, having...)
	if len(clauses) > 0 {
		havingClause = " HAVING " + strings.Join(clauses, " AND ")
	}
	_ = limit // size is passed via the request body, not the SQL
	return fmt.Sprintf(`SELECT trace_id, `+
		`min(_timestamp) AS zo_sql_timestamp, `+
		`min(start_time) AS trace_start_time, `+
		`max(end_time) AS trace_end_time, `+
		`count(*) AS span_count, `+
		`sum(CASE WHEN span_status = 'ERROR' THEN 1 ELSE 0 END) AS error_count, `+
		`max(end_time) - min(start_time) AS trace_duration, `+
		`count(DISTINCT service_name) AS service_count, `+
		`first_value(service_name ORDER BY start_time ASC) AS first_service_name, `+
		`first_value(operation_name ORDER BY start_time ASC) AS first_operation_name `+
		`FROM %s GROUP BY trace_id%s ORDER BY zo_sql_timestamp DESC`,
		quoteStream(stream), havingClause)
}

// quoteStream wraps the stream name in double quotes, stripping unsafe chars.
func quoteStream(stream string) string {
	return `"` + sqlIdent(stream) + `"`
}

// buildSearchFilters translates the structured query builder into SQL span
// predicates. They are consumed by buildSearchSQL inside a conditional
// aggregate HAVING expression, never as a row-level WHERE clause. All string
// values are quoted/escaped. Duration bounds are handled separately in
// buildSearchHaving.
func buildSearchFilters(q *queryModel) []string {
	var filters []string

	if s := strings.TrimSpace(q.Service); s != "" {
		filters = append(filters, "service_name = "+sqlQuote(s))
	}
	if s := strings.TrimSpace(q.SpanName); s != "" {
		filters = append(filters, "operation_name = "+sqlQuote(s))
	}
	if q.StatusError {
		filters = append(filters, "span_status = 'ERROR'")
	}
	for _, t := range q.Tags {
		key := sqlIdent(strings.TrimSpace(t.Key))
		if key == "" {
			continue
		}
		filters = append(filters, key+" = "+sqlQuote(t.Value))
	}
	return filters
}

const traceDurationExpression = "(max(end_time) - min(start_time))"

// buildSearchHaving builds trace-level wall-clock duration bounds. OpenObserve
// stores start/end timestamps in nanoseconds while duration query values are
// parsed as microseconds, so thresholds are converted before comparison.
func buildSearchHaving(q *queryModel) ([]string, error) {
	var having []string
	if s := strings.TrimSpace(q.MinDuration); s != "" {
		micros, err := parseDurationMicros(s)
		if err != nil {
			return nil, fmt.Errorf("min duration: %w", err)
		}
		nanos, err := durationMicrosToNanos(micros)
		if err != nil {
			return nil, fmt.Errorf("min duration: %w", err)
		}
		having = append(having, traceDurationExpression+" >= "+strconv.FormatInt(nanos, 10))
	}
	if s := strings.TrimSpace(q.MaxDuration); s != "" {
		micros, err := parseDurationMicros(s)
		if err != nil {
			return nil, fmt.Errorf("max duration: %w", err)
		}
		nanos, err := durationMicrosToNanos(micros)
		if err != nil {
			return nil, fmt.Errorf("max duration: %w", err)
		}
		having = append(having, traceDurationExpression+" <= "+strconv.FormatInt(nanos, 10))
	}
	return having, nil
}

func durationMicrosToNanos(micros int64) (int64, error) {
	if micros < 0 || micros > math.MaxInt64/1000 {
		return 0, fmt.Errorf("duration %d microseconds exceeds the supported nanoseconds range", micros)
	}
	return micros * 1000, nil
}

var durationRe = regexp.MustCompile(`^\s*([0-9]*\.?[0-9]+)\s*(ns|us|µs|ms|s|m|h)?\s*$`)

// parseDurationMicros parses a human duration ("1.5ms", "100us", "2s", "750",
// bare number = microseconds) into microseconds, matching OpenObserve's
// duration column unit.
func parseDurationMicros(s string) (int64, error) {
	m := durationRe.FindStringSubmatch(s)
	if m == nil {
		return 0, fmt.Errorf("invalid duration %q", s)
	}
	val, ok := new(big.Rat).SetString(m[1])
	if !ok {
		return 0, fmt.Errorf("invalid duration %q", s)
	}
	var scaleNumerator, scaleDenominator int64 = 1, 1
	switch m[2] {
	case "ns":
		scaleDenominator = 1000
	case "us", "µs", "":
	case "ms":
		scaleNumerator = 1000
	case "s":
		scaleNumerator = 1_000_000
	case "m":
		scaleNumerator = 60 * 1_000_000
	case "h":
		scaleNumerator = 3600 * 1_000_000
	default:
		return 0, fmt.Errorf("unknown duration unit in %q", s)
	}
	micros := new(big.Rat).Mul(val, big.NewRat(scaleNumerator, scaleDenominator))
	if micros.Cmp(new(big.Rat).SetInt64(math.MaxInt64)) > 0 {
		return 0, fmt.Errorf("invalid duration %q: exceeds supported microsecond range", s)
	}
	whole := new(big.Int).Quo(micros.Num(), micros.Denom())
	return whole.Int64(), nil
}
