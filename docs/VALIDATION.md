# Live-instance validation checklist

> **Split status (2026-07-17):** §§0–7 below record the prior local emulation
> run (`docs/DEV-ENVIRONMENT.md`: OpenObserve **v0.91.2**, single-node,
> S3-backed, OTLP-ingested simulated traces), including the committed ground
> truth at [`pkg/plugin/testdata/live_trace_v0.91.2.json`](../pkg/plugin/testdata/live_trace_v0.91.2.json).
> The hardened query, limit, warning, and frontend paths were changed after
> that run and are covered by current unit/component tests. The local `dist/`
> backend is stale and host Mage is unavailable, so fresh runtime acceptance,
> §8, and GR production validation remain pending.

The original field mapping was source-derived and then checked against the
prior local run. This document remains the live-instance gate: do not treat
unit tests or stale binaries as current acceptance against a rebuilt backend or
GR deployment.

Contract traceability ([`REQUIREMENTS.md`](../REQUIREMENTS.md)): §1 → TR-02 /
TR-04 (Gate A timing), §2 → TR-03 (Gate A parent-child), §3 → TR-02 / SQ-05,
§§4–5 → TR-06, §6 → SQ-01..SQ-07 / SR-02 / SR-03, §7 → CF-02 / Gate D auth
mode, §8 → TR-05 / SR-03 / SR-05 (Gates A+B: truncation is never silent). The
sign-off below is the evidence record for Gates A and B; Gate C and Gate D
status is tracked at the end of this file and in `IMPLEMENT_PLAN.md`
Phases 4–5.

For each item: **(a)** what we assume, **(b)** how to check it, **(c)** where to
fix it if the assumption is wrong.

## 0. Capture ground truth

Pick one trace you can also open in OpenObserve's own UI. Then dump the raw
search response the plugin will parse:

```bash
ORG=default
STREAM=default
TRACE_ID=<32-hex-trace-id>
curl -s -u "$EMAIL:$PASSWORD" \
  "http://<o2-host>:5080/api/$ORG/_search?type=traces" \
  -H 'Content-Type: application/json' \
  -d "{\"query\":{\"sql\":\"SELECT * FROM \\\"$STREAM\\\" WHERE trace_id='$TRACE_ID' ORDER BY start_time\",\"start_time\":<from_micros>,\"end_time\":<to_micros>,\"from\":0,\"size\":5000}}" \
  | jq '.hits[0]'
```

Keep this `hits[0]` JSON; it answers most items below. The captured local
response is now exercised by `pkg/plugin/transform_fixture_test.go`.

## 1. Time units (highest risk)

| Assumption                                              | Check on `hits[0]`           | Fix if wrong                                                                                                                                              |
| ------------------------------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `start_time` / `end_time` are **nanoseconds**           | ~19 digits (e.g. `1.7e18`)   | `epochToMillis` auto-detects by magnitude, so a shift to µs/ms is handled — but confirm the rendered span start matches the o2 UI.                        |
| `duration` is **microseconds**                          | a span of ~1ms shows `~1000` | If it is ns or ms, change the `÷ 1000` in `transform.go` (`buildTraceFrame`) and `nodegraph.go`. **This is NOT magnitude-detectable** — it must be right. |
| event `_timestamp` (inside `events`) is **nanoseconds** | ~19 digits                   | `epochToMillis` handles it; confirm event markers land at the right offset in the waterfall.                                                              |

**Acceptance:** the waterfall's total duration, each span's start offset, and bar
widths match OpenObserve's own trace view for the same trace.

## 2. Parent / child structure

- **Assume:** the column is `reference_parent_span_id`; empty/absent ⇒ root span.
- **Check:** is the column present on every row? Does the root span have it empty?
  OpenObserve only materializes it when at least one child span exists.
- **Fix:** the transform already treats missing/empty as root. If the real column
  name differs (e.g. nested `reference.parent_span_id`), update the `reserved`
  set and the `decodeString(hit["reference_parent_span_id"])` lookup in
  `transform.go`, and the `buildSearchSQL` root-name logic.

**Acceptance:** spans nest correctly (no flat list, no orphans) and exactly one
root is shown.

## 3. span_kind & status

