package plugin

import (
	"encoding/json"
	"math"
	"testing"

	"github.com/grafana/grafana-plugin-sdk-go/data"
)

// sampleSpanHit is a representative per-span row as returned by
// POST /api/{org}/_search?type=traces for SELECT * WHERE trace_id=...
// Units follow OpenObserve source: start_time/end_time NANOSECONDS,
// duration MICROSECONDS, event _timestamp NANOSECONDS.
const sampleSpanHit = `{
  "trace_id": "0af7651916cd43dd8448eb211c80319c",
  "span_id": "b9c7c989f97918e1",
  "reference_parent_span_id": "",
  "operation_name": "HTTP GET /api/users",
  "service_name": "frontend",
  "span_kind": "2",
  "span_status": "ERROR",
  "start_time": 1700000000123456789,
  "end_time": 1700000000223456789,
  "duration": 100000,
  "status_code": 2,
  "status_message": "boom",
  "http_method": "GET",
  "http_status_code": 500,
  "service_version": "1.2.3",
  "events": "[{\"name\":\"exception\",\"_timestamp\":1700000000150000000,\"exception_type\":\"IOError\"}]",
  "links": "[{\"context\":{\"traceId\":\"aaaabbbbccccdddd\",\"spanId\":\"1111222233334444\"},\"droppedAttributesCount\":0,\"link_attr\":\"x\"}]",
  "_timestamp": 1700000000123456
}`

func parseHit(t *testing.T, s string) map[string]json.RawMessage {
	t.Helper()
	var m map[string]json.RawMessage
	if err := json.Unmarshal([]byte(s), &m); err != nil {
		t.Fatalf("parse hit: %v", err)
	}
	return m
}

func fieldByName(t *testing.T, f *data.Frame, name string) *data.Field {
	t.Helper()
	for _, fld := range f.Fields {
		if fld.Name == name {
			return fld
		}
	}
	t.Fatalf("field %q not found", name)
	return nil
}

func decodeKVs(t *testing.T, raw any) []keyValue {
	t.Helper()
	rm, ok := raw.(json.RawMessage)
	if !ok {
		t.Fatalf("expected json.RawMessage, got %T", raw)
	}
	var kvs []keyValue
	if err := json.Unmarshal(rm, &kvs); err != nil {
		t.Fatalf("decode kvs: %v", err)
	}
	return kvs
}

