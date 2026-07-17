# PLAN

## Original request

> GR is using openobserve. Openobserve or short o2 has grafana plugin that has
> its own view:
> https://openobserve.ai/docs/administration/maintenance/operator-guide/openobserve-plugin-for-grafana/
> This plugin is in use, but it shows metrics and logs, but no traces. GR wants
> to build plugins to show traces. All related to traces is sql in o2, so we
> need to build the view just like grafana has for tempo (grafana stock) that
> uses o2 api and visualizes traces.

## New request info 17. July 26.

They are using S3 bucket to store files (I guess metrics are dumped there) and use open observe & otel to read and grafana to display.

We should make some local emulation of that - preferably docker compose setup, rust fs for S3, and keep open observe and otel;

It would be perfect if we can generate simulation data for displaying it localy. 

For idea check scripts I did with nojaf in this https://github.com/G-Research/grafana-incremental-trace-viewer/ where we used scripts to preload some data in grafana.
 
## Interpretation

Build a Grafana plugin that visualizes OpenObserve (o2) distributed **traces**
in Grafana's native trace view — the same waterfall/timeline UI the stock
**Tempo** data source provides — by querying OpenObserve's trace data over its
HTTP API (SQL search). The existing official OpenObserve Grafana plugin covers
logs and metrics only; this fills the traces gap.

## Decisions taken

- **New, standalone data source plugin with a Go backend** (not an extension of
  the existing o2 plugins).
- **No live OpenObserve instance available yet** — build against the
  source-derived spec and gate correctness behind `docs/VALIDATION.md`.
- **Scope:** trace search + trace-by-id waterfall (core), plus node/service
  graph, trace-to-logs correlation, and a Tempo-style search builder.
- **Target latest Grafana (>= 12.x)**; distribute unsigned (allow-list) in dev,
  private-signed for rollout.

See [`README.md`](README.md) for the architecture and API contract, and
[`docs/VALIDATION.md`](docs/VALIDATION.md) for the live-instance sign-off gate.

---

## Reasoning & design rationale

_This section records the "why" behind the decisions above. Extend it with more
detail as the project evolves._

### 1. Why a new plugin, not an extension of the existing ones

- The **official** OpenObserve plugin (`openobserve/openobserve-grafana-plugin`)
  is frontend-only, targets Grafana `^9.3.8`, and declares only `logs`/`metrics`
  — no trace support and no path to emit trace frames. Its README also carries an
  ambiguous commercial-license note.
- The **community** plugin (`LinPr/grafana-openobserve-datasource`) has a Go
  backend and *claims* traces, but its transformer only produces log/table frames
  — never Grafana's native trace frame.
- The hard, value-adding part is the **OpenObserve-row → Grafana-trace-frame
  transform**. Retrofitting that onto either base is more work and more risk than
  owning a focused tracing datasource end to end.

### 2. Why a Go backend (not frontend-only)

- The transform has several **non-obvious, differing time-unit conversions**
  (span `start_time` = ns, `duration` = µs, event `_timestamp` = ns → Grafana ms)
  plus JSON-string parsing of `events`/`links`. In Go this is **unit-testable**
  (golden tests) rather than untested browser code.
- Credentials (o2 Basic-auth / token) **stay server-side**; the browser never
  holds them, and there is no CORS problem.
- It unlocks future **Grafana Alerting, recorded queries, and query caching**,
  which require a backend.

### 3. How the trace view is actually triggered (the key mechanism)

Grafana's native trace waterfall is **not** a special panel we build. A data
source returns an ordinary `DataFrame` with:
- `meta.preferredVisualisationType = "trace"`, and
- **one row per span**, with the exact field names of `TraceSpanRow`
  (`traceID`, `spanID`, `parentSpanID`, `operationName`, `serviceName`,
  `startTime`, `duration`, `kind`, `statusCode`, `statusMessage`, `serviceTags`,
  `logs`, `references`, `tags`).

Grafana's `TraceView` reads that frame via `DataFrameView<TraceSpanRow>` and
renders the waterfall. `startTime`/`duration` are in **milliseconds**; parent
links come from `parentSpanID` (empty ⇒ root). There is **no** `DataFrameType.Trace`.

### 4. OpenObserve API contract chosen (and why)

- **Search list:** `POST /api/{org}/_search?type=traces` with a `GROUP BY
  trace_id` aggregation (mirrors o2's own `traces/latest` SQL) → a **table** frame
  whose trace-id cell carries an internal data link.
- **Trace by id:** `POST /api/{org}/_search?type=traces` with
  `SELECT * FROM "{stream}" WHERE trace_id='{id}' ORDER BY start_time` → the
  **trace** frame.
- Using the generic `_search` endpoint for both keeps the response shape stable
  and lets us control exactly which columns come back (vs the nested
  `traces/latest` payload). `traces/latest` remains the documented fallback.
- Time-range params are **microseconds**; the clicked-trace drill-down widens the
  window ±5 min so edge-of-range traces are still found (the `trace_id` filter
  keeps results exact regardless of window width).

### 5. The time-unit reasoning (the crux / biggest risk)

OpenObserve stores three different units on a span row. To de-risk the fact that
this was derived from source (no live instance):
- **Absolute timestamps** (`start_time`, `end_time`, event `_timestamp`) use
  **magnitude detection** (ns/µs/ms/s by size) → survives a unit change between
  o2 versions.
- **`duration`** is a *relative* value, so magnitude detection cannot work — it is
  converted as microseconds (`÷ 1000`) and is the **one conversion that must be
  confirmed** against a live trace. This is the top item in `docs/VALIDATION.md`.

### 6. Milestones (as implemented)

- **M0** Scaffold + config + health — done
- **M1** Trace-by-id waterfall — done
- **M2** Search → table → drill-down link — done
- **M3** Stream/field discovery (`CallResource`) — partial (streams done; schema
  endpoint wired, schema-driven tag classification still heuristic)
- **M4** Node/service graph — done (span-level)
- **M5** Hardening + trace-to-logs + adversarial review — done (6 confirmed bugs
  fixed)

### 7. Open questions / extension points

_Add detail here as we learn more from a live instance._

- Validate every conversion in `docs/VALIDATION.md` (blocking).
- Replace the `serviceTags` vs `tags` **prefix heuristic** with a **schema-driven**
  split using `GET /api/{org}/streams/{stream}/schema`.
- Confirm auth mode on the target instance (Basic email:password vs
  service-account/API token; SSO-only instances may reject Basic).
- Decide `size = -1` vs the fixed `maxSpansPerTrace` cap for very large traces.
- Trace-to-metrics / trace-to-profiles correlations (not yet in scope).
- Migrate deprecated UI (`DataSourceHttpSettings`, `Select`) to `@grafana/plugin-ui`
  / `Combobox`.
- Signing & distribution decision for GR (private-signed vs unsigned allow-list).

### 8. Alternatives considered and rejected

- **Frontend-only datasource** — simpler, but untestable transform, browser-held
  credentials, CORS, and no alerting. Rejected.
- **Fork the community backend plugin** — its frame model is wrong for native
  traces; more to undo than to build fresh. Rejected.
- **Legacy single-field `FieldType.trace` (whole-trace-JSON-in-one-cell)** — older
  form; we use the one-row-per-span frame instead.