- **Assume:** `span_kind` is `"0".."5"` or `"SPAN_KIND_*"`; `span_status` is
  `OK`/`ERROR`/`UNSET`; `status_code`/`status_message` may be present.
- **Check:** the literal values on real rows.
- **Fix:** extend `normalizeSpanKind` / `statusCodeFromString` in `transform.go`.

**Acceptance:** client/server icons render correctly; errored spans are red.

## 4. Attributes: tags vs serviceTags

- **Assume:** span attributes are flattened to top-level columns (dots →
  underscores, e.g. `http.method` → `http_method`); resource attributes share the
  same flat namespace and are split out by prefix heuristic (`service_`, `k8s_`,
  `host_`, `os_`, `process_`, `container_`, `cloud_`, …).
- **Check:** call the schema resource and inspect column names:
  `GET /api/{org}/streams/{stream}/schema?type=traces`. Are resource attributes
  actually prefixed? Any colliding keys prefixed `attr_`?
- **Fix:** adjust `resourcePrefixes` / `reserved` in `transform.go`. If the prefix
  heuristic is unreliable, switch to a schema-driven classification using the
  `schema` CallResource endpoint (already wired in `datasource.go`).

**Acceptance:** the span detail panel shows attributes under the right sections
and key names are the ones you expect.

## 5. events & links JSON

- **Assume:** `events` and `links` are **JSON-encoded strings** (parse twice);
  empty is `"[]"`. Event keys: `name`, `_timestamp`, attrs. Link keys:
  `context.{traceId,spanId}` (camelCase), `droppedAttributesCount`, attrs.
- **Check:** `jq '.hits[0].events, .hits[0].links'` — string or array? key casing?
- **Fix:** `decodeJSONStringArray` already tolerates both string and array forms;
  adjust key names in `parseEvents` / `parseLinks` if casing differs.

**Acceptance:** span logs (events) and references (links) appear with correct
timestamps and attributes.

## 6. Search results (table)

- **Implemented:** `buildSearchSQL` uses conditional `HAVING` aggregation:
  span predicates are combined in one CASE expression so they match the same
  span, while all spans from selected traces remain available for counts,
  duration, services, and first-name fields. Go unit tests cover the generated
  SQL and the 500-trace search limit.
- **Prior local check:** the pre-hardening `GROUP BY trace_id` query and
  `first_value(... ORDER BY ...)`/`count(DISTINCT ...)` forms were accepted by
  OpenObserve v0.91.2. This is not current acceptance of the changed backend.
- **Check:** run a Search query; confirm the table populates with trace id, name,
  service, duration, span/error counts.
- **Fix:** if `first_value(... ORDER BY ...)` is unsupported, fall back to
  `GET /api/{org}/{stream}/traces/latest` (documented; returns `first_event`).

**Acceptance:** after a fresh Mage build, verify filtered table summaries match
the unfiltered trace-by-id waterfall. Raw `rawWhere`/`rawSql` inputs are not
supported. Search requests above 500 are rejected; this is a cap, not
pagination or an unlimited-size contract.

## 7. Auth & connectivity

- **Check:** _Save & test_ succeeds. Confirm whether the instance accepts Basic
  auth with email\:password, or requires a service-account / API token (used as
  the Basic-auth password). SSO-only instances may reject Basic auth entirely.
- **Fix:** Basic auth + TLS are handled by Grafana's HTTP settings; no code change
  expected — this is a deployment/config check.

## 8. size = 5000 cap & time window

- **Implemented:** the compose seed includes a deterministic
  `LARGE_TRACE_SPAN_COUNT=5001` scenario (set to 0 to disable), logs its trace
  ID, and supports optional `REFERENCE_TIME_MS` while defaulting to current
  time. Determinism is structural by default (scenario mix, span counts, IDs
  via the pinned `SEED_RANDOM_SEED`); Gate B's "deterministic traces" bullet is
  fully satisfied only when `REFERENCE_TIME_MS` is also set — record the exact
  invocation used when citing this as Gate B evidence. Trace lookup compares
  OpenObserve `total` with returned hits and emits a visible truncation warning
  when `total > hits`; search results that fill the requested limit warn that
  more may match (SR-03).
- **Check (still pending live):** does a large trace exceed
  `maxSpansPerTrace` (5000)? Does a trace near the edge of the dashboard range
  get found (±5 min pad)? Run both against a freshly built backend.
