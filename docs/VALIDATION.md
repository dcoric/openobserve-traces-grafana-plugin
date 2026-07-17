# Live-instance validation checklist

Every field mapping and time-unit conversion in this plugin was derived from
reading OpenObserve's source code (`src/service/traces/mod.rs`,
`src/handler/http/request/traces/mod.rs`), **not** from a running instance. This
document is the gate: work through it against a real OpenObserve deployment with
a known trace before relying on the plugin.

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

Keep this `hits[0]` JSON; it answers most items below. (You can also drop it into
`pkg/plugin/transform_test.go` as a second golden fixture.)

## 1. Time units (highest risk)

| Assumption | Check on `hits[0]` | Fix if wrong |
|---|---|---|
| `start_time` / `end_time` are **nanoseconds** | ~19 digits (e.g. `1.7e18`) | `epochToMillis` auto-detects by magnitude, so a shift to µs/ms is handled — but confirm the rendered span start matches the o2 UI. |
| `duration` is **microseconds** | a span of ~1ms shows `~1000` | If it is ns or ms, change the `÷ 1000` in `transform.go` (`buildTraceFrame`) and `nodegraph.go`. **This is NOT magnitude-detectable** — it must be right. |
| event `_timestamp` (inside `events`) is **nanoseconds** | ~19 digits | `epochToMillis` handles it; confirm event markers land at the right offset in the waterfall. |

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

- **Assume:** the `GROUP BY trace_id` SQL in `buildSearchSQL` runs against
  `type=traces`, and `first_value(... ORDER BY ...)`, `count(DISTINCT ...)` are
  supported by OpenObserve's SQL engine.
- **Check:** run a Search query; confirm the table populates with trace id, name,
  service, duration, span/error counts.
- **Fix:** if `first_value(... ORDER BY ...)` is unsupported, fall back to
  `GET /api/{org}/{stream}/traces/latest` (documented; returns `first_event`).

**Acceptance:** searching returns traces; clicking a trace id opens its waterfall.

## 7. Auth & connectivity

- **Check:** *Save & test* succeeds. Confirm whether the instance accepts Basic
  auth with email\:password, or requires a service-account / API token (used as
  the Basic-auth password). SSO-only instances may reject Basic auth entirely.
- **Fix:** Basic auth + TLS are handled by Grafana's HTTP settings; no code change
  expected — this is a deployment/config check.

## 8. size = 5000 cap & time window

- **Check:** does a large trace exceed `maxSpansPerTrace` (5000)? Does a trace
  near the edge of the dashboard range get found (±5 min pad)?
- **Fix:** tune `maxSpansPerTrace` / `traceIDWindowPadMicros` in the backend, or
  confirm `size: -1` is accepted for traces and switch to it.

---

## Sign-off

- [ ] §1 timings match the o2 UI for a known trace
- [ ] §2 spans nest with a single root
- [ ] §3 kind icons + error coloring correct
- [ ] §4 attributes correctly sectioned
- [ ] §5 events/links render
- [ ] §6 search table + drill-down works
- [ ] §7 Save & test passes
- [ ] §8 large-trace + time-window behavior acceptable