func TestBuildTraceFrame_Mapping(t *testing.T) {
	hit := parseHit(t, sampleSpanHit)
	frame := buildTraceFrame([]map[string]json.RawMessage{hit}, "SELECT * ...")

	if frame.Meta == nil || frame.Meta.PreferredVisualization != data.VisTypeTrace {
		t.Fatalf("expected preferredVisualisationType=trace, got %+v", frame.Meta)
	}
	if got := frame.Rows(); got != 1 {
		t.Fatalf("expected 1 row, got %d", got)
	}

	// Identity fields.
	if v := fieldByName(t, frame, "traceID").At(0).(string); v != "0af7651916cd43dd8448eb211c80319c" {
		t.Errorf("traceID = %q", v)
	}
	if v := fieldByName(t, frame, "spanID").At(0).(string); v != "b9c7c989f97918e1" {
		t.Errorf("spanID = %q", v)
	}
	if v := fieldByName(t, frame, "parentSpanID").At(0).(string); v != "" {
		t.Errorf("parentSpanID = %q, want empty (root)", v)
	}
	if v := fieldByName(t, frame, "operationName").At(0).(string); v != "HTTP GET /api/users" {
		t.Errorf("operationName = %q", v)
	}
	if v := fieldByName(t, frame, "serviceName").At(0).(string); v != "frontend" {
		t.Errorf("serviceName = %q", v)
	}

	// span_kind "2" -> "server".
	if v := fieldByName(t, frame, "kind").At(0).(string); v != "server" {
		t.Errorf("kind = %q, want server", v)
	}

	// status.
	if v := fieldByName(t, frame, "statusCode").At(0).(int64); v != 2 {
		t.Errorf("statusCode = %d, want 2", v)
	}
	if v := fieldByName(t, frame, "statusMessage").At(0).(string); v != "boom" {
		t.Errorf("statusMessage = %q", v)
	}

	// startTime: ns -> ms.
	wantStartMs := 1700000000123456789.0 / 1e6
	if v := fieldByName(t, frame, "startTime").At(0).(float64); math.Abs(v-wantStartMs) > 0.001 {
		t.Errorf("startTime = %f, want ~%f", v, wantStartMs)
	}
	// duration: us -> ms.
	if v := fieldByName(t, frame, "duration").At(0).(float64); math.Abs(v-100.0) > 1e-9 {
		t.Errorf("duration = %f, want 100", v)
	}

	// tags: includes http_method, http_status_code and the synthetic error tag,
	// but NOT the resource attribute service_version.
	tags := decodeKVs(t, fieldByName(t, frame, "tags").At(0))
	tagMap := map[string]any{}
	for _, kv := range tags {
		tagMap[kv.Key] = kv.Value
	}
	if _, ok := tagMap["http_method"]; !ok {
		t.Errorf("tags missing http_method: %+v", tagMap)
	}
	if _, ok := tagMap["service_version"]; ok {
		t.Errorf("tags should not contain resource attr service_version")
	}
	if errVal, ok := tagMap["error"]; !ok || errVal != true {
		t.Errorf("expected error=true tag, got %v", tagMap["error"])
	}

	// serviceTags: resource attribute service_version.
	svcTags := decodeKVs(t, fieldByName(t, frame, "serviceTags").At(0))
	foundVersion := false
	for _, kv := range svcTags {
		if kv.Key == "service_version" {
			foundVersion = true
		}
	}
	if !foundVersion {
		t.Errorf("serviceTags missing service_version: %+v", svcTags)
	}

	// logs: one event "exception" with ns->ms timestamp and a field.
	logsRaw := fieldByName(t, frame, "logs").At(0).(json.RawMessage)
	var logs []traceLog
	if err := json.Unmarshal(logsRaw, &logs); err != nil {
		t.Fatalf("decode logs: %v", err)
	}
	if len(logs) != 1 {
		t.Fatalf("expected 1 log, got %d", len(logs))
	}
	if logs[0].Name != "exception" {
		t.Errorf("log name = %q", logs[0].Name)
	}
	wantLogMs := 1700000000150000000.0 / 1e6
	if math.Abs(logs[0].Timestamp-wantLogMs) > 0.001 {
		t.Errorf("log timestamp = %f, want ~%f", logs[0].Timestamp, wantLogMs)
	}

	// references: one link with the parsed context.
	refsRaw := fieldByName(t, frame, "references").At(0).(json.RawMessage)
	var refs []spanReference
	if err := json.Unmarshal(refsRaw, &refs); err != nil {
		t.Fatalf("decode references: %v", err)
	}
	if len(refs) != 1 {
		t.Fatalf("expected 1 reference, got %d", len(refs))
	}
	if refs[0].TraceID != "aaaabbbbccccdddd" || refs[0].SpanID != "1111222233334444" {
		t.Errorf("reference ids = %q/%q", refs[0].TraceID, refs[0].SpanID)
	}
}

func TestBuildTraceFrame_StatusFallbackFromString(t *testing.T) {
	// No status_code column; span_status string drives statusCode + error tag.
	hit := parseHit(t, `{"trace_id":"t","span_id":"s","span_status":"ERROR","start_time":1700000000000000000,"duration":5}`)
	frame := buildTraceFrame([]map[string]json.RawMessage{hit}, "")
	if v := fieldByName(t, frame, "statusCode").At(0).(int64); v != 2 {
		t.Errorf("statusCode = %d, want 2 derived from span_status", v)
	}
}

