# OpenObserve Traces — Grafana data source

A Grafana data source plugin that visualizes distributed traces stored in
[OpenObserve](https://openobserve.ai) (o2) using Grafana's **native trace
view** — the same waterfall/timeline UI the stock Tempo data source uses.

The existing OpenObserve Grafana plugin shows logs and metrics but not traces.
This plugin fills that gap: it queries OpenObserve's trace data over the o2 HTTP
API (SQL search) and transforms the results into the DataFrame format Grafana's
trace view consumes.

> **Validation status:** maintained in one place —
> [`docs/VALIDATION.md`](docs/VALIDATION.md). Settled evidence: the local o2
> v0.91.2 run (2026-07-17) confirmed the field mappings and `duration` = µs.
> Everything still open (packaging, runtime E2E, live checks, GR rollout) is
> listed in that file — trust it over any status prose found elsewhere.

## Features

- **Search** traces by service, span/operation name, duration, error status and
  attribute filters → results table → click a trace to open its waterfall.
- **Trace ID** lookup → full span waterfall with span details, tags, resource
  attributes, events (logs) and links (references).
- **Node graph** (optional) — a span-level graph of the spans in the opened
  trace, alongside the waterfall. It shows span relationships, not a
  Tempo-style service graph.
- **Trace → logs** link configuration (`tracesToLogsV2`, rendered by Grafana
  core) — pending GR confirmation of target log streams/labels and not yet
  validated end-to-end.
- Reuses Grafana's HTTP data source settings for **URL, Basic Auth and TLS** —
  credentials stay on the backend, never in the browser.
- Structured search has no raw SQL/`rawWhere` escape hatch. Search requests are
  capped at 500 traces and warn when a page fills the requested limit; trace
  lookup is capped at 5,000 spans and warns when OpenObserve reports more total
  spans than were returned.

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

| Layer    | Location       | Responsibility                                                         |
| -------- | -------------- | ---------------------------------------------------------------------- |
| Frontend | [`src/`](src/) | Query editor (search builder + trace-id), config editor, query model   |
| Backend  | [`pkg/`](pkg/) | Auth, OpenObserve API calls, SQL generation, the trace-frame transform |

The transform lives in Go ([`pkg/plugin/transform.go`](pkg/plugin/transform.go))
so the unit conversions are unit-tested and credentials never reach the browser.

## OpenObserve API contract

| Purpose        | Call                                                                                                         |
| -------------- | ------------------------------------------------------------------------------------------------------------ |
| Search (table) | `POST /api/{org}/_search?type=traces` with a conditional-aggregate `GROUP BY trace_id` query                 |
| Trace by id    | `POST /api/{org}/_search?type=traces` — `SELECT * FROM "{stream}" WHERE trace_id='{id}' ORDER BY start_time` |
| Stream list    | `GET /api/{org}/streams?type=traces`                                                                         |
| Schema         | `GET /api/{org}/streams/{stream}/schema?type=traces`                                                         |
| Health         | `GET /api/{org}/streams?type=traces`                                                                         |

`start_time`/`end_time` request params are **microseconds** since epoch.

## Field mapping & time units

OpenObserve stores span timestamps in **three different units**. The transform
handles each explicitly; absolute timestamps additionally use magnitude
detection so they survive a unit change between OpenObserve versions.

| Grafana field (ms)    | OpenObserve column                                   | Conversion                                                       |
| --------------------- | ---------------------------------------------------- | ---------------------------------------------------------------- |
| `startTime`           | `start_time` (nanoseconds)                           | magnitude-detected → ms                                          |
| `duration`            | `duration` (microseconds)                            | ÷ 1000                                                           |
| `logs[].timestamp`    | event `_timestamp` (nanoseconds)                     | magnitude-detected → ms                                          |
| `parentSpanID`        | `reference_parent_span_id`                           | as-is (empty ⇒ root)                                             |
| `kind`                | `span_kind`                                          | `0..5` or `SPAN_KIND_*` → name                                   |
| `statusCode`          | `status_code` / `span_status`                        | int, or derived from string                                      |
| `tags`                | flattened span attributes (+ synthetic `error`)      | parsed values                                                    |
| `serviceTags`         | resource-attribute columns (`service_*`, `k8s_*`, …) | current heuristic split; schema-driven classification is pending |
| `logs` / `references` | `events` / `links`                                   | JSON-string → parsed array                                       |

See [`docs/VALIDATION.md`](docs/VALIDATION.md) for which of these need
confirming against a live instance.

## Build & run

Requires Node 22, Go 1.26.3 (from `go.mod`), and [Mage](https://magefile.org).

```bash
npm install
npm run build              # frontend → dist/
mage -v build:linuxARM64   # backend for the container (Apple Silicon)
                           # use build:linux on x86_64 hosts / CI
npm run server             # docker compose: the FULL local stack
npm run seed               # (re)generate simulated traces any time
npm run test:ci             # Jest unit/component tests
npm run e2e                 # authored Grafana E2E specs (fresh backend required)
```

`dist/` is git-ignored; a clean checkout must rebuild the frontend and the
architecture-specific backend before starting Grafana. The current integration
environment has stale backend binaries and no host Mage, so runtime E2E is not
yet an acceptance result.

`npm run server` brings up the complete local emulation of the production
stack — RustFS (S3) ← OpenObserve ← OTel Collector ← trace simulator — plus
Grafana with the plugin and a provisioned datasource. Compose binds published
ports to `127.0.0.1` by default and seeds ~200 normal traces plus a deterministic
5,001-span trace. Set `DEV_BIND_ADDRESS=0.0.0.0` only for deliberate remote
exposure on a trusted network; the dev stack uses known credentials and
anonymous Grafana. See
[`docs/DEV-ENVIRONMENT.md`](docs/DEV-ENVIRONMENT.md) for URLs, credentials,
seeding knobs and troubleshooting.

Open http://localhost:3000 → Explore → **OpenObserve Traces**.

**➡️ [`docs/MANUAL-TESTING.md`](docs/MANUAL-TESTING.md)** is the step-by-step
walkthrough for running and testing everything by hand — what to click in
Explore, what a correct result looks like, and how to poke each layer
(o2 API, S3 bucket, plugin health) directly.

### Test / lint

```bash
go test ./pkg/...        # transform + SQL unit tests
npm run typecheck
npm run lint
npm run test:ci
```

## Configuration

1. **URL** — the OpenObserve base URL (self-hosted default `http://localhost:5080`).
2. **Auth** — enable _Basic auth_; user = your o2 email (or a service-account /
   API token's identity), password = the o2 password or token.
3. **Organization** — the o2 org id (default `default`).
4. **Default traces stream** — the stream queried when a query omits one
   (usually `default`).
5. _(optional)_ **Node graph**, **Trace to logs**.

## Status & known limitations

Live validation status is tracked in [`docs/VALIDATION.md`](docs/VALIDATION.md);
stable limitations:

- The prior local v0.91.2 mapping run is not a fresh acceptance of the hardened
  backend. Fresh Mage build, runtime E2E, live cap/window checks, and GR
  version/auth rollout validation remain pending.
- `serviceTags` vs `tags` is still a prefix heuristic; schema-driven tags are
  planned.
- Trace-to-logs configuration is present, but a logs source, emitted logs, and
  end-to-end correlation have not been validated pending GR confirmation of
  log streams/labels.
- Trace-by-ID widens the dashboard time range by ±5 min. Trace detail is capped
  at 5,000 spans with a visible truncation warning; pagination/unlimited size is
  not implemented or claimed. Search pages are capped at 500 traces and warn
  when a page fills the requested limit.
- Seed IDs are deterministic when `SEED_RANDOM_SEED` is fixed, while timestamps
  use current time by default. Re-running with the same seed reuses IDs at new
  timestamps; use a different seed or reset volumes for a clean dataset.
- `DataSourceHttpSettings` and `Select` raise deprecation warnings under
  Grafana 13; migration to `@grafana/plugin-ui` / `Combobox` is pending.
- Release tags require `GRAFANA_ACCESS_POLICY_TOKEN`; the release workflow
  refuses to publish when it is absent. A signed artifact has not yet been
  produced in this workspace.
