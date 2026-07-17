package plugin

import (
	"encoding/json"
	"math"
	"strconv"
	"strings"
	"testing"
)

func TestBuildTraceDetailSQL(t *testing.T) {
	sql := buildTraceDetailSQL("default", "0af7651916cd43dd8448eb211c80319c")
	want := `SELECT * FROM "default" WHERE trace_id = '0af7651916cd43dd8448eb211c80319c' ORDER BY start_time`
	if sql != want {
		t.Errorf("got:\n%s\nwant:\n%s", sql, want)
	}
}

func TestValidateTraceID_RequiresExactly32HexCharacters(t *testing.T) {
	cases := []struct {
		name  string
		input string
		valid bool
	}{
		{name: "lowercase", input: "0af7651916cd43dd8448eb211c80319c", valid: true},
		{name: "uppercase", input: "0AF7651916CD43DD8448EB211C80319C", valid: true},
		{name: "too short", input: "0af7651916cd43dd8448eb211c80319", valid: false},
		{name: "too long", input: "0af7651916cd43dd8448eb211c80319ca", valid: false},
		{name: "dashed", input: "0af76519-16cd43dd8448eb211c80319c", valid: false},
		{name: "non hex", input: "0af7651916cd43dd8448eb211c80319z", valid: false},
		{name: "all zero", input: "00000000000000000000000000000000", valid: false},
	}
	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			_, err := validateTraceID(tt.input)
			if tt.valid && err != nil {
				t.Fatalf("valid trace ID rejected: %v", err)
			}
			if !tt.valid && err == nil {
				t.Fatal("invalid trace ID accepted")
			}
		})
	}
}

func TestBuildSearchSQL_Filters(t *testing.T) {
	q := &queryModel{
		Service:     "frontend",
		SpanName:    "GET /",
		StatusError: true,
		MinDuration: "1.5ms",
		MaxDuration: "2s",
		Tags:        []tagFilter{{Key: "http_method", Value: "GET"}},
	}
	filters := buildSearchFilters(q)
	having, err := buildSearchHaving(q)
	if err != nil {
		t.Fatalf("buildSearchHaving: %v", err)
	}
	sql := buildSearchSQL("default", filters, having, 50)

	for _, want := range []string{
		`sum(CASE WHEN service_name = 'frontend' AND operation_name = 'GET /' AND span_status = 'ERROR' AND http_method = 'GET' THEN 1 ELSE 0 END) > 0`,
		`GROUP BY trace_id`,
		`FROM "default"`,
		// duration bounds are trace-level (HAVING on the aggregate), not WHERE.
		`HAVING sum(CASE WHEN service_name = 'frontend' AND operation_name = 'GET /' AND span_status = 'ERROR' AND http_method = 'GET' THEN 1 ELSE 0 END) > 0 AND (max(end_time) - min(start_time)) >= 1500000 AND (max(end_time) - min(start_time)) <= 2000000000`,
	} {
		if !strings.Contains(sql, want) {
			t.Errorf("search SQL missing %q\nSQL: %s", want, sql)
		}
	}
	if strings.Contains(sql, " WHERE ") {
		t.Errorf("span predicates must not pre-filter aggregate rows\nSQL: %s", sql)
	}
}

func TestBuildSearchFilters_IgnoresRawWhereJSON(t *testing.T) {
	var q queryModel
	if err := json.Unmarshal([]byte(`{"service":"frontend","rawWhere":"http_status_code = 500 OR 1 = 1"}`), &q); err != nil {
		t.Fatalf("unmarshal query: %v", err)
	}
	sql := buildSearchSQL("default", buildSearchFilters(&q), nil, 50)
	if strings.Contains(sql, "http_status_code") || strings.Contains(sql, "1 = 1") {
		t.Fatalf("rawWhere must not reach SQL: %s", sql)
	}
}

