# PLAN

> **Authority note.** The business request quoted below has been normalized
> into [`REQUIREMENTS.md`](REQUIREMENTS.md) — the authoritative product
> contract (requirement IDs PR/CF/SQ/TR/CR/SR/DV/CP and Gates A–D). Where this
> document and the contract disagree, the contract wins. This file records the
> raw request history, interpretation, and design rationale (the _why_);
> [`IMPLEMENT_PLAN.md`](IMPLEMENT_PLAN.md) holds phasing and status.

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

### Interpretation of the 17 Jul 26 request

Emulate GR's production shape locally: a docker-compose stack with an
S3-compatible object store (**RustFS**) as o2's storage backend, **OpenObserve**
itself, an **OTel Collector** as the ingest path, and Grafana running this
plugin — plus scripts that generate simulated trace data, so the plugin can be
developed and validated without access to GR infrastructure.

The referenced
[grafana-incremental-trace-viewer](https://github.com/G-Research/grafana-incremental-trace-viewer)
repo is **inspiration only** — it demonstrates the *idea* of preload scripts
that seed a local Grafana with data for development. Its scripts target a
different setup and are not expected to be reused as-is (they'd need
modification anyway); we build our own OTLP-native generator tailored to
OpenObserve and this plugin's feature set
([`dev/seed/generate-traces.mjs`](dev/seed/generate-traces.mjs)), borrowing
patterns from the reference where they fit.

See [`IMPLEMENT_PLAN.md`](IMPLEMENT_PLAN.md) for the phased plan this implies.

## Decisions taken

- **New, standalone data source plugin with a Go backend** (not an extension of
  the existing o2 plugins) — PR-01, CF-02, SR-01.
- **No live OpenObserve instance available yet** — build against the
  source-derived spec and gate correctness behind `docs/VALIDATION.md`.
  _Superseded 17 Jul 26:_ the local emulation stack (IMPLEMENT_PLAN.md
  Phases 1–2) made the validation gate runnable locally; only §8 live
  acceptance and the GR-instance re-check remain open.
- **Scope:** trace search + trace-by-id waterfall (core, PR-04/SQ-01/TR-01..04),
  plus a span-level node graph (TR-07 constraint: never presented as a Tempo
  service graph), a Tempo-style search builder (SQ-02..SQ-07), and trace-to-logs
  correlation **only if GR confirms target log streams** (CR-01, COULD).
- **Build against Grafana 13.x locally**; the supported Grafana/OpenObserve
  versions and the signing/distribution form are pending GR confirmation
  (CP-01, Gate D, "Required Business Inputs from GR" in REQUIREMENTS.md).
- **(17 Jul 26) Local emulation stack** — docker-compose with RustFS (S3),
  OpenObserve, OTel Collector, Grafana, and a **custom** OTLP trace generator.
  The incremental-trace-viewer scripts serve as the idea/reference, not as code
  to adopt.

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
  **trace** frame. Per SR-02, no raw user input reaches that SQL: trace IDs are
  validated as strict 32-hex before insertion, stream names are quoted, and all
  search filter values are escaped/structured — there is no raw-SQL escape
  hatch.
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
  _CONFIRMED 2026-07-17_ against o2 v0.91.2 (IMPLEMENT_PLAN.md Phase 2 §1;
  fixture `pkg/plugin/testdata/live_trace_v0.91.2.json`) — risk retired for the
  local stack; the GR-production spot-check remains in Phase 5.

### 6. Milestones

Live status and phasing belong to [`IMPLEMENT_PLAN.md`](IMPLEMENT_PLAN.md); the
milestone scope was:

- **M0** Scaffold + config + health (CF-01..CF-05)
- **M1** Trace-by-id waterfall (TR-01..TR-04)
- **M2** Search → table → drill-down link (SQ-01..SQ-07, PR-04)
- **M3** Stream/field discovery via `CallResource` (CF-04; schema-driven tag
  classification still heuristic — IMPLEMENT_PLAN.md Phase 3)
- **M4** Span-level node graph (TR-07)
- **M5** Hardening + adversarial review (SR-01..SR-08) — the 2026-07 review
  confirmed and fixed 6 bugs; trace-to-logs end-to-end remains pending and
  conditional on GR input (CR-01, IMPLEMENT_PLAN.md Phase 3)

### 7. Open questions / extension points

_Add detail here as we learn more from a live instance._

- ~~Validate every conversion in `docs/VALIDATION.md` (blocking).~~ Done for
  the local stack 2026-07-17 (§§0–7); only §8 live acceptance and the
  GR-production re-check remain (IMPLEMENT_PLAN.md Phase 2/5).
- Replace the `serviceTags` vs `tags` **prefix heuristic** with a **schema-driven**
  split using `GET /api/{org}/streams/{stream}/schema` (TR-06;
  IMPLEMENT_PLAN.md Phase 3).
- Confirm auth mode on the target instance (Basic email:password vs
  service-account/API token; SSO-only instances may reject Basic) — Gate D.
- ~~Decide `size = -1` vs the fixed `maxSpansPerTrace` cap for very large
  traces.~~ Decided: fixed 5,000-span cap with a visible truncation warning
  (TR-05/SR-03); revisit only if the §8 live experiment demands it.
- Trace-to-metrics / trace-to-profiles correlations (CR-02 COULD; not in scope
  until GR confirms a metrics workflow).
- Migrate deprecated UI (`DataSourceHttpSettings`, `Select`) to `@grafana/plugin-ui`
  / `Combobox`.
- Signing & distribution decision for GR (private-signed vs unsigned
  allow-list) — CP-02/Gate D.

### 8. Alternatives considered and rejected

- **Frontend-only datasource** — simpler, but untestable transform, browser-held
  credentials, CORS, and no alerting. Rejected.
- **Fork the community backend plugin** — its frame model is wrong for native
  traces; more to undo than to build fresh. Rejected.
- **Legacy single-field `FieldType.trace` (whole-trace-JSON-in-one-cell)** — older
  form; we use the one-row-per-span frame instead.
