package plugin

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/backend/instancemgmt"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
	"github.com/grafana/grafana-plugin-sdk-go/data"
	"github.com/gresearch/openobserve-traces/pkg/models"
)

// Make sure Datasource implements the required SDK interfaces.
var (
	_ backend.QueryDataHandler      = (*Datasource)(nil)
	_ backend.CheckHealthHandler    = (*Datasource)(nil)
	_ backend.CallResourceHandler   = (*Datasource)(nil)
	_ instancemgmt.InstanceDisposer = (*Datasource)(nil)
)

// traceIDWindowPadMicros widens the time window for trace-by-id drill-downs so
// a trace sitting near the edge of the dashboard range is still found. The
// trace_id filter keeps the result set exact regardless of window width.
const traceIDWindowPadMicros = 5 * 60 * 1_000_000

// Datasource is an OpenObserve traces datasource instance.
type Datasource struct {
	settings *models.PluginSettings
	client   *Client
	uid      string
	name     string
}

// NewDatasource creates a new datasource instance, wiring up an HTTP client
// that reuses Grafana's connection + Basic Auth settings.
func NewDatasource(ctx context.Context, s backend.DataSourceInstanceSettings) (instancemgmt.Instance, error) {
	settings, err := models.LoadPluginSettings(s)
	if err != nil {
		return nil, err
	}
	httpClient, err := models.NewHTTPClient(ctx, s)
	if err != nil {
		return nil, err
	}
	return &Datasource{
		settings: settings,
		client:   NewClient(httpClient, s.URL, settings.OrgID),
		uid:      s.UID,
		name:     s.Name,
	}, nil
}

// Dispose cleans up datasource instance resources.
func (d *Datasource) Dispose() {}

// QueryData handles multiple queries and returns multiple responses.
func (d *Datasource) QueryData(ctx context.Context, req *backend.QueryDataRequest) (*backend.QueryDataResponse, error) {
	response := backend.NewQueryDataResponse()
	for _, q := range req.Queries {
		response.Responses[q.RefID] = d.query(ctx, q)
	}
	return response, nil
}

func (d *Datasource) query(ctx context.Context, query backend.DataQuery) backend.DataResponse {
	var qm queryModel
	if err := json.Unmarshal(query.JSON, &qm); err != nil {
		return backend.ErrDataResponse(backend.StatusBadRequest, fmt.Sprintf("json unmarshal: %v", err))
	}

	stream := strings.TrimSpace(qm.Stream)
	if stream == "" {
		stream = strings.TrimSpace(d.settings.DefaultStream)
	}
	if stream == "" {
		return backend.ErrDataResponse(backend.StatusBadRequest,
			"no traces stream configured: set a default stream in the datasource settings or pick one in the query")
	}

	switch qm.QueryType {
	case queryTypeTraceID:
		return d.queryTraceByID(ctx, query, &qm, stream)
	case queryTypeSearch, "":
		return d.querySearch(ctx, query, &qm, stream)
	default:
		return backend.ErrDataResponse(backend.StatusBadRequest, fmt.Sprintf("unknown query type %q", qm.QueryType))
	}
}

func (d *Datasource) querySearch(ctx context.Context, query backend.DataQuery, qm *queryModel, stream string) backend.DataResponse {
	filters := buildSearchFilters(qm)
	having, err := buildSearchHaving(qm)
	if err != nil {
		return backend.ErrDataResponse(backend.StatusBadRequest, err.Error())
	}
	limit := qm.Limit
	if limit <= 0 {
		limit = defaultSearchLimit
	}
	if limit > maxSearchLimit {
		return backend.ErrDataResponse(backend.StatusBadRequest,
			fmt.Sprintf("search limit %d exceeds maximum %d", limit, maxSearchLimit))
	}
	sql := buildSearchSQL(stream, filters, having, limit)

	from := query.TimeRange.From.UnixMicro()
	to := query.TimeRange.To.UnixMicro()

	resp, err := d.client.Search(ctx, "traces", sql, from, to, 0, int64(limit))
	if err != nil {
		return backend.ErrDataResponse(backend.StatusBadGateway, err.Error())
	}

	var r backend.DataResponse
	frame := buildSearchTableFrame(resp.Hits, stream, d.uid, d.name, sql)
	attachWarning(frame, resp.searchWarning())
	r.Frames = append(r.Frames, frame)
	return r
}

