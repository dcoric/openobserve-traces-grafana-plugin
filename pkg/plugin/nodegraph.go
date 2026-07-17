package plugin

import (
	"encoding/json"

	"github.com/grafana/grafana-plugin-sdk-go/data"
)

// Node-graph field names recognised by Grafana's node graph panel
// (NodeGraphDataFrameFieldNames in @grafana/data).
const (
	ngID            = "id"
	ngTitle         = "title"
	ngSubtitle      = "subtitle"
	ngMainStat      = "mainstat"
	ngSecondaryStat = "secondarystat"
	ngSource        = "source"
	ngTarget        = "target"
)

// buildNodeGraphFrames produces the two frames (nodes + edges) that render a
// span-level service/call graph for a single trace. Each span is a node; each
// parent/child relationship is an edge. Returned frames carry
// preferredVisualisationType = nodeGraph so Explore offers a node-graph tab
// next to the waterfall.
func buildNodeGraphFrames(hits []map[string]json.RawMessage) []*data.Frame {
	n := len(hits)
	if n == 0 {
		return nil
	}

	ids := make([]string, 0, n)
	titles := make([]string, 0, n)
	subtitles := make([]string, 0, n)
	mainstats := make([]float64, 0, n)
	secondary := make([]float64, 0, n)

	present := make(map[string]bool, n)

	type edge struct{ from, to string }
	var edges []edge

	for _, hit := range hits {
		spanID, _ := decodeString(hit["span_id"])
		if spanID == "" {
			continue
		}
		if present[spanID] {
			continue // skip duplicate span rows so node ids stay unique
		}
		present[spanID] = true
		service, _ := decodeString(hit["service_name"])
		op, _ := decodeString(hit["operation_name"])
		var durMs float64
		if d, ok := decodeInt64(hit["duration"]); ok {
			durMs = float64(d) / 1000.0
		}
		// Use the same error definition as the trace waterfall (status_code or
		// span_status), so the node graph's error count matches.
		spanStatus, _ := decodeString(hit["span_status"])
		code, hasCode := decodeInt64(hit["status_code"])
		if !hasCode {
			code = statusCodeFromString(spanStatus)
		}
		var errs float64
		if isErrorSpan(spanStatus, code) {
			errs = 1
		}

		ids = append(ids, spanID)
		titles = append(titles, service)
		subtitles = append(subtitles, op)
		mainstats = append(mainstats, durMs)
		secondary = append(secondary, errs)

		if parent, _ := decodeString(hit["reference_parent_span_id"]); parent != "" {
			edges = append(edges, edge{from: parent, to: spanID})
		}
	}

	mainField := data.NewField(ngMainStat, nil, mainstats)
	mainField.Config = &data.FieldConfig{Unit: "ms", DisplayName: "Duration"}
	secField := data.NewField(ngSecondaryStat, nil, secondary)
	secField.Config = &data.FieldConfig{DisplayName: "Errors"}

	nodes := data.NewFrame("nodes",
		data.NewField(ngID, nil, ids),
		data.NewField(ngTitle, nil, titles),
		data.NewField(ngSubtitle, nil, subtitles),
		mainField,
		secField,
	)
	nodes.Meta = &data.FrameMeta{PreferredVisualization: data.VisTypeNodeGraph}

	// Keep only edges whose endpoints are both present, with a stable unique id.
	edgeIDs := make([]string, 0, len(edges))
	sources := make([]string, 0, len(edges))
	targets := make([]string, 0, len(edges))
	for _, e := range edges {
		if !present[e.from] || !present[e.to] {
			continue
		}
		edgeIDs = append(edgeIDs, e.from+"->"+e.to)
		sources = append(sources, e.from)
		targets = append(targets, e.to)
	}

	edgesFrame := data.NewFrame("edges",
		data.NewField(ngID, nil, edgeIDs),
		data.NewField(ngSource, nil, sources),
		data.NewField(ngTarget, nil, targets),
	)
	edgesFrame.Meta = &data.FrameMeta{PreferredVisualization: data.VisTypeNodeGraph}

	return []*data.Frame{nodes, edgesFrame}
}
