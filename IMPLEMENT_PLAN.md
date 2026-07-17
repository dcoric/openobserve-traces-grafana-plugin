# Implementation plan — from "plugin built" to "goal reached"

Companion to [`PLAN.md`](PLAN.md) (the _why_). This file is the _what next_:
what the 17 July 2026 request changes about our approach, and the concrete
phases that take the project to its goal.

**Goal.** GR runs OpenObserve (o2) backed by an S3 bucket, fed by OTel, and
displayed in Grafana. Deliver a Grafana data source plugin that shows o2
**traces** in Grafana's native trace view (like Tempo), _proven to work_ against
a stack shaped like GR's — first a local emulation, then the real deployment.

---

## Roadmap start → end (at a glance)

```
 START (Jun 26)                                                        GOAL
   │                                                                     │
   ▼                                                                     ▼
 ┌─────────────┐  ┌──────────────┐  ┌────────────┐  ┌────────────┐  ┌──────────┐  ┌────────────┐
 │ Phase 0     │  │ Phase 1      │  │ Phase 2    │  │ Phase 3    │  │ Phase 4  │  │ Phase 5    │
 │ Build the   │  │ Local stack: │  │ Execute    │  │ Schema-    │  │ e2e      │  │ Rollout:   │
 │ plugin      │  │ RustFS(S3) + │  │ validation │  │ driven tags│  │ tests +  │  │ GR's real  │
 │ M0–M5, from │  │ o2 + OTel +  │  │ gate vs    │  │ trace→logs │  │ CI on    │  │ o2, auth,  │
 │ o2 source   │  │ Grafana +    │  │ live local │  │ UI migr.,  │  │ seeded   │  │ signing,   │
 │ (no live    │  │ simulated    │  │ o2; fix    │  │ size cap   │  │ stack    │  │ handover   │
 │ instance)   │  │ trace data   │  │ transform  │  │            │  │          │  │            │
 └─────────────┘  └──────────────┘  └────────────┘  └────────────┘  └──────────┘  └────────────┘
    ✅ DONE           ✅ DONE          ⚠️ partial      pending        pending       pending
                                          ▲
                                          │
                                ██ WE ARE HERE ██
   (stack and hardening paths verified in code/tests 17 Jul: duration=µs
    CONFIRMED; Phase 2 sign-off remains open for fresh rebuilt-backend
    acceptance and the §8 live cap/window check)
```

Sequenced by risk: Phase 1+2 attack the project's biggest unknown (source-derived
field/unit mapping never checked against a running o2). Phases 3–4 harden and
automate. Phase 5 is the only part that needs anything from GR.

---

## Where we are

| Done                                                                                                                                                                                                                                           | Where                                                               |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Data source plugin core, M0–M4 plus part of M5 (search → table → waterfall, node graph, events/links)                                                                                                                                          | `src/`, `pkg/`                                                      |
| Unit-tested transform (o2 rows → Grafana trace frames)                                                                                                                                                                                         | `pkg/plugin/transform.go` + tests                                   |
| Validation checklist prior local run recorded against o2 v0.91.2; current §6 implementation is unit-tested, while fresh runtime and §8 live acceptance remain open                                                                             | `docs/VALIDATION.md`                                                |
| Trace simulator: multi-service OTLP/JSON generator (8 emitted resource services, 3 scenarios, errors + events + cross-trace links); deterministic random sequence with current-time timestamps by default and optional `REFERENCE_TIME_MS`     | `dev/seed/generate-traces.mjs`                                      |
| Datasource provisioning pointed at the in-compose o2                                                                                                                                                                                           | `provisioning/datasources/datasources.yml`                          |
| Locally generated backend binaries incl. `linux_arm64` for the dev container (`dist/` is ignored and must be rebuilt in a clean checkout)                                                                                                      | `dist/`                                                             |
| **Local emulation stack, verified end-to-end** (RustFS S3 + o2 v0.91.2 + OTel Collector + Grafana + seed)                                                                                                                                      | `docker-compose.yaml`, `dev/`, `docs/DEV-ENVIRONMENT.md`            |
| **Validation gate implementation mostly complete** — native frames and `duration`=µs confirmed; aggregate semantics, fixture regression, cap warning, and large-trace seed are covered in code/tests; fresh runtime §8 acceptance remains open | `docs/VALIDATION.md`, `pkg/plugin/testdata/live_trace_v0.91.2.json` |