func TestNormalizeSpanKind(t *testing.T) {
	cases := map[string]string{
		"1": "internal", "2": "server", "3": "client", "4": "producer", "5": "consumer",
		"SPAN_KIND_SERVER": "server", "SPAN_KIND_CONSUMER": "consumer",
		"0": "unspecified", "": "unspecified", "weird": "unspecified",
	}
	for in, want := range cases {
		if got := normalizeSpanKind(in); got != want {
			t.Errorf("normalizeSpanKind(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestParseDurationMicros(t *testing.T) {
	cases := map[string]int64{
		"100us": 100, "100µs": 100, "1.5ms": 1500, "2s": 2_000_000,
		"750": 750, "1ns": 0, "1000ns": 1, "1m": 60_000_000,
	}
	for in, want := range cases {
		got, err := parseDurationMicros(in)
		if err != nil {
			t.Errorf("parseDurationMicros(%q) error: %v", in, err)
			continue
		}
		if got != want {
			t.Errorf("parseDurationMicros(%q) = %d, want %d", in, got, want)
		}
	}
	if _, err := parseDurationMicros("abc"); err == nil {
		t.Errorf("expected error for invalid duration")
	}
}

func TestValidateTraceID(t *testing.T) {
	if _, err := validateTraceID("0af7651916cd43dd8448eb211c80319c"); err != nil {
		t.Errorf("valid hex id rejected: %v", err)
	}
	if _, err := validateTraceID("'; DROP TABLE x;--"); err == nil {
		t.Errorf("injection string accepted")
	}
	if _, err := validateTraceID(""); err == nil {
		t.Errorf("empty id accepted")
	}
}

func TestEpochToMillis(t *testing.T) {
	cases := map[int64]float64{
		1700000000123456789: 1700000000123.456789, // ns
		1700000000123456:    1700000000123.456,    // us
		1700000000123:       1700000000123,        // ms
		1700000000:          1700000000000,        // s
	}
	for in, want := range cases {
		if got := epochToMillis(in); math.Abs(got-want) > 1.0 {
			t.Errorf("epochToMillis(%d) = %f, want ~%f", in, got, want)
		}
	}
}

func TestDecodeJSONStringArray(t *testing.T) {
	// JSON-encoded string holding an array (OpenObserve convention).
	arr := decodeJSONStringArray(json.RawMessage(`"[{\"name\":\"a\"}]"`))
	if len(arr) != 1 {
		t.Fatalf("expected 1 element, got %d", len(arr))
	}
	// Empty sentinels -> nil.
	for _, empty := range []string{`"[]"`, `"" `, `null`, `[]`} {
		if got := decodeJSONStringArray(json.RawMessage(empty)); got != nil {
			t.Errorf("decodeJSONStringArray(%s) = %v, want nil", empty, got)
		}
	}
}

func TestBuildNodeGraphFrames_DedupAndErrors(t *testing.T) {
	// Two rows share span_id "s1" (duplicate ingestion); s2 is errored via
	// status_code only (lowercase/absent span_status).
	hits := []map[string]json.RawMessage{
		parseHit(t, `{"span_id":"s1","service_name":"a","operation_name":"op","duration":1000,"span_status":"OK"}`),
		parseHit(t, `{"span_id":"s1","service_name":"a","operation_name":"op","duration":1000,"span_status":"OK"}`),
		parseHit(t, `{"span_id":"s2","reference_parent_span_id":"s1","service_name":"b","operation_name":"op2","duration":2000,"status_code":2}`),
	}
	frames := buildNodeGraphFrames(hits)
	if len(frames) != 2 {
		t.Fatalf("expected nodes+edges frames, got %d", len(frames))
	}
	nodes := frames[0]
	idField := fieldByName(t, nodes, "id")
	if idField.Len() != 2 {
		t.Errorf("expected 2 unique nodes (deduped), got %d", idField.Len())
	}
	// s2 errored via status_code=2 must count as an error in secondarystat.
	sec := fieldByName(t, nodes, "secondarystat")
	var errSum float64
	for i := 0; i < sec.Len(); i++ {
		errSum += sec.At(i).(float64)
	}
	if errSum != 1 {
		t.Errorf("expected 1 errored node (status_code=2), got %v", errSum)
	}
	// One edge s1 -> s2.
	edges := frames[1]
	if fieldByName(t, edges, "source").Len() != 1 {
		t.Errorf("expected 1 edge, got %d", fieldByName(t, edges, "source").Len())
	}
}

func TestErrorTagNotDuplicated(t *testing.T) {
	// Span carries an explicit "error" attribute AND is errored: only one tag.
	hit := parseHit(t, `{"trace_id":"t","span_id":"s","span_status":"ERROR","error":"real message","start_time":1700000000000000000,"duration":5}`)
	frame := buildTraceFrame([]map[string]json.RawMessage{hit}, "")
	tags := decodeKVs(t, fieldByName(t, frame, "tags").At(0))
	n := 0
	for _, kv := range tags {
		if kv.Key == "error" {
			n++
		}
	}
	if n != 1 {
		t.Errorf("expected exactly one 'error' tag, got %d: %+v", n, tags)
	}
}

func TestBuildSearchTableFrame(t *testing.T) {
	hit := parseHit(t, `{
      "trace_id":"abc123","trace_start_time":1700000000000000000,"trace_end_time":1700000000500000000,
      "first_operation_name":"GET /","first_service_name":"frontend","span_count":12,"error_count":2}`)
	frame := buildSearchTableFrame([]map[string]json.RawMessage{hit}, "default", "uid-1", "OpenObserve", "SQL")
	if frame.Meta.PreferredVisualization != data.VisTypeTable {
		t.Errorf("expected table vis")
	}
	dur := fieldByName(t, frame, "traceDuration").At(0).(float64)
	if math.Abs(dur-500.0) > 0.001 { // 0.5s = 500ms
		t.Errorf("traceDuration = %f, want 500", dur)
	}
	idField := fieldByName(t, frame, "traceID")
	if idField.Config == nil || len(idField.Config.Links) != 1 {
		t.Fatalf("traceID field missing drill-down data link")
	}
	if idField.Config.Links[0].Internal == nil || idField.Config.Links[0].Internal.DatasourceUID != "uid-1" {
		t.Errorf("data link internal target wrong: %+v", idField.Config.Links[0])
	}
}
