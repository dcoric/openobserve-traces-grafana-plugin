# OpenObserve Traces

OpenObserve Traces is a Grafana backend data source that renders OpenObserve
trace data in Grafana's native trace view. It is intended for Grafana 12+
deployments with an OpenObserve HTTP API.

## Configure

1. Add the **OpenObserve Traces** data source.
2. Set the OpenObserve base URL, organization (default `default`), and the
   HTTP authentication required by the deployment.
3. Optionally choose a default traces stream and enable node graph output.
4. Optionally select a logs data source and configure trace/span ID filters for
   Trace-to-logs links.

## Query features

- Structured trace search by service, span name, duration, status, and tags.
- Strict trace-ID lookup with a native Grafana waterfall.
- Optional node-graph frames, span events, links, tags, and resource fields.
- Stream discovery through the data source resource API.

Search has no raw SQL escape hatch and rejects requests above 500 traces. A
trace lookup is capped at 5,000 spans and exposes a warning when OpenObserve
reports more spans than were returned. These limits are explicit; pagination
and unlimited trace retrieval are not provided.

## Development and support status

The repository's local OpenObserve v0.91.2 validation confirmed the original
field mappings. Current hardening is covered by tests, but a fresh Mage backend
build, runtime E2E run, live cap/window validation, and GR deployment validation
remain required before production use. Schema-driven resource tags,
Trace-to-logs end-to-end verification, and migration from deprecated Grafana
HTTP/Select components are also pending.

See the repository README and `docs/DEV-ENVIRONMENT.md` for development setup,
seed controls, loopback port defaults, and current validation status.
