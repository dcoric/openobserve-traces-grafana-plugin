# OpenObserve Traces for Grafana - Business Requirements

## Document Status

This document captures the business requirements received from Nikola for GR's
OpenObserve trace visualization work.

- Status: Baseline requirements for implementation and acceptance.
- Source: Nikola's Serbian business message, translated and normalized into
  implementation-ready requirements.
- Date: 2026-07-17.
- Primary users: GR engineers and operators who use Grafana and OpenObserve for
  observability.
- Product scope: A Grafana data source plugin that visualizes OpenObserve traces.

The requirements below are intentionally written as the product contract. They
should stay separate from implementation status, task planning, or temporary
engineering notes.

## Priority Terms

- MUST: Required for the plugin to satisfy the business request.
- SHOULD: Expected unless there is a documented tradeoff or GR explicitly
  accepts deferral.
- COULD: Useful follow-up after the core trace workflow is proven.

## Business Context

GR currently uses OpenObserve, also known as O2, for observability. OpenObserve
has a Grafana plugin and its own UI, but the plugin currently used by GR covers
metrics and logs and does not provide trace visualization.

GR wants a Grafana plugin that shows distributed traces stored in OpenObserve.
OpenObserve trace data is accessed through SQL over the OpenObserve API. The
expected user experience should be similar to Grafana Tempo's trace workflow:
engineers should be able to search for traces, open a trace, inspect the span
waterfall, and understand errors and timing without leaving Grafana.

Local development and proof must run with Docker Compose using:

- RustFS for S3-compatible object storage.
- OpenObserve.
- OpenTelemetry Collector.
- Grafana with the plugin installed.

The Grafana plugin must not talk directly to S3. RustFS exists to back
OpenObserve locally; OpenObserve remains the API boundary for the plugin.

## Required Outcome

The project succeeds when a GR engineer can run the local stack, generate or
ingest OpenTelemetry traces into OpenObserve, configure the Grafana plugin, query
OpenObserve from Grafana, and view complete traces in Grafana's native trace
visualization.

The plugin should feel like a trace data source, not a custom dashboard pasted
into Grafana. Grafana's native trace view should be used wherever possible.

## System Boundary

```text
Browser / Grafana Explore
        |
        v
Grafana data source plugin
        |
        v
OpenObserve HTTP API and SQL search
        |
        v
OpenObserve trace storage
        |
        v
RustFS S3-compatible object storage for local development
```

The OpenTelemetry Collector sends traces into OpenObserve in the local
development environment. The Grafana plugin reads traces from OpenObserve.

## Product Requirements

| ID    | Priority | Requirement                                                                                                               |
| ----- | -------- | ------------------------------------------------------------------------------------------------------------------------- |
| PR-01 | MUST     | Build a standalone Grafana backend data source plugin dedicated to OpenObserve trace visualization.                       |
| PR-02 | MUST     | Query traces through the OpenObserve API using SQL search capabilities.                                                   |
| PR-03 | MUST     | Return trace data to Grafana using Grafana's native trace data frame format so Grafana can render the trace waterfall.    |
| PR-04 | MUST     | Provide a Tempo-like workflow for trace search and trace detail inspection.                                               |
| PR-05 | MUST     | Keep OpenObserve as the only runtime data source boundary for the plugin; the plugin must not read RustFS or S3 directly. |
| PR-06 | SHOULD   | Keep the plugin focused on traces; logs and metrics are only in scope when needed for correlation with trace data.        |

## Configuration Requirements

| ID    | Priority | Requirement                                                                   |
| ----- | -------- | ----------------------------------------------------------------------------- |
| CF-01 | MUST     | Allow users to configure the OpenObserve base URL.                            |
| CF-02 | MUST     | Store credentials and tokens only in Grafana secure configuration fields.     |
| CF-03 | MUST     | Support OpenObserve organization and stream selection needed to query traces. |
| CF-04 | SHOULD   | Discover available trace streams where the OpenObserve API permits it.        |
| CF-05 | SHOULD   | Surface configuration errors clearly in Grafana instead of failing silently.  |