- **Possible fix after evidence:** tune `maxSpansPerTrace` /
  `traceIDWindowPadMicros`, or experimentally evaluate another retrieval policy;
  do not assume `size: -1`, pagination, or unlimited trace retrieval is
  supported.

---

## Sign-off

Prior local verification on 2026-07-17 used the emulation (o2 v0.91.2,
OTLP-seeded data). It is retained as historical evidence; current hardening
requires fresh Mage-built backend/runtime revalidation.

- [x] §1 timings — `start_time`/`end_time` are **ns** (19 digits), event
      `_timestamp` is **ns**, and **`duration` is µs confirmed**: on a real
      span, `end_time − start_time` = 27,929,851 ns and `duration` = 27,929.
      Plugin renders 27.929 ms — matches exactly. (The one non-detectable
      conversion is right.)
- [x] §2 spans nest with a single root — `reference_parent_span_id` present on
      children, absent on the root; `reference_parent_trace_id` /
      `reference_ref_type` also exist as columns.
- [x] §3 kinds/status — `span_kind` is a string digit (`"2"`, `"3"` observed);
      `span_status` `OK`/`ERROR`/`UNSET`; `status_code` int 0/1/2;
      `status_message` populated on errors (`card_declined`).
- [x] §4 attributes sectioned — with a caveat: o2 v0.91.2 prefixes **all**
      resource attributes uniformly with `service_` (`service_k8s_pod_name`,
      `service_service_version`, …), so the heuristic classifies this data
      correctly via its `service_` prefix alone. The other prefixes (`k8s_`,
      `host_`, …) never occur as resource columns — a _span_ attribute named
      e.g. `host_name` would be misclassified. Schema-driven split remains the
      right long-term fix (planned follow-up: `IMPLEMENT_PLAN.md` Phase 3;
      affects TR-06), lower risk than assumed.
- [x] §5 events/links — both are JSON **strings**. Events:
      `name`, `_timestamp` (ns), attribute keys keep **dots**
      (`exception.message`). Links: `context.{traceId,spanId}` camelCase +
      `droppedAttributesCount`, attrs alongside. Parsed and rendered correctly.
- [x] §6 implementation/unit coverage — conditional aggregate `HAVING` keeps
      full-trace summaries while requiring combined span filters on one span;
      strict trace IDs, raw-SQL removal, and max search limit are tested.
- [ ] §6 fresh runtime acceptance — rerun filtered search and drill-down with a
      freshly built backend; the prior local result predates these changes.
- [x] §7 Save & test — Basic `email:password` (root user) accepted for both
      queries and OTLP ingestion; health check returns "Connected to
      OpenObserve".
- [x] §8 implementation coverage — 5,001-span deterministic seed, current-time
      default, optional reference time, and total-vs-hits warning are present.
- [ ] §8 live cap/window behavior — **still open**; verify truncation and the
      ±5-minute edge window against a fresh backend. No pagination or unlimited
      size is claimed.

The prior run also verified end-to-end: OTLP → collector → o2 with **zero span loss**
(1,260/1,260), Parquet written to the S3 bucket (RustFS), and full trace reads
after an o2 restart (served from S3, not memtable).

**Gate C (Automated Quality and Packaging) — partially evidenced:** frontend
typecheck (`npm run typecheck`), Jest (`npm run test:ci`), backend Go tests
with race detector (`go test -race ./pkg/...`), and lint (`npm run lint`, 0
errors / 5 documented deprecation warnings) all passed locally on 2026-07-17
on the requirements-alignment working tree — re-run them against the current
tree before citing this line as evidence. Still pending: a fresh Mage backend
package, runtime E2E against it, and a full official-validator pass on the
packaged plugin. The release workflow runs the full validator on the built
archive (CP-04); note the GitHub release is created as a **draft** first —
publish only after the "Validate plugin" step is green. CI runs the
`metadatavalid` analyzer on unsigned PR artifacts.

**Gate D (GR Rollout Readiness) — open:** GR's Grafana and o2 version pins
(CP-01), auth mode, org/stream names, distribution/signing form, the
trace-to-log decision (CR-01), and a §1 timing spot-check on a real production
trace.
