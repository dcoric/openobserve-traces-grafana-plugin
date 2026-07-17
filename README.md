# OpenObserve Traces — Grafana data source

A Grafana data source plugin that visualizes distributed traces stored in
[OpenObserve](https://openobserve.ai) (o2) using Grafana's **native trace
view** — the same waterfall/timeline UI the stock Tempo data source uses.

The existing OpenObserve Grafana plugin shows logs and metrics but not traces.
This plugin fills that gap: it queries OpenObserve's trace data over the o2 HTTP
API (SQL search) and transforms the results into the DataFrame format Grafana's
trace view consumes.

> ⚠️ **Read [`docs/VALIDATION.md`](docs/VALIDATION.md) before trusting timings.**
> The span field mapping and time-unit conversions were derived from reading
> OpenObserve's source, not from a live instance. They must be validated against
> a real OpenObserve deployment with a known trace before this is relied on in
> production.

## Features

- **Search** traces by service, span/operation name, duration, error status and
  attribute filters → results table → click a trace to open its waterfall.
- **Trace ID** lookup → full span waterfall with span details, tags, resource
  attributes, events (logs) and links (references).
- **Node graph** (optional) — a span-level call graph alongside the waterfall.
- **Trace → logs** correlation — configure a logs data source so spans deep-link
  to correlated logs (rendered by Grafana core from `tracesToLogsV2`).
- Reuses Grafana's HTTP data source settings for **URL, Basic Auth and TLS** —
  credentials stay on the backend, never in the browser.

## Architecture

```
QueryEditor (React) ──► DataSourceWithBackend.query()
                              │  O2Query {queryType, traceId|filters, stream}
                              ▼
                     Go backend (pkg/plugin)
                              │  POST /api/{org}/_search?type=traces
                              ▼
                        OpenObserve
                              │  hits[] (one row per span / per trace)
                              ▼
            transform.go ── ns/µs → ms, parse events/links JSON,
                            classify tags vs resource attrs
                              ▼
        trace frame (preferredVisualisationType = "trace")  ──► Grafana TraceView
        table frame (with drill-down data link)             ──► Explore table
        node-graph frames (nodeGraph)                        ──► node graph tab
```

| Layer | Location | Responsibility |
|-------|----------|----------------|
| Frontend | [`src/`](src/) | Query editor (search builder + trace-id), config editor, query model |
| Backend | [`pkg/`](pkg/) | Auth, OpenObserve API calls, SQL generation, the trace-frame transform |

The transform lives in Go ([`pkg/plugin/transform.go`](pkg/plugin/transform.go))
so the unit conversions are unit-tested and credentials never reach the browser.

## OpenObserve API contract

| Purpose | Call |
|---------|------|
| Search (table) | `POST /api/{org}/_search?type=traces` with a `GROUP BY trace_id` aggregation |
| Trace by id | `POST /api/{org}/_search?type=traces` — `SELECT * FROM "{stream}" WHERE trace_id='{id}' ORDER BY start_time` |
| Stream list | `GET /api/{org}/streams?type=traces` |
| Schema | `GET /api/{org}/streams/{stream}/schema?type=traces` |
| Health | `GET /api/{org}/streams?type=traces` |

`start_time`/`end_time` request params are **microseconds** since epoch.

## Field mapping & time units

OpenObserve stores span timestamps in **three different units**. The transform
handles each explicitly; absolute timestamps additionally use magnitude
detection so they survive a unit change between OpenObserve versions.

| Grafana field (ms) | OpenObserve column | Conversion |
|---|---|---|
| `startTime` | `start_time` (nanoseconds) | magnitude-detected → ms |
| `duration` | `duration` (microseconds) | ÷ 1000 |
| `logs[].timestamp` | event `_timestamp` (nanoseconds) | magnitude-detected → ms |
| `parentSpanID` | `reference_parent_span_id` | as-is (empty ⇒ root) |
| `kind` | `span_kind` | `0..5` or `SPAN_KIND_*` → name |
| `statusCode` | `status_code` / `span_status` | int, or derived from string |
| `tags` | flattened span attributes (+ synthetic `error`) | parsed values |
| `serviceTags` | resource-attribute columns (`service_*`, `k8s_*`, …) | heuristic split |
| `logs` / `references` | `events` / `links` | JSON-string → parsed array |

See [`docs/VALIDATION.md`](docs/VALIDATION.md) for which of these need
confirming against a live instance.

## Build & run

Requires Node ≥ 22, Go ≥ 1.24, and [mage](https://magefile.org).

```bash
npm install
npm run build            # frontend → dist/
mage -v build:linux      # backend  → dist/gpx_openobserve_traces_linux_amd64
                         # (use build:darwinARM64 etc. for local dev)
npm run server           # docker compose: Grafana with the plugin mounted
```

Open http://localhost:3000 → Connections → Data sources → **OpenObserve Traces**.

### Test / lint

```bash
go test ./pkg/...        # transform + SQL unit tests
npm run typecheck
npm run lint
```

## Configuration

1. **URL** — the OpenObserve base URL (self-hosted default `http://localhost:5080`).
2. **Auth** — enable *Basic auth*; user = your o2 email (or a service-account /
   API token's identity), password = the o2 password or token.
3. **Organization** — the o2 org id (default `default`).
4. **Default traces stream** — the stream queried when a query omits one
   (usually `default`).
5. *(optional)* **Node graph**, **Trace to logs**.

## Status & known limitations

- **Not yet validated against a live OpenObserve instance** — see
  [`docs/VALIDATION.md`](docs/VALIDATION.md). This is the top priority before use.
- `serviceTags` vs `tags` split is a prefix heuristic; a schema-driven split (via
  the `schema` resource) is planned.
- Trace-by-id widens the dashboard time range by ±5 min; a trace far outside the
  selected range may not be found (set an appropriate range).
- The plugin is unsigned. For internal use either sign it as a *Private* plugin
  or add its id to `allow_loading_unsigned_plugins` in `grafana.ini`.
- `DataSourceHttpSettings` and `Select` raise deprecation warnings under Grafana
  13; functional, slated to migrate to `@grafana/plugin-ui` / `Combobox`.
