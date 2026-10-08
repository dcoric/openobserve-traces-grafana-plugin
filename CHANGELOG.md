# Changelog

## 1.0.0 (Unreleased)

Initial release.

- Refresh the Grafana 13.2.3 toolchain, Node 24, Go SDK and CI compatibility matrix while retaining Grafana 12 support.
- Replace plugin-owned deprecated HTTP settings and Select controls with Grafana plugin UI components and Combobox.
- Add schema-backed attribute suggestions, inline duration/limit validation and accessible, responsive configuration fields.
- Preserve saved resource-to-log mappings and secure HTTP settings when editing configuration.
- Emit canonical `service.name` resource attributes for native trace-to-logs correlation.
- Detect trace truncation by probing one span beyond the 5,000-span display limit, even when OpenObserve reports a page-sized total.
- Add seeded OTLP logs, a local Loki datasource, unique trace IDs per reference time and verified ingestion readiness.
- Cover native search drill-down, error details, node graph, matching logs, large traces, range padding and invalid IDs in browser tests.
- Replace the unavailable MinIO client image with AWS CLI bucket bootstrap and retain loopback defaults.
- Refresh setup and validation documentation, packaged help, project links and real-data screenshots.
