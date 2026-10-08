package plugin

import (
	"encoding/json"
	"reflect"
	"testing"
)

func TestBuildNodeGraphFrames_PartialAndOutOfOrder(t *testing.T) {
	cases := []struct {
		name  string
		rows  []string
		nodes []string
		edges [][2]string
	}{
		{"missing parent", []string{`{"span_id":"child","reference_parent_span_id":"missing"}`}, []string{"child"}, nil},
		{"child before parent", []string{`{"span_id":"child","reference_parent_span_id":"parent"}`, `{"span_id":"parent"}`}, []string{"child", "parent"}, [][2]string{{"parent", "child"}}},
		{"root only", []string{`{"span_id":"root"}`}, []string{"root"}, nil},
		{"invalid span IDs", []string{`{"reference_parent_span_id":"root"}`, `{"span_id":"","reference_parent_span_id":"root"}`, `{"span_id":"root"}`}, []string{"root"}, nil},
		{"partial tree", []string{`{"span_id":"orphan","reference_parent_span_id":"missing"}`, `{"span_id":"child","reference_parent_span_id":"root"}`, `{"span_id":"root"}`}, []string{"orphan", "child", "root"}, [][2]string{{"root", "child"}}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var hits []map[string]json.RawMessage
			for _, row := range tc.rows {
				hits = append(hits, parseHit(t, row))
			}
			frames := buildNodeGraphFrames(hits)
			if len(frames) != 2 {
				t.Fatalf("got %d frames, want 2", len(frames))
			}
			ids := fieldByName(t, frames[0], "id")
			var gotNodes []string
			present := make(map[string]bool)
			for i := 0; i < ids.Len(); i++ {
				id := ids.At(i).(string)
				gotNodes = append(gotNodes, id)
				present[id] = true
			}
			if !reflect.DeepEqual(gotNodes, tc.nodes) {
				t.Fatalf("nodes = %v, want %v", gotNodes, tc.nodes)
			}
			sources := fieldByName(t, frames[1], "source")
			targets := fieldByName(t, frames[1], "target")
			if sources.Len() != targets.Len() {
				t.Fatal("edge source/target lengths differ")
			}
			var gotEdges [][2]string
			for i := 0; i < sources.Len(); i++ {
				from, to := sources.At(i).(string), targets.At(i).(string)
				if !present[from] || !present[to] {
					t.Fatalf("dangling edge %s -> %s", from, to)
				}
				gotEdges = append(gotEdges, [2]string{from, to})
			}
			if !reflect.DeepEqual(gotEdges, tc.edges) {
				t.Fatalf("edges = %v, want %v", gotEdges, tc.edges)
			}
		})
	}
}

func TestBuildNodeGraphFrames_Empty(t *testing.T) {
	if frames := buildNodeGraphFrames(nil); len(frames) != 0 {
		t.Fatalf("empty input produced %d frames", len(frames))
	}
}