func (d *Datasource) queryTraceByID(ctx context.Context, query backend.DataQuery, qm *queryModel, stream string) backend.DataResponse {
	traceID, err := validateTraceID(qm.TraceID)
	if err != nil {
		return backend.ErrDataResponse(backend.StatusBadRequest, err.Error())
	}
	sql := buildTraceDetailSQL(stream, traceID)

	from := query.TimeRange.From.UnixMicro() - traceIDWindowPadMicros
	to := query.TimeRange.To.UnixMicro() + traceIDWindowPadMicros

	resp, err := d.client.Search(ctx, "traces", sql, from, to, 0, maxSpansPerTrace)
	if err != nil {
		return backend.ErrDataResponse(backend.StatusBadGateway, err.Error())
	}

	var r backend.DataResponse
	traceFrame := buildTraceFrame(resp.Hits, sql)
	warning := resp.Warning()
	attachWarning(traceFrame, warning)
	r.Frames = append(r.Frames, traceFrame)

	if (d.settings.NodeGraph || qm.NodeGraph) && len(resp.Hits) > 0 {
		for _, frame := range buildNodeGraphFrames(resp.Hits) {
			attachWarning(frame, warning)
			r.Frames = append(r.Frames, frame)
		}
	}
	return r
}

// attachWarning adds a warning notice to a frame so partial/function-error
// results surface in the UI instead of looking like a normal (empty) response.
func attachWarning(frame *data.Frame, msg string) {
	if frame == nil || msg == "" {
		return
	}
	if frame.Meta == nil {
		frame.Meta = &data.FrameMeta{}
	}
	frame.Meta.Notices = append(frame.Meta.Notices, data.Notice{
		Severity: data.NoticeSeverityWarning,
		Text:     msg,
	})
}

// CheckHealth verifies the datasource can authenticate against OpenObserve.
func (d *Datasource) CheckHealth(ctx context.Context, _ *backend.CheckHealthRequest) (*backend.CheckHealthResult, error) {
	if err := d.client.Health(ctx); err != nil {
		return &backend.CheckHealthResult{
			Status:  backend.HealthStatusError,
			Message: fmt.Sprintf("Could not reach OpenObserve: %v", err),
		}, nil
	}
	msg := "Connected to OpenObserve"
	if d.settings.DefaultStream == "" {
		msg += " (tip: set a default traces stream in settings)"
	}
	return &backend.CheckHealthResult{Status: backend.HealthStatusOk, Message: msg}, nil
}

// CallResource exposes stream/schema discovery to the query editor.
func (d *Datasource) CallResource(ctx context.Context, req *backend.CallResourceRequest, sender backend.CallResourceResponseSender) error {
	path := strings.Trim(strings.SplitN(req.Path, "?", 2)[0], "/")
	switch path {
	case "streams":
		streams, err := d.client.ListStreams(ctx, "traces")
		if err != nil {
			return sendJSON(sender, http.StatusBadGateway, map[string]string{"error": err.Error()})
		}
		return sendJSON(sender, http.StatusOK, map[string]any{"streams": streams})

	case "schema":
		stream := schemaStreamParam(req.URL)
		if stream == "" {
			return sendJSON(sender, http.StatusBadRequest, map[string]string{"error": "stream is required"})
		}
		schema, err := d.client.GetSchema(ctx, "traces", stream)
		if err != nil {
			return sendJSON(sender, http.StatusBadGateway, map[string]string{"error": err.Error()})
		}
		return sender.Send(&backend.CallResourceResponse{
			Status:  http.StatusOK,
			Headers: map[string][]string{"Content-Type": {"application/json"}},
			Body:    schema,
		})

	default:
		log.DefaultLogger.Debug("unknown resource path", "path", req.Path)
		return sender.Send(&backend.CallResourceResponse{Status: http.StatusNotFound})
	}
}

// schemaStreamParam extracts and URL-decodes the "stream" query parameter from
// a resource URL.
func schemaStreamParam(rawURL string) string {
	u, err := url.Parse(rawURL)
	if err != nil {
		return ""
	}
	return u.Query().Get("stream")
}

func sendJSON(sender backend.CallResourceResponseSender, status int, body any) error {
	b, err := json.Marshal(body)
	if err != nil {
		return err
	}
	return sender.Send(&backend.CallResourceResponse{
		Status:  status,
		Headers: map[string][]string{"Content-Type": {"application/json"}},
		Body:    b,
	})
}