## Trace Search Requirements

| ID    | Priority | Requirement                                                                                        |
| ----- | -------- | -------------------------------------------------------------------------------------------------- |
| SQ-01 | MUST     | Provide a trace search mode in Grafana Explore.                                                    |
| SQ-02 | MUST     | Search traces by time range.                                                                       |
| SQ-03 | MUST     | Support filtering by service name.                                                                 |
| SQ-04 | MUST     | Support filtering by operation or span name.                                                       |
| SQ-05 | MUST     | Support filtering by status or error state.                                                        |
| SQ-06 | SHOULD   | Support duration bounds for finding slow traces.                                                   |
| SQ-07 | SHOULD   | Support selected span and resource attributes as filters without exposing users to unsafe raw SQL. |

## Trace Retrieval and Visualization Requirements

| ID    | Priority | Requirement                                                                                                                                          |
| ----- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| TR-01 | MUST     | Retrieve a complete trace by trace ID from OpenObserve.                                                                                              |
| TR-02 | MUST     | Convert OpenObserve span records into Grafana's trace model with trace ID, span ID, parent span ID, timestamps, duration, service, name, and status. |
| TR-03 | MUST     | Preserve parent-child relationships between spans.                                                                                                   |
| TR-04 | MUST     | Display trace timing as a waterfall in Grafana.                                                                                                      |
| TR-05 | MUST     | Surface partial or truncated trace results explicitly to the user.                                                                                   |
| TR-06 | SHOULD   | Include useful span attributes, resource attributes, events, and links where OpenObserve returns them.                                               |
| TR-07 | SHOULD   | Provide a span-node graph only when it accurately represents span relationships; it must not be presented as a Tempo service graph.                  |

## Correlation Requirements

| ID    | Priority | Requirement                                                                                          |
| ----- | -------- | ---------------------------------------------------------------------------------------------------- |
| CR-01 | COULD    | Add trace-to-log links if GR confirms the target log streams and expected labels.                    |
| CR-02 | COULD    | Add trace-to-metric links only if GR confirms a concrete metrics workflow.                           |
| CR-03 | COULD    | Provide OpenObserve UI links for users who need to jump from Grafana to the native OpenObserve view. |

## Security and Reliability Requirements

| ID    | Priority | Requirement                                                                                                          |
| ----- | -------- | -------------------------------------------------------------------------------------------------------------------- |
| SR-01 | MUST     | Do not expose OpenObserve credentials in frontend code, query payloads shown to users, logs, or generated artifacts. |
| SR-02 | MUST     | Use parameterized or safely constructed queries; user input must not be concatenated into raw SQL.                   |
| SR-03 | MUST     | Enforce practical query limits and return clear warnings when limits affect results.                                 |
| SR-04 | MUST     | Return clear Grafana errors for OpenObserve authentication, authorization, network, and malformed response failures. |
| SR-05 | MUST     | Treat partial OpenObserve responses, truncation, and query function errors as user-visible warnings or errors.       |
| SR-06 | SHOULD   | Keep server-side defaults conservative enough to avoid accidental expensive queries.                                 |
| SR-07 | SHOULD   | Keep plugin behavior deterministic enough for repeatable local validation.                                           |
| SR-08 | SHOULD   | Avoid logging sensitive request headers, credentials, or raw payloads containing secrets.                            |

## Local Development and Demo Requirements

| ID    | Priority | Requirement                                                                                    |
| ----- | -------- | ---------------------------------------------------------------------------------------------- |
| DV-01 | MUST     | Provide Docker Compose for Grafana, OpenObserve, OpenTelemetry Collector, and RustFS.          |
| DV-02 | MUST     | Configure OpenObserve to use RustFS as S3-compatible storage in local development.             |
| DV-03 | MUST     | Provide a repeatable way to generate or seed OpenTelemetry traces locally.                     |
| DV-04 | MUST     | Include at least one trace with multiple services and nested spans.                            |
| DV-05 | MUST     | Include at least one error trace.                                                              |
| DV-06 | SHOULD   | Include at least one large trace to prove truncation handling and warnings.                    |
| DV-07 | SHOULD   | Keep local service ports documented and safe for developer machines.                           |
| DV-08 | SHOULD   | Document the exact commands needed to start the stack, seed data, and query traces in Grafana. |

