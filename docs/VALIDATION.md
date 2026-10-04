# Validation record

## Current local acceptance: 2026-10-04

This refresh rebuilt the frontend with webpack and all six backend targets with
Mage. Runtime checks used OpenObserve v0.91.2, collector 0.156.0, RustFS
1.0.0-beta.10 and Loki 3.7.0. The local stack uses development credentials;
these results do not establish production deployment acceptance.

| Check                  | Evidence and result                                                                                                                                                                                                               |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend               | `npm run typecheck`, `npm run lint`, and all 51 Jest tests passed. Plugin-owned deprecated HTTP settings and Select usages were replaced. The ESLint dependency still prints its package deprecation notice.                      |
| Backend                | `go test -race ./pkg/...` and `mage buildAll` passed. Unit tests cover SQL filtering, time conversions, events/links, authentication errors, limits, and warnings.                                                                |
| Seed                   | `node --test dev/seed/*.test.mjs` passed. A Compose seed with random seed 1 indexed 251 complete traces / 6,361 spans and verified matching Loki logs.                                                                            |
| Local browser suite    | All eight tests passed on Grafana 12.0.0, 13.0.10, 13.2.3 and nightly 13.3.0-34793047961. Tests use the plugin-e2e fixtures and provisioned datasource/dashboard definitions.                                                     |
| CI browser matrix      | [Runtime PR #36](https://github.com/dcoric/openobserve-traces-grafana-plugin/pull/36) passed Grafana 12.0.10, 12.1.10, 12.3.11, 13.0.10, 13.2.3 and nightly on commit `91cba3d`, including seed readiness.                        |
| Native trace workflows | `tests/nativeTrace.spec.ts` clicks the search result link, verifies the waterfall, opens an error span and resource attributes, expands the node graph, and follows the native logs link to a matching error log.                 |
| Large trace            | A real 5,001-span trace produces a 5,000-span waterfall and the visible tooltip: "Trace contains more than 5000 spans; showing the first 5000 spans."                                                                             |
| Time range             | The same trace renders when the selected range is four minutes before or after its start, exercising both sides of the five-minute padding. A range six minutes after it returns zero spans. Invalid IDs show a validation error. |
| Configuration          | Save & test, secure Basic Auth, TLS controls and tag mappings passed browser/component checks. Manual light/dark checks covered desktop and 390px widths.                                                                         |
| Storage                | AWS CLI listed indexed objects in the RustFS `openobserve` bucket. Restart-based persistence was established in the historical mapping run below, not repeated in this refresh.                                                   |

The refresh is tracked by [#25](https://github.com/dcoric/openobserve-traces-grafana-plugin/issues/25),
[#26](https://github.com/dcoric/openobserve-traces-grafana-plugin/issues/26),
[#27](https://github.com/dcoric/openobserve-traces-grafana-plugin/issues/27), and
[#28](https://github.com/dcoric/openobserve-traces-grafana-plugin/issues/28).
Their linked PR checks contain the fresh CI build, compatibility and browser
matrix evidence. CI starts a new Compose stack for each Grafana matrix job and
waits for successful seed indexing before running tests.

## Defects found by runtime testing

Grafana's native trace-to-logs integration matches resource tags. The backend
now emits `service.name` from OpenObserve's `service_name`, so the configured
mapping to Loki's `service_name` label works. Log records contain both the
OTLP trace/span context and those IDs in the line body for Grafana version
compatibility.

OpenObserve v0.91.2 can report `total` equal to the fetched page size. Comparing
that field with returned hits missed larger traces. Trace lookup now requests
5,001 spans, detects the extra row, and caps both waterfall and graph input at
5,000. It does not claim an exact total beyond the cap or provide pagination.

## Package validation

The built archive includes the frontend, backend binaries, packaged README,
plugin metadata and real seeded-data screenshots. CI runs the official
`metadatavalid` analyzer on unsigned PR artifacts. The full official validator
was also run locally; its deployment findings are separate from build and
runtime acceptance:

The final local run reported **1 error and 3 warnings**. Of 40 analyzer
completion events, 37 had no findings. The metadata-only run passed.

- Organization lookup fails because the validator cannot find a Grafana Cloud
  account for the unchanged `gresearch` namespace. Namespace ownership must be
  resolved by the publisher before distribution.
- The local archive is unsigned. No signing token or production signature was
  created during this refresh.
- The standard Apache license appendix contains generic example placeholders,
  which the validator flags. The repository's license text was preserved.
- The initial missing-screenshot warning is addressed by the screenshots in
  `src/img/` and metadata entries in `src/plugin.json`.

A successful metadata check is not a full validator pass. Optional analyzers
that require external tools or configuration are not claimed as completed
security scans. The release workflow requires `GRAFANA_ACCESS_POLICY_TOKEN`,
creates a draft release and runs the full validator. Publish only after that
release's validation passes.

## Historical mapping evidence: 2026-07-17

The captured response in
[`pkg/plugin/testdata/live_trace_v0.91.2.json`](../pkg/plugin/testdata/live_trace_v0.91.2.json)
remains a regression fixture. That local run established:

- Span start/end and event timestamps are nanoseconds. `duration` is
  microseconds: a 27,929,851ns interval stored duration 27,929 and rendered
  27.929ms. Absolute timestamps use magnitude detection; relative duration
  uses a fixed division by 1,000.
- Child spans use `reference_parent_span_id`; roots omit it. Numeric span kind
  strings and OK/ERROR/UNSET statuses map to Grafana's fields.
- Resource columns were prefixed with `service_`, including
  `service_k8s_pod_name`. Events and links were JSON strings; link contexts used
  camelCase traceId/spanId. The parser also accepts arrays.
- All 1,260 ingested spans arrived, Parquet reached RustFS, and trace reads
  still worked after OpenObserve restarted.

## Remaining limits and production acceptance

Resource/span attribute classification still uses prefixes. A span attribute
such as `host_name` can be classified as a resource attribute. Schema discovery
improves the filter picker; it does not replace that classification heuristic.
Grafana's Explore host maintains a minimum pane width at phone sizes, so the
390px view can scroll horizontally even though the plugin's own grid fits its
assigned width. Configuration fields fit the narrow viewport.

Before deploying, confirm the target Grafana and OpenObserve versions, TLS and
authentication, organization and stream names, logs datasource/label mappings,
and signing/distribution ownership. Spot-check a production trace's timing,
parent relationships, events and links against OpenObserve itself. Local Loki
correlation does not establish compatibility with an arbitrary logs plugin or
the production log streams.
