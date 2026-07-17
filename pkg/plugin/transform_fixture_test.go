package plugin

import (
	"encoding/json"
	"math"
	"os"
	"testing"

	"github.com/grafana/grafana-plugin-sdk-go/data"
)

func TestBuildTraceFrame_LiveTraceFixture(t *testing.T) {
	raw, err := os.ReadFile("testdata/live_trace_v0.91.2.json")
	if err != nil {
		t.Fatalf("read live trace fixture: %v", err)
	}
	var response SearchResponse
	if err := json.Unmarshal(raw, &response); err != nil {
		t.Fatalf("decode live trace fixture: %v", err)
	}

	frame := buildTraceFrame(response.Hits, "fixture SQL")
	if got := frame.Rows(); got != 4 {
		t.Fatalf("fixture rows = %d, want 4 spans", got)
	}
	if got := fieldByName(t, frame, "traceID").At(0).(string); got != "0dbbcef1ad16147607f477bb85bae395" {
		t.Fatalf("root trace id = %q", got)
	}
	if got := fieldByName(t, frame, "parentSpanID").At(0).(string); got != "" {
		t.Fatalf("root parent span id = %q, want empty", got)
	}
	if got := fieldByName(t, frame, "spanID").At(1).(string); got != "58ea6038c50e88d8" {
		t.Fatalf("child span id = %q", got)
	}
	if got := fieldByName(t, frame, "parentSpanID").At(1).(string); got != "5d0cabd44d2e35f8" {
		t.Fatalf("child parent span id = %q", got)
	}
	if got := fieldByName(t, frame, "duration").At(0).(float64); math.Abs(got-27.929) > 0.000001 {
		t.Fatalf("root duration = %f ms, want 27.929", got)
	}
	if got := fieldByName(t, frame, "kind").At(3).(string); got != "client" {
		t.Fatalf("database span kind = %q, want client", got)
	}
	if got := frame.Meta.PreferredVisualization; got != data.VisTypeTrace {
		t.Fatalf("preferred visualization = %q, want trace", got)
	}
}
