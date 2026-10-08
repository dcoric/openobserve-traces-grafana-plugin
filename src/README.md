# OpenObserve Traces

Query OpenObserve traces in Grafana 12+ and inspect them in the native trace
waterfall, span details and optional node graph.

## Configure

1. Set the OpenObserve base URL reachable from the Grafana server.
2. Choose the HTTP authentication and TLS settings required by your deployment.
   Passwords, TLS material and custom header values use secure fields.
3. Set the organization and default traces stream, commonly `default`.
4. Optionally enable node graph output and select a supported logs datasource.
5. Click **Save & test** and confirm **Connected to OpenObserve**.

## Search and drill down

Search by service, operation, error status, duration and attributes. Attribute
suggestions come from the stream schema; custom names are also accepted.
Durations accept values such as `100us`, `1.5ms`, `2s`, bare microseconds, and
template variables. Click a result's trace ID to open the native waterfall,
or enter a known ID directly.

Search defaults to 50 traces and caps at 500. Full result pages warn that more
may match. Trace lookup widens the selected time range by five minutes on each
side, renders up to 5,000 spans and warns when an extra fetched row proves the
trace is larger. Pagination and raw SQL input are not available.

## Trace to logs

Select a logs datasource, map resource attributes to its labels, and configure
time shifts and trace/span ID filters. For Loki, map `service.name` to
`service_name`. The plugin emits the canonical resource tag needed for this
mapping. The local example includes emitted logs and verified native span-to-log
navigation; production mappings must match your own log data.

## Compatibility and support

The refresh was tested locally with OpenObserve v0.91.2 and Grafana 12.0.0,
13.0.10 and 13.2.3. CI tests additional supported versions and nightly.
Resource/span attribute classification still uses prefixes. Grafana Explore
may scroll horizontally at phone widths.

See the [repository](https://github.com/dcoric/openobserve-traces-grafana-plugin),
[setup instructions](https://github.com/dcoric/openobserve-traces-grafana-plugin/blob/main/docs/DEV-ENVIRONMENT.md),
[validation record](https://github.com/dcoric/openobserve-traces-grafana-plugin/blob/main/docs/VALIDATION.md),
and [issue tracker](https://github.com/dcoric/openobserve-traces-grafana-plugin/issues).
Local runtime validation does not establish production signing or deployment
acceptance. Restart Grafana after installing or updating the plugin.