---

## What the 17 July info changes — do differently

1. **Stop treating "no live instance" as an external blocker.**
   Original decision: _build against source-derived spec, gate on a future live
   instance_. New approach: **build the live instance ourselves** — a docker
   compose emulation of GR's stack (S3 → o2 → OTel → Grafana). The
   `docs/VALIDATION.md` gate becomes something we run locally this week, not a
   hand-off to another team.

2. **Mirror GR's production shape, not the easiest local setup.**
   The obvious local setup (o2 on local disk) would skip S3 entirely. GR runs
   o2 **on an S3 bucket** — so the emulation uses a real S3 API server
   (**RustFS**, S3-compatible, Rust) as o2's object store. If S3-backed o2
   behaves differently (query latency, WAL flush timing, result completeness),
   we want to see it in dev.

3. **Ingest through OTel, not by writing rows into o2 directly.**
   Simulated traces enter via OTLP → **OTel Collector** → o2's OTLP endpoint —
   the same path GR's real spans take. This validates our column assumptions
   against what o2's _actual OTLP ingest pipeline_ materializes (span_kind
   values, `reference_parent_span_id`, flattened attribute names, `events`/
   `links` encoding) instead of what we inferred from reading its source.

4. **Simulation data is a first-class deliverable.** The
   [grafana-incremental-trace-viewer](https://github.com/G-Research/grafana-incremental-trace-viewer)
   scripts are the _idea_ to borrow — preload a local Grafana with generated
   data so anyone can develop against it — **not code to reuse**: they were
   written for a different backend/setup and would need modification anyway.
   So we build our own OTLP-native generator
   (`dev/seed/generate-traces.mjs`), tailored to what _this_ plugin must
   exercise: multi-service topology (node graph), error spans + exception
   events (status coloring, span logs), span links across traces
   (references), PRODUCER/CONSUMER kinds, varied durations and a wide time
   spread (search filters), deterministic seed (repeatable e2e tests). We
   still mine the reference repo for useful patterns (invocation ergonomics,
   data shapes) and adapt, rather than adopt.

5. **Golden tests get re-grounded.** Current fixtures in
   `pkg/plugin/transform_test.go` encode our _assumptions_. Once the stack is
   up, capture real `_search` responses (per `docs/VALIDATION.md` §0) and make
   them the fixtures. Any diff between assumption and reality becomes a failing
   test first, then a transform fix.

6. **E2E becomes possible and CI-able.** With a deterministic seeded stack,
   `@grafana/plugin-e2e` tests can assert real behaviour (search returns rows,
   clicking a trace renders a waterfall with N spans) instead of mocks — and
   the same compose file can run in GitHub Actions.

---

## Phase 1 — local emulation stack ✅ done (17 Jul 26)

Everything lives in the existing `docker-compose.yaml` (extended) + a new
`dev/` directory; `.config/` stays untouched (managed by plugin tools).

Topology (one `docker compose up` / `npm run server`):

```
 seed (one-shot, node:22-alpine)
   │ OTLP/JSON http :4318
   ▼
 otel-collector (contrib)  ── otlp exporter + Basic auth ──►  openobserve :5080/:5081
   ▲ OTLP grpc :4317                                            │ object store (S3 API)
   │ (host apps can also point here)                            ▼
 grafana :3000 (plugin dev image, provisioned datasource) ── rustfs :9000 (+ bucket bootstrap)
```

Tasks:

- [x] `rustfs` service: `rustfs/rustfs:1.0.0-beta.10`, keys via env, named
      volume (runs as 10001:10001), `/health` healthcheck; bucket bootstrap via
      one-shot `minio/mc` sidecar (`mc mb -p`, idempotent) — RustFS has no
      built-in bucket env, and o2 does not create its bucket.
- [x] `openobserve` service: `v0.91.2`; root user env; `ZO_LOCAL_MODE_STORAGE=s3` + `ZO_S3_*` pointed at `http://rustfs:9000` (path-style is o2's default);
      `/data` volume for WAL/meta; dev knobs `ZO_MAX_FILE_RETENTION_TIME=60`
      (observable S3 writes) and `ZO_INGEST_ALLOWED_UPTO=24` (backdated seeds).
      Healthcheck via `/openobserve node status` — the image is distroless
      (no curl/shell; the `main`-branch Dockerfile has curl, v0.91.2 does not).
- [x] `otel-collector` service: contrib `0.156.0`;
      `dev/otel-collector/config.yaml` — OTLP grpc+http in, `otlphttp` out to
      `http://openobserve:5080/api/default` (no trailing slash) with Basic auth;
      logs pipeline stubbed for Phase 3 trace-to-logs.
- [x] `seed` service: one-shot `node:22-alpine` running
      `dev/seed/generate-traces.mjs`; re-runnable via
      `docker compose run --rm seed` / `npm run seed`.
- [x] `grafana` service: plugin-dev image + `depends_on: openobserve`;
      provisioned datasource works.
- [x] Ports documented (3000/2345 grafana, 4317/4318 collector, 5080/5081 o2,
      9000/9001 rustfs); image pins recorded in `docs/DEV-ENVIRONMENT.md`.
- [x] `docs/DEV-ENVIRONMENT.md` written (start, seed, wipe, S3 verification,
      troubleshooting incl. RustFS→MinIO escape hatch).
- [x] npm script `npm run seed`.

**Acceptance — core stack met 17 Jul 26:** stack up from clean state; seed delivered
1,260/1,260 spans (236 traces, zero loss); RustFS bucket contains o2-written
trace Parquet + index objects; plugin health check passes; search (with
service/error filters) and trace-by-id both return frames through the real
plugin backend; Explore renders the 4-span waterfall; trace still fully
readable after an o2 restart (forced S3 reads). This historical runtime check
predates the query hardening; fresh filtered-summary acceptance remains in
Phase 2.

## Phase 2 — execute the validation gate ⚠️ partial (17 Jul 26) **← we are here**

Run `docs/VALIDATION.md` §0–§8 against the local stack. This is the highest-
value work in the project — it converts every "assumed" into "verified" or
"fixed". Detailed results live in `docs/VALIDATION.md`'s sign-off section.

- [x] §0 ground truth captured and wired into
      `transform_fixture_test.go` as a regression fixture:
      `pkg/plugin/testdata/live_trace_v0.91.2.json`.
- [x] §1 time units — **`duration` = µs CONFIRMED** on real data
      (`end−start` = 27,929,851 ns vs `duration` = 27,929; plugin renders
      27.929 ms). `start_time`/event `_timestamp` are ns as assumed.
- [x] §2 parent/child — `reference_parent_span_id` on children, absent on root.
- [x] §3 kinds/status — string digits + `OK`/`ERROR`/`UNSET` + int codes, as
      assumed.
- [x] §4 attribute split — finding: v0.91.2 prefixes **all** resource attrs
      uniformly with `service_`; heuristic classifies real data correctly, and
      the schema-driven split (Phase 3) is now lower-risk than assumed.
- [x] §5 `events`/`links` — JSON strings; event attr keys keep dots; link
      `context.{traceId,spanId}` camelCase. Parsed correctly.
- [x] §6 search aggregation implementation — conditional `HAVING` retains all
      spans for selected traces, combines span filters in one same-span CASE,
      and keeps duration bounds at trace level; Go tests cover the SQL shape.
      Fresh runtime acceptance against a rebuilt backend remains pending.
- [x] §7 auth — Basic root email:password works for queries AND OTLP ingest.
- [x] §8 implementation coverage — deterministic `LARGE_TRACE_SPAN_COUNT`
      seed (compose default 5001), current-time ingestion, and total-vs-hits
      truncation warnings are covered by code/tests and local stub evidence.
- [ ] §8 live acceptance — verify the 5000-span backend behavior and an
      edge-of-time-window trace against a freshly built backend; no pagination
      or unlimited-size behavior is claimed.
- [x] `README.md` status text distinguishes prior local v0.91.2 validation
      from current hardening and pending fresh-backend/GR acceptance.
- [ ] Phase 2 sign-off — implementation and fixture work are complete, but
      fresh Mage backend/runtime validation, §8 live behavior, and GR rollout
      remain open.

## Phase 3 — improvements unblocked by a real instance _(pending)_

Priority order:

- [ ] **Schema-driven `serviceTags` vs `tags` split** — replace the prefix
      heuristic using `GET /api/{org}/streams/{stream}/schema` (resource wiring
      already exists in `datasource.go`). Now testable against real schemas.
- [x] Search limit policy is explicit: requests above 500 are rejected;
      trace detail remains capped at 5000 and warns when `total > hits`.
      Pagination/unlimited-size behavior is not implemented or claimed.
- [ ] Decide whether a different trace-detail/pagination policy is needed
      after the §8 live experiment.
- [ ] Trace-to-logs end-to-end: ship logs from the collector into o2 too (same
      pipeline), provision an o2 logs datasource, and verify span→logs links.
      _(The official o2 plugin or a Loki-compatible source — decide when here.)_
- [ ] Migrate deprecated `DataSourceHttpSettings` / `Select` to
      `@grafana/plugin-ui` / `Combobox`.

## Phase 4 — e2e tests + CI _(implementation complete; runtime pending)_

- [x] Real Jest tests and authored/listable `@grafana/plugin-e2e` specs cover
      datasource save-&-test, structured search, trace lookup, and node graph
      request paths.
- [ ] Runtime `@grafana/plugin-e2e` execution against the newly built backend
      and seeded stack; existing local dist binaries are stale.
- [ ] GitHub Actions job: build plugin → compose up (linux/amd64 binaries
      already built) → seed → run e2e → tear down.
- [x] Keep Jest/unit tests as the fast path and authored E2E specs listable;
      make runtime E2E the merge gate once the fresh backend path is available.

## Phase 5 — rollout to GR _(pending, needs GR input)_

- [ ] Get the exact o2 version GR runs; pin the same tag in compose and re-run
      Phase 2 against it (versions may differ in column names/SQL support).
- [ ] Confirm GR's auth mode (Basic vs service-account token vs SSO-only) and
      org/stream naming; adjust docs/defaults.
- [ ] Point a datasource at the real instance; re-run the §1 timing check on a
      real production trace (final sign-off).
- [ ] Signing & distribution: private-signed plugin vs
      `allow_loading_unsigned_plugins`; pick, document install steps.
- [ ] Handover docs for GR ops (install, upgrade, config reference).

---

## Fidelity gaps — where the emulation can lie to us

Track these; none invalidate local validation, but all need a check against the
real deployment in Phase 5:

| Gap                                                  | Risk                                                                                                                                                      |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RustFS ≠ AWS S3                                      | o2↔S3 quirks (path-style, multipart, list semantics) may differ; storage-layer only, shouldn't affect the API our plugin consumes.                        |
| Single-node o2 vs GR's (likely clustered) deployment | Query routing/completeness differences; `_search` API contract should be identical.                                                                       |
| o2 version drift                                     | Column names, SQL features, OTLP handling can change between versions — pin GR's version as soon as known.                                                |
| Simulated vs real spans                              | Real instrumentations emit messier data (missing parents, huge attrs, clock skew). Add a "messy" scenario to the generator if Phase 2 passes too cleanly. |
| Local root-user Basic auth vs GR auth                | GR may be SSO/service-account only — Phase 5 item.                                                                                                        |

## Open questions for GR (ask when convenient, none block Phases 1–4)

1. Exact OpenObserve version + deployment mode (single/cluster, HA)?
2. Auth for programmatic API access (Basic? service account token? SSO-only)?
3. o2 organization + traces stream names in use?
4. Which Grafana version is the target (we build against 13.x)?
5. Plugin distribution preference: private signing vs unsigned allow-list?
6. Is trace-to-logs correlation wanted at rollout (which logs datasource)?

---

## Review findings and recommendations — 2026-07-17 14:48 CEST

This section records an independent repository-wide review of the plans,
implementation, tests, live local stack, security boundaries, and responsive
Grafana UI. It is a point-in-time status record, not a replacement for the
phase details above.

### Verified status

| Area                    | Status          | Review evidence                                                                                                                 |
| ----------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Phase 0 plugin core     | ✅ Done locally | Backend health, search and trace query paths, native table/trace frames, events/links, and node-graph frames work.              |
| Phase 1 emulation       | ✅ Done locally | RustFS-backed o2, OTel ingest, provisioning, seed, persistence, and restart checks passed.                                      |
| Phase 2 §§0–5 and §7    | ✅ Done locally | Live o2 fixture captured; units, hierarchy, kinds/status, attributes, events/links, and Basic auth verified.                    |
| Phase 2 §6              | ⚠️ Partial      | SQL is accepted and drill-down works, but filtered trace summaries aggregate only matching spans.                               |
| Phase 2 §8              | ❌ Not done     | No >5,000-span or edge-of-time-window acceptance scenario exists.                                                               |
| Live-fixture regression | ❌ Not done     | `live_trace_v0.91.2.json` is committed but unused by tests.                                                                     |
| Trace-to-logs           | ❌ Not done     | Configuration is present, but there is no logs ingest, provisioned logs datasource, or end-to-end verification.                 |
| Phase 4 E2E/CI          | ❌ Not done     | Six repository-authored Playwright specs are stale scaffold tests and fail; Jest reports zero tests while exiting successfully. |
| Phase 5 rollout         | ❌ Not done     | GR version/auth validation, private signing, distribution, and handover remain open.                                            |

### Findings

1. **Security blocker — unrestricted `rawWhere`.** The backend inserts the
   value verbatim into SQL under the datasource's shared credentials. A live
   audit escaped the intended predicate and executed a `UNION` query. The UI
   and backend comments incorrectly describe these as the user's own o2
   credentials.
2. **Correctness blocker — filtered search summaries.** Span-level filters are
   applied before grouping, so a matching trace can report fewer spans, a
   shorter duration, fewer services, and a different error count than its
   trace-by-id waterfall.
3. **Completeness blocker — silent 5,000-span cap.** Trace lookup ignores the
   response total and emits a normal-looking frame when results are truncated.
4. **Test blocker — false-green coverage.** The Playwright suite targets
   scaffold controls that do not exist; the Jest command succeeds with no
   tests; the real o2 fixture is not a regression input.
5. **Local-stack exposure.** Published ports bind to all interfaces while the
   stack uses known credentials, anonymous Grafana Admin, and unauthenticated
   OTLP ingest. This is unsafe on a developer LAN or VPN.
6. **Release hardening is incomplete.** The signing token is job-wide in the
   PR CI job, privileged workflows depend on mutable references/tools, and the
   release workflow can publish an unsigned native-backend plugin.
7. **UI/accessibility gaps.** Fixed field widths make the query and
   configuration editors unusable at 375 px; several plugin-owned controls
   lack programmatic label associations.
8. **Secondary quality gaps.** Search limits are not bounded server-side;
   tag/duration template variables are not interpolated; stream-discovery
   errors are swallowed; seed service-count/reproducibility claims were
   overstated; status documentation contains stale contradictions.

### Recommended execution order

- [ ] **P0 — constrain the SQL boundary:** remove `rawWhere`, parse an
      allowlisted predicate grammar, or explicitly gate arbitrary SQL behind
      trusted-user permissions and a read-only, stream-scoped o2 account.
- [ ] **P0 — fix trace-summary semantics:** select matching trace IDs first,
      then aggregate all spans for those traces; add a regression proving the
      filtered table and drill-down report the same trace totals.
- [ ] **P1 — make truncation explicit and tested:** decide `size: -1` versus a
      documented/paginated cap, compare returned rows with the response total,
      and add >5,000-span plus time-window-edge scenarios.
- [ ] **P1 — replace false-green tests:** wire the captured fixture into Go
      tests, replace all scaffold Playwright specs with seeded-stack scenarios,
      and make zero frontend tests fail CI rather than pass.
- [ ] **P1 — harden development and release paths:** bind local ports to
      loopback by default, make debug/remote exposure opt-in, scope signing
      secrets to protected steps, pin privileged dependencies immutably, and
      require private signing before rollout.
- [ ] **P2 — close product-quality gaps:** cap search limits, apply Grafana
      template variables to every supported query field, surface stream
      discovery errors, make plugin forms responsive, and associate every
      label with its control.
- [ ] **P2 — correct documentation and seed fidelity:** reconcile README and
      validation status text, document that `dist/` must be rebuilt, either
      emit the advertised database services or claim eight services, and pin
      reference time as well as random seed for deterministic E2E data.
- [ ] Re-run the full local validation gate, Playwright E2E suite, security
      review, Mage backend build, and official Grafana validator before
      marking Phase 2 complete or beginning GR rollout.

## Implementation follow-up — 2026-07-17 16:55 CEST

This follow-up reconciles the prior audit with the implementation now present
in the shared worktree. The audit above remains preserved as a historical
snapshot; the checkboxes below separate code/test completion from live or
release acceptance.

### Completed implementation and static coverage

- [x] Removed the production `rawWhere`/`rawSql` escape hatch; structured
      filters, strict 32-hex trace IDs, stream quoting, and value escaping are the
      only query inputs.
- [x] Corrected search aggregation: conditional `HAVING` retains all spans of
      selected traces, combines span predicates on the same span, and keeps
      duration bounds trace-level. Go tests cover these semantics.
- [x] Enforced a maximum search limit of 500 and added trace-detail warnings
      when OpenObserve `total` exceeds returned hits. This is an explicit warning
      policy, not pagination or an unlimited-size claim.
- [x] Added the deterministic 5,001-span seed scenario, current-time default
      ingestion, optional reference time, trace-ID logging, and duplicate-ID caveat
      to the development documentation.
- [x] Wired `live_trace_v0.91.2.json` into the transform regression test.
- [x] Added frontend template interpolation for supported fields, surfaced
      stream-discovery errors, and added component tests for those paths.
- [x] Added accessible IDs/names and responsive custom query/config layouts;
      the visual gate passes plugin-owned surfaces. Narrow Explore clipping and
      built-in Grafana HTTP-settings behavior remain upstream shell limitations.
- [x] Added real Jest tests and authored/listable Grafana E2E specs.
- [x] Defaulted published development ports to loopback with explicit remote
      exposure opt-in (`DEV_BIND_ADDRESS=0.0.0.0`).
- [x] Scoped signing secrets and made the release workflow refuse a missing
      Grafana signing token. Static build, typecheck, lint, Jest, Go, and workflow
      checks passed in the current integration run.

### Still pending or unproven

- [ ] Build a fresh Mage backend package. Host Mage is unavailable and the
      existing `dist/` backend binaries are stale; a successful source build is
      required before runtime E2E claims.
- [ ] Run runtime E2E against that newly built backend and the seeded stack.
- [ ] Run the official Grafana plugin validator; it requires its network-backed
      latest image/tool pull.
- [ ] Validate the 5,001-span behavior and edge-of-time-window behavior live;
      the seed scenario and truncation warning are implemented, but no live cap
      acceptance is claimed.
- [ ] Complete schema-driven tag classification, trace-to-logs/log-source E2E,
      and deprecated UI component migration.
- [ ] Pin immutable action SHAs throughout privileged workflows.
- [ ] Validate GR's exact o2 version/auth/live deployment, produce an actual
      signed artifact, and complete rollout/handover acceptance.

### Final verification addendum

- [x] OpenTelemetry trace IDs containing any all-zero ID are rejected.
- [x] Duration parsing and conversion is overflow-safe and exact.
- [x] Grafana 13 E2E was repaired: three authored tests pass, including
      rendered trace fields and node/edge frame assertions.
- [x] Post-fix code-quality, security, and static verification passed.
- [x] Responsive custom UI remains in the product; viewport-responsive testing
      is intentionally out of scope/stopped and is not an automated testing
      objective.
