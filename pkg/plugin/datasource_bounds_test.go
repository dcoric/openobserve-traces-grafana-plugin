package plugin

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/data"
	"github.com/gresearch/openobserve-traces/pkg/models"
)

// newJSONTestDatasource returns a Datasource whose client talks to a stub
// OpenObserve server that answers every request with body.
func newJSONTestDatasource(t *testing.T, settings models.PluginSettings, body string) *Datasource {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(server.Close)
	if settings.DefaultStream == "" {
		settings.DefaultStream = "default"
	}
	return &Datasource{
		settings: &settings,
		client:   NewClient(server.Client(), server.URL, "default"),
	}
}

// searchHitsBody builds a search response with n minimal aggregate rows.
func searchHitsBody(n int) string {
	hits := make([]string, n)
	for i := range hits {
		hits[i] = `{"trace_id":"0dbbcef1ad16147607f477bb85bae395"}`
	}
	return `{"hits":[` + strings.Join(hits, ",") + `],"total":` + strconv.Itoa(n) + `}`
}

func TestQuerySearchRejectsLimitAboveServerMaximumBeforeRequest(t *testing.T) {
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		requests.Add(1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"hits":[],"total":0}`))
	}))
	t.Cleanup(server.Close)

	datasource := &Datasource{
		settings: &models.PluginSettings{DefaultStream: "default"},
		client:   NewClient(server.Client(), server.URL, "default"),
	}
	response := datasource.query(context.Background(), backend.DataQuery{
		JSON: json.RawMessage(`{"queryType":"search","limit":501}`),
	})

	if response.Status != backend.StatusBadRequest {
		t.Fatalf("status = %v, want %v", response.Status, backend.StatusBadRequest)
	}
	if response.Error == nil {
		t.Fatal("expected a limit validation error")
	}
	if !strings.Contains(response.Error.Error(), "500") {
		t.Fatalf("error = %q, want server maximum", response.Error)
	}
	if got := requests.Load(); got != 0 {
		t.Fatalf("OpenObserve request count = %d, want 0", got)
	}
}

func TestSearchWarnsWhenResultsHitTheLimit(t *testing.T) {
	datasource := newJSONTestDatasource(t, models.PluginSettings{}, `{
  "hits": [
    {"trace_id":"0dbbcef1ad16147607f477bb85bae395","first_operation_name":"a","first_service_name":"svc","span_count":3,"error_count":0},
    {"trace_id":"1dbbcef1ad16147607f477bb85bae395","first_operation_name":"b","first_service_name":"svc","span_count":2,"error_count":1}
  ],
  "total": 2
}`)

	response := datasource.query(context.Background(), backend.DataQuery{
		JSON: json.RawMessage(`{"queryType":"search","limit":2}`),
	})
	if response.Error != nil {
		t.Fatalf("query error: %v", response.Error)
	}
	if len(response.Frames) != 1 {
		t.Fatalf("frame count = %d, want 1", len(response.Frames))
	}
	frame := response.Frames[0]
	if frame.Meta == nil || len(frame.Meta.Notices) != 1 {
		t.Fatalf("notices = %+v, want one limit warning", frame.Meta)
	}
	want := "search returned the maximum of 2 traces; more may match — narrow the filters or time range, or raise the limit (max 500)"
	if got := frame.Meta.Notices[0].Text; got != want {
		t.Errorf("warning = %q, want %q", got, want)
	}

	// Below the limit the same result set must stay silent.
	response = datasource.query(context.Background(), backend.DataQuery{
		JSON: json.RawMessage(`{"queryType":"search","limit":3}`),
	})
	if response.Error != nil {
		t.Fatalf("query error: %v", response.Error)
	}
	if meta := response.Frames[0].Meta; meta != nil && len(meta.Notices) != 0 {
		t.Fatalf("notices = %+v, want none below the limit", meta.Notices)
	}
}

func TestSearchLimitWarningAtServerMaximumOmitsRaiseHint(t *testing.T) {
	datasource := newJSONTestDatasource(t, models.PluginSettings{}, searchHitsBody(maxSearchLimit))
	response := datasource.query(context.Background(), backend.DataQuery{
		JSON: json.RawMessage(`{"queryType":"search","limit":500}`),
	})
	if response.Error != nil {
		t.Fatalf("query error: %v", response.Error)
	}
	frame := response.Frames[0]
	if frame.Meta == nil || len(frame.Meta.Notices) != 1 {
		t.Fatalf("notices = %+v, want one limit warning", frame.Meta)
	}
	got := frame.Meta.Notices[0].Text
	if strings.Contains(got, "raise the limit") {
		t.Errorf("warning = %q, must not suggest raising past the server maximum", got)
	}
}

func TestSearchWarnsAtDefaultLimitWhenLimitOmitted(t *testing.T) {
	datasource := newJSONTestDatasource(t, models.PluginSettings{}, searchHitsBody(defaultSearchLimit))
	response := datasource.query(context.Background(), backend.DataQuery{
		JSON: json.RawMessage(`{"queryType":"search"}`),
	})
	if response.Error != nil {
		t.Fatalf("query error: %v", response.Error)
	}
	frame := response.Frames[0]
	if frame.Meta == nil || len(frame.Meta.Notices) != 1 {
		t.Fatalf("notices = %+v, want one limit warning at the default limit", frame.Meta)
	}
	got := frame.Meta.Notices[0].Text
	if !strings.Contains(got, fmt.Sprintf("maximum of %d traces", defaultSearchLimit)) {
		t.Errorf("warning = %q, want the %d-trace default limit named", got, defaultSearchLimit)
	}
}

func TestTraceWarningIsAttachedToTraceAndNodeGraphFrames(t *testing.T) {
	datasource := newJSONTestDatasource(t, models.PluginSettings{NodeGraph: true}, `{
  "hits": [
    {"trace_id":"0dbbcef1ad16147607f477bb85bae395","span_id":"root","operation_name":"root","service_name":"frontend","start_time":1700000000000000000,"duration":1000},
    {"trace_id":"0dbbcef1ad16147607f477bb85bae395","span_id":"child","reference_parent_span_id":"root","operation_name":"child","service_name":"backend","start_time":1700000000000001000,"duration":500}
  ],
  "total": 3,
  "is_partial": true,
  "function_error": "boom"
}`)
	response := datasource.query(context.Background(), backend.DataQuery{
		JSON: json.RawMessage(`{"queryType":"traceId","traceId":"0dbbcef1ad16147607f477bb85bae395"}`),
	})

	if response.Error != nil {
		t.Fatalf("query error: %v", response.Error)
	}
	if len(response.Frames) != 3 {
		t.Fatalf("frame count = %d, want trace + node graph frames", len(response.Frames))
	}
	want := "OpenObserve returned 2 of 3 spans; trace truncated; OpenObserve returned a partial result; the query may have been truncated (try a smaller time range); OpenObserve function error: \"boom\""
	for i, frame := range response.Frames {
		if frame.Meta == nil || len(frame.Meta.Notices) != 1 {
			t.Fatalf("frame %d notices = %+v, want one warning", i, frame.Meta)
		}
		if got := frame.Meta.Notices[0].Text; got != want {
			t.Errorf("frame %d warning = %q, want %q", i, got, want)
		}
	}
}

func TestAttachWarningInitializesNilMeta(t *testing.T) {
	frame := data.NewFrame("trace", data.NewField("id", nil, []string{"span"}))
	attachWarning(frame, "returned 1 of 2 spans; trace truncated")

	if frame.Meta == nil {
		t.Fatal("warning attachment left frame metadata nil")
	}
	if len(frame.Meta.Notices) != 1 || frame.Meta.Notices[0].Text != "returned 1 of 2 spans; trace truncated" {
		t.Fatalf("notices = %+v", frame.Meta.Notices)
	}
}
