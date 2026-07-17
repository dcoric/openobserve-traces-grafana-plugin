package plugin

import (
	"bytes"
	"encoding/json"
	"strconv"
	"strings"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/data"
)

// ---------------------------------------------------------------------------
// Grafana trace-view row shapes (TraceSpanRow / TraceLog / TraceSpanReference
// from @grafana/data). tags/logs/references/serviceTags are emitted as JSON
// array cells (data supports []json.RawMessage fields).
// ---------------------------------------------------------------------------

type keyValue struct {
	Key   string      `json:"key"`
	Value interface{} `json:"value"`
	Type  string      `json:"type,omitempty"`
}

type traceLog struct {
	Timestamp float64    `json:"timestamp"` // millisecond epoch
	Name      string     `json:"name,omitempty"`
	Fields    []keyValue `json:"fields"`
}

type spanReference struct {
	TraceID string     `json:"traceID"`
	SpanID  string     `json:"spanID"`
	Tags    []keyValue `json:"tags,omitempty"`
}

// reserved holds the OpenObserve span columns that map to dedicated trace
// fields and therefore must NOT be folded into the generic tags map.
var reserved = map[string]bool{
	"trace_id":                  true,
	"span_id":                   true,
	"reference_parent_span_id":  true,
	"reference_parent_trace_id": true,
	"reference_ref_type":        true,
	"operation_name":            true,
	"service_name":              true,
	"span_kind":                 true,
	"span_status":               true,
	"start_time":                true,
	"end_time":                  true,
	"duration":                  true,
	"status_code":               true,
	"status_message":            true,
	"events":                    true,
	"links":                     true,
	"flags":                     true,
	"_timestamp":                true,
	"_o2_id":                    true,
}

// resourcePrefixes are OpenTelemetry resource-attribute namespaces. Columns
// with these prefixes are treated as span "process"/resource tags
// (serviceTags) rather than span attributes. This is a heuristic; a
// schema-driven classification (see CallResource) can refine it later.
var resourcePrefixes = []string{
	"service_", "telemetry_", "k8s_", "host_", "os_", "process_",
	"container_", "cloud_", "deployment_", "faas_", "device_",
	"browser_", "webengine_",
}

func isResourceAttr(key string) bool {
	for _, p := range resourcePrefixes {
		if strings.HasPrefix(key, p) {
			return true
		}
	}
	return false
}

