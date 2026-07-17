# Implementation plan — from "plugin built" to "goal reached"

Companion to [`PLAN.md`](PLAN.md) (the *why*). This file is the *what next*:
what the 17 July 2026 request changes about our approach, and the concrete
phases that take the project to its goal.

**Goal.** GR runs OpenObserve (o2) backed by an S3 bucket, fed by OTel, and
displayed in Grafana. Deliver a Grafana data source plugin that shows o2
**traces** in Grafana's native trace view (like Tempo), *proven to work* against
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
    ✅ DONE           ✅ DONE          ✅ mostly       pending        pending       pending
                                          ▲
                                          │
                                ██ WE ARE HERE ██
   (stack up & verified end-to-end 17 Jul: duration=µs CONFIRMED, all
    sign-off items ticked except §8; next: §8, golden-fixture test,
    then Phase 3)
```

Sequenced by risk: Phase 1+2 attack the project's biggest unknown (source-derived
field/unit mapping never checked against a running o2). Phases 3–4 harden and
automate. Phase 5 is the only part that needs anything from GR.

---

## Where we are

| Done | Where |
|---|---|
| Data source plugin, M0–M5 (search → table → waterfall, node graph, trace-to-logs, hardening) | `src/`, `pkg/` |
| Unit-tested transform (o2 rows → Grafana trace frames) | `pkg/plugin/transform.go` + tests |
| Validation checklist — *written but never executed* (no instance existed) | `docs/VALIDATION.md` |
| Trace simulator: multi-service OTLP/JSON generator (10 services, 3 scenarios, errors + events + cross-trace links, deterministic via `SEED`) | `dev/seed/generate-traces.mjs` |
| Datasource provisioning pointed at the in-compose o2 | `provisioning/datasources/datasources.yml` |
| Backend binaries incl. `linux_arm64` for the dev container | `dist/` |
| **Local emulation stack, verified end-to-end** (RustFS S3 + o2 v0.91.2 + OTel Collector + Grafana + seed) | `docker-compose.yaml`, `dev/`, `docs/DEV-ENVIRONMENT.md` |
| **Validation gate executed** — all sign-off items ✅ except §8; `duration`=µs confirmed | `docs/VALIDATION.md`, `pkg/plugin/testdata/live_trace_v0.91.2.json` |

---

## What the 17 July info changes — do differently

1. **Stop treating "no live instance" as an external blocker.**
   Original decision: *build against source-derived spec, gate on a future live
   instance*. New approach: **build the live instance ourselves** — a docker
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
   against what o2's *actual OTLP ingest pipeline* materializes (span_kind
   values, `reference_parent_span_id`, flattened attribute names, `events`/
   `links` encoding) instead of what we inferred from reading its source.

4. **Simulation data is a first-class deliverable.** The
   [grafana-incremental-trace-viewer](https://github.com/G-Research/grafana-incremental-trace-viewer)
   scripts are the *idea* to borrow — preload a local Grafana with generated
   data so anyone can develop against it — **not code to reuse**: they were
   written for a different backend/setup and would need modification anyway.
   So we build our own OTLP-native generator
   (`dev/seed/generate-traces.mjs`), tailored to what *this* plugin must
   exercise: multi-service topology (node graph), error spans + exception
   events (status coloring, span logs), span links across traces
   (references), PRODUCER/CONSUMER kinds, varied durations and a wide time
   spread (search filters), deterministic seed (repeatable e2e tests). We
   still mine the reference repo for useful patterns (invocation ergonomics,
   data shapes) and adapt, rather than adopt.

5. **Golden tests get re-grounded.** Current fixtures in
   `pkg/plugin/transform_test.go` encode our *assumptions*. Once the stack is
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
- [x] `openobserve` service: `v0.91.2`; root user env; `ZO_LOCAL_MODE_STORAGE=s3`
      + `ZO_S3_*` pointed at `http://rustfs:9000` (path-style is o2's default);
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