## Compatibility and Delivery Requirements

| ID    | Priority | Requirement                                                                             |
| ----- | -------- | --------------------------------------------------------------------------------------- |
| CP-01 | MUST     | Support the Grafana and OpenObserve versions used by GR, once confirmed.                |
| CP-02 | MUST     | Use the official Grafana plugin build, backend, packaging, and signing workflow.        |
| CP-03 | MUST     | Keep the plugin ID and plugin type stable after they are chosen.                        |
| CP-04 | SHOULD   | Validate the packaged plugin with the official Grafana plugin validator before release. |

## Acceptance Gates

### Gate A - Core Trace Correctness

The core trace workflow is accepted when:

- A user can configure OpenObserve connection details in Grafana.
- A user can search for traces in Grafana Explore.
- A user can open a trace by trace ID.
- Grafana renders the trace waterfall using native trace visualization.
- Parent-child span relationships are correct.
- Errors, duration, service, operation, and key attributes are visible.
- Partial or truncated traces are never silent.
- User filters cannot inject raw SQL.

### Gate B - Reproducible Local Proof

The local proof is accepted when:

- `docker compose up` starts Grafana, OpenObserve, OpenTelemetry Collector, and
  RustFS.
- OpenObserve stores local data through RustFS.
- The seed or generator creates deterministic traces.
- At least one seeded trace can be found from Grafana.
- At least one seeded trace can be opened and rendered as a waterfall.
- Large or intentionally limited trace results produce visible warnings.

### Gate C - Automated Quality and Packaging

The package is accepted when:

- Frontend type checking passes.
- Frontend tests pass.
- Backend Go tests pass.
- Backend Go race tests pass for relevant packages.
- Linting passes or documented non-blocking warnings are accepted.
- The plugin builds through the repository's Grafana plugin build process.
- The plugin package passes official Grafana validation, or any validator blocker
  is documented with evidence.

### Gate D - GR Rollout Readiness

GR rollout is accepted when:

- GR confirms the target Grafana version.
- GR confirms the target OpenObserve version and deployment shape.
- GR confirms authentication method and required organization or stream names.
- GR confirms whether trace-to-log links are required for the first release.
- The plugin is signed or distributed in the form GR requires.
- A real GR trace can be searched and opened without unreported span loss.

## Required Business Inputs from GR

The following inputs are still needed to finalize release-level scope:

| Input                            | Why it matters                                                               |
| -------------------------------- | ---------------------------------------------------------------------------- |
| Exact OpenObserve version        | Confirms API behavior, SQL response shape, and trace stream layout.          |
| Exact Grafana version            | Confirms compatible frontend, backend, and trace frame behavior.             |
| OpenObserve authentication model | Determines secure configuration fields and backend request behavior.         |
| Organization and stream names    | Determines defaults, discovery behavior, and documentation examples.         |
| Plugin distribution requirement  | Determines signing, release packaging, and installation workflow.            |
| Trace-to-log expectation         | Determines whether correlation links are first-release scope or later scope. |

## Non-Goals

The first release does not require:

- Replacing the existing OpenObserve logs or metrics plugin.
- Building a custom Grafana panel that duplicates Grafana's native trace view.
- Implementing full Tempo or TraceQL compatibility.
- Reading RustFS or S3 directly from the Grafana plugin.
- Managing production OpenObserve, RustFS, or OpenTelemetry infrastructure.
- Derived service graphs, RED metrics, profiles, or alerting unless GR adds them
  as explicit requirements.

## Definition of Done

The project is done when Gates A through D are satisfied and the plugin can be
used by GR to search and inspect OpenObserve traces from Grafana with no
unreported trace loss, no credential exposure, and a repeatable local proof of
the full workflow.
