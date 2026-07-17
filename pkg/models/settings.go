package models

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/backend/httpclient"
)

// PluginSettings holds the non-secret datasource configuration. Connection
// details (URL, Basic Auth user/password, TLS) are handled by Grafana's
// built-in HTTP datasource settings and read back via HTTPClientOptions, so
// they do not appear here.
type PluginSettings struct {
	// OrgID is the OpenObserve organization id (e.g. "default"). It is part of
	// every OpenObserve API path: /api/{orgId}/...
	OrgID string `json:"orgId"`

	// DefaultStream is the trace stream queried when a query does not specify
	// one (OpenObserve's default traces stream is usually "default").
	DefaultStream string `json:"defaultStream"`

	// NodeGraph enables emitting node-graph frames alongside the trace
	// waterfall for trace-by-id queries.
	NodeGraph bool `json:"nodeGraph"`

	// TracesToLogs is read by Grafana core (jsonData.tracesToLogsV2) to render
	// span -> logs correlation links. It is stored here only for completeness;
	// the backend does not act on it.
	TracesToLogs json.RawMessage `json:"tracesToLogsV2,omitempty"`
}

// LoadPluginSettings unmarshals the datasource instance settings.
func LoadPluginSettings(source backend.DataSourceInstanceSettings) (*PluginSettings, error) {
	settings := PluginSettings{}
	if len(source.JSONData) > 0 {
		if err := json.Unmarshal(source.JSONData, &settings); err != nil {
			return nil, fmt.Errorf("could not unmarshal PluginSettings json: %w", err)
		}
	}
	if settings.OrgID == "" {
		// OpenObserve's default organization.
		settings.OrgID = "default"
	}
	return &settings, nil
}

// NewHTTPClient builds an *http.Client that reuses Grafana's datasource HTTP
// settings: base URL, Basic Auth (user + secure password), custom headers and
// TLS options. Credentials never leave the backend.
func NewHTTPClient(ctx context.Context, source backend.DataSourceInstanceSettings) (*http.Client, error) {
	opts, err := source.HTTPClientOptions(ctx)
	if err != nil {
		return nil, fmt.Errorf("http client options: %w", err)
	}
	return httpclient.New(opts)
}