// buildTraceFrame turns the per-span search hits into a single Grafana trace
// frame (one row per span, meta.preferredVisualisationType = "trace").
func buildTraceFrame(hits []map[string]json.RawMessage, executedSQL string) *data.Frame {
	n := len(hits)
	traceID := make([]string, n)
	spanID := make([]string, n)
	parentSpanID := make([]string, n)
	operationName := make([]string, n)
	serviceName := make([]string, n)
	kind := make([]string, n)
	statusCode := make([]int64, n)
	statusMessage := make([]string, n)
	serviceTags := make([]json.RawMessage, n)
	startTime := make([]float64, n)
	duration := make([]float64, n)
	logs := make([]json.RawMessage, n)
	references := make([]json.RawMessage, n)
	tags := make([]json.RawMessage, n)

	for i, hit := range hits {
		traceID[i], _ = decodeString(hit["trace_id"])
		spanID[i], _ = decodeString(hit["span_id"])
		parentSpanID[i], _ = decodeString(hit["reference_parent_span_id"])
		operationName[i], _ = decodeString(hit["operation_name"])
		serviceName[i], _ = decodeString(hit["service_name"])

		rawKind, _ := decodeString(hit["span_kind"])
		kind[i] = normalizeSpanKind(rawKind)

		spanStatus, _ := decodeString(hit["span_status"])
		code, hasCode := decodeInt64(hit["status_code"])
		if !hasCode {
			code = statusCodeFromString(spanStatus)
		}
		statusCode[i] = code
		statusMessage[i], _ = decodeString(hit["status_message"])

		// start time: absolute epoch -> ms (magnitude-detected, see epochToMillis).
		if st, ok := decodeInt64(hit["start_time"]); ok {
			startTime[i] = epochToMillis(st)
		}
		// duration: OpenObserve stores microseconds (a relative value, so it
		// cannot be magnitude-detected) -> milliseconds.
		if d, ok := decodeInt64(hit["duration"]); ok {
			duration[i] = float64(d) / 1000.0
		}

		// span attributes -> tags / serviceTags.
		spanTags := make([]keyValue, 0, len(hit))
		svcTags := make([]keyValue, 0)
		sawError := false
		for k, raw := range hit {
			if reserved[k] {
				continue
			}
			if k == "error" {
				sawError = true
			}
			kv := keyValue{Key: k, Value: decodeValue(raw)}
			kv.Type = valueType(kv.Value)
			if isResourceAttr(k) {
				svcTags = append(svcTags, kv)
			} else {
				spanTags = append(spanTags, kv)
			}
		}
		// Mark errored spans so the trace view colors them red, unless the span
		// already carries an explicit "error" attribute (avoid a duplicate key).
		if !sawError && isErrorSpan(spanStatus, statusCode[i]) {
			spanTags = append(spanTags, keyValue{Key: "error", Value: true, Type: "bool"})
		}

		tags[i] = mustJSON(spanTags)
		serviceTags[i] = mustJSON(svcTags)
		logs[i] = mustJSON(parseEvents(hit["events"]))
		references[i] = mustJSON(parseLinks(hit["links"]))
	}

	frame := data.NewFrame("Trace",
		data.NewField("traceID", nil, traceID),
		data.NewField("spanID", nil, spanID),
		data.NewField("parentSpanID", nil, parentSpanID),
		data.NewField("operationName", nil, operationName),
		data.NewField("serviceName", nil, serviceName),
		data.NewField("kind", nil, kind),
		data.NewField("statusCode", nil, statusCode),
		data.NewField("statusMessage", nil, statusMessage),
		data.NewField("serviceTags", nil, serviceTags),
		data.NewField("startTime", nil, startTime),
		data.NewField("duration", nil, duration),
		data.NewField("logs", nil, logs),
		data.NewField("references", nil, references),
		data.NewField("tags", nil, tags),
	)
	frame.Meta = &data.FrameMeta{
		PreferredVisualization: data.VisTypeTrace,
		ExecutedQueryString:    executedSQL,
	}
	return frame
}

// buildSearchTableFrame turns GROUP BY trace_id aggregate rows into a table
// frame, with an internal data link on the trace id that drills into the full
// trace waterfall on this same datasource.
func buildSearchTableFrame(hits []map[string]json.RawMessage, stream, dsUID, dsName, executedSQL string) *data.Frame {
	n := len(hits)
	traceIDs := make([]string, n)
	startTimes := make([]time.Time, n)
	names := make([]string, n)
	services := make([]string, n)
	durations := make([]float64, n)
	spanCounts := make([]int64, n)
	errorCounts := make([]int64, n)

	for i, hit := range hits {
		traceIDs[i], _ = decodeString(hit["trace_id"])

		start, _ := decodeInt64(hit["trace_start_time"])
		end, _ := decodeInt64(hit["trace_end_time"])
		startTimes[i] = epochToTime(start)
		// trace duration = wall-clock end-start, both absolute epoch values in
		// the same unit, so the difference is unit-consistent -> ms.
		durations[i] = epochToMillis(end) - epochToMillis(start)

		names[i], _ = decodeString(hit["first_operation_name"])
		services[i], _ = decodeString(hit["first_service_name"])
		spanCounts[i], _ = decodeInt64(hit["span_count"])
		errorCounts[i], _ = decodeInt64(hit["error_count"])
	}

	traceIDField := data.NewField("traceID", nil, traceIDs)
	traceIDField.Config = &data.FieldConfig{
		DisplayName: "Trace ID",
		Links: []data.DataLink{{
			Title: "View trace",
			Internal: &data.InternalDataLink{
				DatasourceUID:  dsUID,
				DatasourceName: dsName,
				Query: map[string]interface{}{
					"queryType": queryTypeTraceID,
					"traceId":   "${__value.raw}",
					"stream":    stream,
				},
			},
		}},
	}

	durationField := data.NewField("traceDuration", nil, durations)
	durationField.Config = &data.FieldConfig{Unit: "ms", DisplayName: "Duration"}

	startField := data.NewField("startTime", nil, startTimes)
	startField.Config = &data.FieldConfig{DisplayName: "Start time"}
	nameField := data.NewField("traceName", nil, names)
	nameField.Config = &data.FieldConfig{DisplayName: "Name"}
	serviceField := data.NewField("traceService", nil, services)
	serviceField.Config = &data.FieldConfig{DisplayName: "Service"}
	spanCountField := data.NewField("spanCount", nil, spanCounts)
	spanCountField.Config = &data.FieldConfig{DisplayName: "Spans"}
	errorCountField := data.NewField("errorCount", nil, errorCounts)
	errorCountField.Config = &data.FieldConfig{DisplayName: "Errors"}

	frame := data.NewFrame("Traces",
		traceIDField,
		startField,
		nameField,
		serviceField,
		durationField,
		spanCountField,
		errorCountField,
	)
	frame.Meta = &data.FrameMeta{
		PreferredVisualization: data.VisTypeTable,
		ExecutedQueryString:    executedSQL,
		UniqueRowIDFields:      []int{0},
	}
	return frame
}

