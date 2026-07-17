package plugin

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/data"
	"github.com/gresearch/openobserve-traces/pkg/models"
)

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

func TestTraceWarningIsAttachedToTraceAndNodeGraphFrames(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
  "hits": [
    {"trace_id":"0dbbcef1ad16147607f477bb85bae395","span_id":"root","operation_name":"root","service_name":"frontend","start_time":1700000000000000000,"duration":1000},
    {"trace_id":"0dbbcef1ad16147607f477bb85bae395","span_id":"child","reference_parent_span_id":"root","operation_name":"child","service_name":"backend","start_time":1700000000000001000,"duration":500}
  ],
  "total": 3,
  "is_partial": true,
  "function_error": "boom"
}`))
	}))
	t.Cleanup(server.Close)

	datasource := &Datasource{
		settings: &models.PluginSettings{DefaultStream: "default", NodeGraph: true},
		client:   NewClient(server.Client(), server.URL, "default"),
	}
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