func TestBuildSearchSQL_CombinedSpanFiltersMatchSameSpan(t *testing.T) {
	q := &queryModel{
		Service:  "frontend",
		SpanName: "GET /",
		Tags:     []tagFilter{{Key: "http_method", Value: "GET"}},
	}
	sql := buildSearchSQL("default", buildSearchFilters(q), nil, 50)
	want := `HAVING sum(CASE WHEN service_name = 'frontend' AND operation_name = 'GET /' AND http_method = 'GET' THEN 1 ELSE 0 END) > 0`
	if !strings.Contains(sql, want) {
		t.Fatalf("combined span filters must share one conditional aggregate\nSQL: %s", sql)
	}
	if strings.Count(sql, "sum(CASE WHEN service_name") != 1 {
		t.Fatalf("expected one same-span conditional aggregate\nSQL: %s", sql)
	}
}

func TestBuildSearchSQL_WallClockDuration(t *testing.T) {
	q := &queryModel{MinDuration: "1.5ms", MaxDuration: "2s"}
	having, err := buildSearchHaving(q)
	if err != nil {
		t.Fatalf("buildSearchHaving: %v", err)
	}
	sql := buildSearchSQL("default", nil, having, 50)
	for _, want := range []string{
		`max(end_time) - min(start_time) AS trace_duration`,
		`(max(end_time) - min(start_time)) >= 1500000`,
		`(max(end_time) - min(start_time)) <= 2000000000`,
	} {
		if !strings.Contains(sql, want) {
			t.Errorf("wall-clock duration SQL missing %q\nSQL: %s", want, sql)
		}
	}
	if strings.Contains(sql, "max(duration)") {
		t.Errorf("single-span duration aggregate must not be used\nSQL: %s", sql)
	}
}

func TestBuildSearchHaving_AllowsMaximumSafeNanosecondDuration(t *testing.T) {
	safeMicros := int64(math.MaxInt64 / 1000)
	q := &queryModel{MinDuration: strconv.FormatInt(safeMicros, 10) + "us"}

	having, err := buildSearchHaving(q)
	if err != nil {
		t.Fatalf("maximum safe duration rejected: %v", err)
	}
	want := traceDurationExpression + " >= " + strconv.FormatInt(safeMicros*1000, 10)
	if len(having) != 1 || having[0] != want {
		t.Fatalf("having = %v, want %q", having, want)
	}
}

func TestBuildSearchHaving_RejectsNanosecondDurationOverflow(t *testing.T) {
	overflowMicros := int64(math.MaxInt64/1000) + 1
	for _, field := range []struct {
		name string
		set  func(*queryModel, string)
	}{
		{name: "min", set: func(q *queryModel, value string) { q.MinDuration = value }},
		{name: "max", set: func(q *queryModel, value string) { q.MaxDuration = value }},
	} {
		t.Run(field.name, func(t *testing.T) {
			q := &queryModel{}
			field.set(q, strconv.FormatInt(overflowMicros, 10)+"us")
			_, err := buildSearchHaving(q)
			if err == nil {
				t.Fatal("duration nanosecond overflow accepted")
			}
			if !strings.Contains(err.Error(), "nanoseconds") {
				t.Fatalf("error = %q, want nanosecond range context", err)
			}
		})
	}
}

func TestBuildSearchFilters_SQLInjectionEscaped(t *testing.T) {
	q := &queryModel{
		Service: "a' OR '1'='1",
		Tags:    []tagFilter{{Key: "http_method", Value: "x' OR '1'='1"}},
	}
	filters := buildSearchFilters(q)
	if len(filters) != 2 || filters[0] != `service_name = 'a'' OR ''1''=''1'` || filters[1] != `http_method = 'x'' OR ''1''=''1'` {
		t.Errorf("single quotes not escaped: %v", filters)
	}
}

func TestQuoteStreamStripsUnsafe(t *testing.T) {
	if got := quoteStream(`default"; DROP`); got != `"defaultDROP"` {
		t.Errorf("quoteStream did not sanitize: %s", got)
	}
}

func TestSchemaStreamParam(t *testing.T) {
	cases := map[string]string{
		"/schema?stream=default":          "default",
		"/schema?stream=my_stream&type=x": "my_stream",
		"/schema":                         "",
	}
	for in, want := range cases {
		if got := schemaStreamParam(in); got != want {
			t.Errorf("schemaStreamParam(%q) = %q, want %q", in, got, want)
		}
	}
}