// parseEvents converts the OpenObserve "events" column (a JSON-encoded string
// holding an array of OTLP events) into Grafana TraceLog entries.
func parseEvents(raw json.RawMessage) []traceLog {
	arr := decodeJSONStringArray(raw)
	out := make([]traceLog, 0, len(arr))
	for _, ev := range arr {
		log := traceLog{Fields: []keyValue{}}
		log.Name, _ = decodeString(ev["name"])
		if ts, ok := decodeInt64(ev["_timestamp"]); ok {
			log.Timestamp = epochToMillis(ts)
		}
		for k, v := range ev {
			if k == "name" || k == "_timestamp" {
				continue
			}
			val := decodeValue(v)
			log.Fields = append(log.Fields, keyValue{Key: k, Value: val, Type: valueType(val)})
		}
		out = append(out, log)
	}
	return out
}

// parseLinks converts the OpenObserve "links" column (a JSON-encoded string
// holding an array of OTLP span links) into Grafana TraceSpanReference entries.
func parseLinks(raw json.RawMessage) []spanReference {
	arr := decodeJSONStringArray(raw)
	out := make([]spanReference, 0, len(arr))
	for _, lnk := range arr {
		ref := spanReference{Tags: []keyValue{}}
		if ctxRaw, ok := lnk["context"]; ok {
			var ctx map[string]json.RawMessage
			if json.Unmarshal(ctxRaw, &ctx) == nil {
				ref.TraceID, _ = decodeString(ctx["traceId"])
				ref.SpanID, _ = decodeString(ctx["spanId"])
			}
		}
		for k, v := range lnk {
			if k == "context" {
				continue
			}
			val := decodeValue(v)
			ref.Tags = append(ref.Tags, keyValue{Key: k, Value: val, Type: valueType(val)})
		}
		out = append(out, ref)
	}
	return out
}

// normalizeSpanKind maps OpenObserve's span_kind (numeric string "0".."5" from
// the OTLP/gRPC path, or "SPAN_KIND_*" from the JSON path) to the lowercase
// names the Grafana trace view expects.
func normalizeSpanKind(k string) string {
	switch strings.ToUpper(strings.TrimSpace(k)) {
	case "1", "SPAN_KIND_INTERNAL", "INTERNAL":
		return "internal"
	case "2", "SPAN_KIND_SERVER", "SERVER":
		return "server"
	case "3", "SPAN_KIND_CLIENT", "CLIENT":
		return "client"
	case "4", "SPAN_KIND_PRODUCER", "PRODUCER":
		return "producer"
	case "5", "SPAN_KIND_CONSUMER", "CONSUMER":
		return "consumer"
	default:
		return "unspecified"
	}
}

// isErrorSpan reports whether a span is errored, honoring both the numeric OTLP
// status code (2 = ERROR) and the string span_status (case-insensitive). Shared
// by the trace frame and the node graph so their error definitions agree.
func isErrorSpan(spanStatus string, statusCode int64) bool {
	return statusCode == 2 || strings.EqualFold(spanStatus, "ERROR")
}

func statusCodeFromString(s string) int64 {
	switch strings.ToUpper(strings.TrimSpace(s)) {
	case "OK":
		return 1
	case "ERROR":
		return 2
	default:
		return 0 // UNSET
	}
}

