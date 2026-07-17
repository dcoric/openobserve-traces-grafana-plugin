package plugin

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
)

// Client is a thin wrapper around the OpenObserve HTTP API. The underlying
// *http.Client is built from Grafana's datasource HTTP settings, so Basic Auth
// and TLS are applied automatically on every request.
type Client struct {
	http    *http.Client
	baseURL string // e.g. http://localhost:5080 (no trailing slash)
	orgID   string
}

// NewClient creates an OpenObserve API client.
func NewClient(httpClient *http.Client, baseURL, orgID string) *Client {
	return &Client{
		http:    httpClient,
		baseURL: strings.TrimRight(baseURL, "/"),
		orgID:   orgID,
	}
}

// searchRequest is the body for POST /api/{org}/_search.
type searchRequest struct {
	Query      searchQuery `json:"query"`
	SearchType string      `json:"search_type,omitempty"`
	Timeout    int64       `json:"timeout,omitempty"`
}

type searchQuery struct {
	SQL string `json:"sql"`
	// StartTime/EndTime are microseconds since epoch.
	StartTime int64 `json:"start_time"`
	EndTime   int64 `json:"end_time"`
	From      int64 `json:"from"`
	Size      int64 `json:"size"`
}

// SearchResponse is the response from /api/{org}/_search. Hits are kept as raw
// per-column messages so numeric precision (nanosecond timestamps) is not lost
// to float64 rounding before we explicitly convert.
type SearchResponse struct {
	Took     int                          `json:"took"`
	Hits     []map[string]json.RawMessage `json:"hits"`
	Total    int                          `json:"total"`
	From     int                          `json:"from"`
	Size     int                          `json:"size"`
	ScanSize float64                      `json:"scan_size"`

	// OpenObserve can return HTTP 200 with these set to signal a degraded
	// result. FunctionError is left raw because its type varies across versions
	// (string vs []string).
	IsPartial     bool            `json:"is_partial"`
	FunctionError json.RawMessage `json:"function_error"`
	NewStartTime  int64           `json:"new_start_time"`
}

// Warning returns a human-readable message if the search succeeded (HTTP 200)
// but returned a partial or function-errored result, else "".
func (sr *SearchResponse) Warning() string {
	var msgs []string
	if sr.IsPartial {
		msgs = append(msgs, "OpenObserve returned a partial result; the query may have been truncated (try a smaller time range)")
	}
	if fe := strings.TrimSpace(string(sr.FunctionError)); fe != "" && fe != "null" && fe != `""` && fe != "[]" {
		msgs = append(msgs, "OpenObserve function error: "+fe)
	}
	return strings.Join(msgs, "; ")
}

// apiError captures OpenObserve's error envelope ({"code":..,"message":..} or
// {"error":..}).
type apiError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Error   string `json:"error"`
	Trace   string `json:"trace_id"`
}

func (e apiError) String() string {
	if e.Message != "" {
		return e.Message
	}
	return e.Error
}

// Search runs a SQL search against the given stream type ("traces").
// start/end are microseconds since epoch.
func (c *Client) Search(ctx context.Context, streamType, sql string, startMicros, endMicros, from, size int64) (*SearchResponse, error) {
	body := searchRequest{
		Query: searchQuery{
			SQL:       sql,
			StartTime: startMicros,
			EndTime:   endMicros,
			From:      from,
			Size:      size,
		},
		// "ui" mirrors how OpenObserve's own UI submits trace searches.
		SearchType: "ui",
	}
	raw, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}

	u := fmt.Sprintf("%s/api/%s/_search?type=%s", c.baseURL, url.PathEscape(c.orgID), url.QueryEscape(streamType))
	respBody, err := c.do(ctx, http.MethodPost, u, raw)
	if err != nil {
		return nil, err
	}

	var sr SearchResponse
	if err := json.Unmarshal(respBody, &sr); err != nil {
		return nil, fmt.Errorf("decode search response: %w", err)
	}
	return &sr, nil
}

// ListStreams returns the stream names of the given type for the org.
func (c *Client) ListStreams(ctx context.Context, streamType string) ([]string, error) {
	u := fmt.Sprintf("%s/api/%s/streams?type=%s", c.baseURL, url.PathEscape(c.orgID), url.QueryEscape(streamType))
	respBody, err := c.do(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	var parsed struct {
		List []struct {
			Name string `json:"name"`
		} `json:"list"`
	}
	if err := json.Unmarshal(respBody, &parsed); err != nil {
		return nil, fmt.Errorf("decode streams response: %w", err)
	}
	names := make([]string, 0, len(parsed.List))
	for _, s := range parsed.List {
		names = append(names, s.Name)
	}
	return names, nil
}

// GetSchema returns the raw schema document for a stream. Used by the query
// editor to discover attribute columns. The shape is passed through verbatim.
func (c *Client) GetSchema(ctx context.Context, streamType, stream string) (json.RawMessage, error) {
	u := fmt.Sprintf("%s/api/%s/streams/%s/schema?type=%s",
		c.baseURL, url.PathEscape(c.orgID), url.PathEscape(stream), url.QueryEscape(streamType))
	return c.do(ctx, http.MethodGet, u, nil)
}

// Health performs a lightweight authenticated call used by CheckHealth.
func (c *Client) Health(ctx context.Context) error {
	u := fmt.Sprintf("%s/api/%s/streams?type=traces", c.baseURL, url.PathEscape(c.orgID))
	_, err := c.do(ctx, http.MethodGet, u, nil)
	return err
}

func (c *Client) do(ctx context.Context, method, u string, body []byte) ([]byte, error) {
	var reader io.Reader
	if body != nil {
		reader = bytes.NewReader(body)
	}
	req, err := http.NewRequestWithContext(ctx, method, u, reader)
	if err != nil {
		return nil, err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("Accept", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request to OpenObserve failed: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	respBody, err := io.ReadAll(io.LimitReader(resp.Body, 256<<20))
	if err != nil {
		return nil, fmt.Errorf("read response body: %w", err)
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		var ae apiError
		if json.Unmarshal(respBody, &ae) == nil && ae.String() != "" {
			return nil, fmt.Errorf("OpenObserve returned %d: %s", resp.StatusCode, ae.String())
		}
		snippet := string(respBody)
		if len(snippet) > 500 {
			snippet = snippet[:500]
		}
		return nil, fmt.Errorf("OpenObserve returned %d: %s", resp.StatusCode, snippet)
	}
	return respBody, nil
}