**Acceptance — met 17 Jul 26:** stack up from clean state; seed delivered
1,260/1,260 spans (236 traces, zero loss); RustFS bucket contains o2-written
trace Parquet + index objects; plugin health check passes; search (with
service/error filters) and trace-by-id both return correct frames through the
real plugin backend; Explore renders the 4-span waterfall; trace still fully
readable after an o2 restart (forced S3 reads).

## Phase 2 — execute the validation gate ✅ mostly done (17 Jul 26) **← we are here**

Run `docs/VALIDATION.md` §0–§8 against the local stack. This is the highest-
value work in the project — it converts every "assumed" into "verified" or
"fixed". Detailed results live in `docs/VALIDATION.md`'s sign-off section.

- [x] §0 ground truth captured →
      `pkg/plugin/testdata/live_trace_v0.91.2.json`.
      **Remaining:** wire it into `transform_test.go` as a golden fixture.
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
- [x] §6 search SQL accepted by o2's engine; filters verified through the
      plugin; drill-down trace frame correct.
- [x] §7 auth — Basic root email:password works for queries AND OTLP ingest.
- [ ] §8 span cap / time-window padding — **open**: needs a >5000-span seed
      scenario (add to the generator) + an edge-of-range trace check.
- [x] Sign-off ticked in `docs/VALIDATION.md`; `README.md` banner updated
      (proven against *emulation*, GR-instance pass still pending).

## Phase 3 — improvements unblocked by a real instance *(pending)*

Priority order:

- [ ] **Schema-driven `serviceTags` vs `tags` split** — replace the prefix
      heuristic using `GET /api/{org}/streams/{stream}/schema` (resource wiring
      already exists in `datasource.go`). Now testable against real schemas.
- [ ] Decide `size: -1` vs `maxSpansPerTrace` cap by experiment (§8 result).
- [ ] Trace-to-logs end-to-end: ship logs from the collector into o2 too (same
      pipeline), provision an o2 logs datasource, and verify span→logs links.
      *(The official o2 plugin or a Loki-compatible source — decide when here.)*
- [ ] Migrate deprecated `DataSourceHttpSettings` / `Select` to
      `@grafana/plugin-ui` / `Combobox`.

## Phase 4 — e2e tests + CI *(pending)*

- [ ] `@grafana/plugin-e2e` Playwright specs against the seeded stack
      (`SEED` pinned): datasource save-&-test, search returns rows, drill-down
      renders a waterfall, node graph renders. See `.config/AGENTS/e2e-testing.md`
      before writing them.
- [ ] GitHub Actions job: build plugin → compose up (linux/amd64 binaries
      already built) → seed → run e2e → tear down.
- [ ] Keep unit tests as the fast path; e2e as the merge gate.

## Phase 5 — rollout to GR *(pending, needs GR input)*

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

| Gap | Risk |
|---|---|
| RustFS ≠ AWS S3 | o2↔S3 quirks (path-style, multipart, list semantics) may differ; storage-layer only, shouldn't affect the API our plugin consumes. |
| Single-node o2 vs GR's (likely clustered) deployment | Query routing/completeness differences; `_search` API contract should be identical. |
| o2 version drift | Column names, SQL features, OTLP handling can change between versions — pin GR's version as soon as known. |
| Simulated vs real spans | Real instrumentations emit messier data (missing parents, huge attrs, clock skew). Add a "messy" scenario to the generator if Phase 2 passes too cleanly. |
| Local root-user Basic auth vs GR auth | GR may be SSO/service-account only — Phase 5 item. |

## Open questions for GR (ask when convenient, none block Phases 1–4)

1. Exact OpenObserve version + deployment mode (single/cluster, HA)?
2. Auth for programmatic API access (Basic? service account token? SSO-only)?
3. o2 organization + traces stream names in use?
4. Which Grafana version is the target (we build against 13.x)?
5. Plugin distribution preference: private signing vs unsigned allow-list?
6. Is trace-to-logs correlation wanted at rollout (which logs datasource)?