// epochToMillis converts an absolute epoch value of unknown unit to fractional
// milliseconds, detecting the unit by magnitude. This makes start/end/event
// timestamps robust to ns/us/ms differences between OpenObserve versions.
// (It only works for absolute timestamps, not relative durations.)
func epochToMillis(v int64) float64 {
	switch {
	case v >= 1e17: // nanoseconds
		return float64(v) / 1e6
	case v >= 1e14: // microseconds
		return float64(v) / 1e3
	case v >= 1e11: // milliseconds
		return float64(v)
	default: // seconds
		return float64(v) * 1e3
	}
}

// epochToTime converts an absolute epoch value of unknown unit to time.Time,
// preserving full precision (used for the table's Start time column).
func epochToTime(v int64) time.Time {
	switch {
	case v >= 1e17:
		return time.Unix(0, v) // ns
	case v >= 1e14:
		return time.UnixMicro(v) // us
	case v >= 1e11:
		return time.UnixMilli(v) // ms
	default:
		return time.Unix(v, 0) // s
	}
}

// ---------------------------------------------------------------------------
// RawMessage decode helpers (precision-preserving).
// ---------------------------------------------------------------------------

func decodeString(raw json.RawMessage) (string, bool) {
	if len(raw) == 0 || bytes.Equal(raw, []byte("null")) {
		return "", false
	}
	var s string
	if err := json.Unmarshal(raw, &s); err == nil {
		return s, true
	}
	// Not a JSON string (e.g. a number); render its literal form.
	return strings.Trim(string(raw), `"`), true
}

func decodeInt64(raw json.RawMessage) (int64, bool) {
	if len(raw) == 0 || bytes.Equal(raw, []byte("null")) {
		return 0, false
	}
	var n json.Number
	if err := json.Unmarshal(raw, &n); err == nil {
		if i, err := n.Int64(); err == nil {
			return i, true
		}
		if f, err := n.Float64(); err == nil {
			return int64(f), true
		}
	}
	// String-encoded number.
	var s string
	if err := json.Unmarshal(raw, &s); err == nil {
		s = strings.TrimSpace(s)
		if i, err := strconv.ParseInt(s, 10, 64); err == nil {
			return i, true
		}
		if f, err := strconv.ParseFloat(s, 64); err == nil {
			return int64(f), true
		}
	}
	return 0, false
}

// decodeValue decodes an arbitrary column value, keeping numbers as int64/
// float64 (not always-float64) for cleaner tag display.
func decodeValue(raw json.RawMessage) interface{} {
	if len(raw) == 0 {
		return nil
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	var v interface{}
	if err := dec.Decode(&v); err != nil {
		return strings.Trim(string(raw), `"`)
	}
	if n, ok := v.(json.Number); ok {
		if i, err := n.Int64(); err == nil {
			return i
		}
		if f, err := n.Float64(); err == nil {
			return f
		}
		return n.String()
	}
	return v
}

func valueType(v interface{}) string {
	switch v.(type) {
	case bool:
		return "bool"
	case int64:
		return "int64"
	case float64:
		return "float64"
	case string:
		return "string"
	default:
		return ""
	}
}

// decodeJSONStringArray handles the OpenObserve convention where events/links
// are stored as a JSON-encoded STRING containing an array. It also tolerates an
// already-decoded array, null, and the empty-array sentinel.
func decodeJSONStringArray(raw json.RawMessage) []map[string]json.RawMessage {
	if len(raw) == 0 {
		return nil
	}
	trimmed := strings.TrimSpace(string(raw))
	if trimmed == "" || trimmed == "null" || trimmed == `""` || trimmed == "[]" || trimmed == `"[]"` {
		return nil
	}
	// Case 1: a JSON string holding the array.
	var s string
	if err := json.Unmarshal(raw, &s); err == nil {
		s = strings.TrimSpace(s)
		if s == "" || s == "[]" {
			return nil
		}
		var arr []map[string]json.RawMessage
		if err := json.Unmarshal([]byte(s), &arr); err == nil {
			return arr
		}
		return nil
	}
	// Case 2: already an array value.
	var arr []map[string]json.RawMessage
	if err := json.Unmarshal(raw, &arr); err == nil {
		return arr
	}
	return nil
}

func mustJSON(v interface{}) json.RawMessage {
	b, err := json.Marshal(v)
	if err != nil {
		return json.RawMessage("null")
	}
	return b
}
