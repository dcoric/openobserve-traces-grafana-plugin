# Manual runtime walkthrough

Use the versions, commands and local credentials in
[DEV-ENVIRONMENT.md](DEV-ENVIRONMENT.md). Record the revision, Grafana and
OpenObserve versions, seed output and reference time for each acceptance run.
The dated results are in [VALIDATION.md](VALIDATION.md).

## Build, start and seed

```bash
npm ci
npm run build
mage buildAll
docker compose up --build -d
docker wait "$(docker compose ps -aq seed)"
docker compose logs seed
```

The seed's exit code must be 0. Wait for the `Indexed ...` readiness message,
and retain the printed large trace ID. Ordinary reruns generate new trace IDs
from the current reference timestamp, even with the same random seed.

## Connection and search

Open [Grafana](http://localhost:3000), then **Connections > Data sources >
OpenObserve Traces**. Confirm URL `http://openobserve:5080`, Basic Auth with
the local credentials, organization `default`, and default stream `default`.
**Save & test** should say **Connected to OpenObserve**. For an authentication
failure check, create a separate temporary datasource with incorrect
credentials, then remove it after checking the error.

In **Explore**, select **OpenObserve Traces** and **Last 1 hour**:

1. Run a search and inspect the trace ID, time, name, service, duration and
   span/error counts.
2. Filter service `payment-service`, span name `PaymentService/Charge`, and
   **Errors only**. Returned trace summaries should still include the complete
   trace, with the matching payment span visible in drill-down.
3. Try `200ms` as the minimum duration. Enter an invalid duration to verify
   inline feedback, then restore a valid value.
4. Add an attribute filter and confirm suggestions from the selected stream.
   For product requests, `http_method=GET` is a useful example.
5. Set the result limit to 1. Hover the query's warning to confirm that more
   traces may match. Requests above 500 are rejected.

## Waterfall, details and graph

Click a result's trace ID. Check the native waterfall has nested spans and
sensible durations. Open a failed `PaymentService/Charge` span and inspect its
error status, attributes and exception event. Expand **Resource attributes**
and confirm `service.name`. An `order-processor` trace contains a link back to
the checkout producer; inspect its reference context.

Expand **Node graph** above the waterfall. Nodes correspond to spans and edges
to parent-child relationships. The datasource can enable graph output by
default; the query also offers a node graph switch.

Compare a representative trace's start time, duration, relationships and
events with the same trace in [OpenObserve](http://localhost:5080). Absolute
timestamps are normalized to milliseconds; OpenObserve's relative duration
field is interpreted as microseconds.

## Trace to logs

The provisioned datasource selects **Local Trace Logs**, maps `service.name`
to `service_name`, enables trace and span ID filters, and uses time shifts of
`-1m` and `1m`. Open a span and click **Logs for this span** (the logs icon on
older Grafana versions). The split logs pane should show a `Completed ...`
record with that trace ID and span ID. Failed spans produce error records.

This exercises Loki's native integration. Validate different production logs
plugins and label mappings separately.

## Large traces and range boundaries

Search attribute `dev_scenario=large-trace`. The result should contain 5,001
spans with the default seed. Open it and verify the waterfall shows 5,000
spans. Hover the trace query's warning and confirm:

> Trace contains more than 5000 spans; showing the first 5000 spans.

The search query may have its own full-page warning, so inspect the warning
beside the trace-ID query. Detection uses one extra fetched row and does not
depend on an accurate OpenObserve `total`.

For a short normal trace, set a one-second absolute range four minutes before
its start and run the trace-ID query. Repeat four minutes after its start. Both
should render because lookup pads the range by five minutes. A range six
minutes after the trace should contain no spans. An invalid ID such as
`not-a-trace` should show the backend validation error.

## Automated checks and cleanup

```bash
npm run e2e
docker compose run --rm --entrypoint aws rustfs-init \
  --endpoint-url http://rustfs:9000 s3api list-objects-v2 \
  --bucket openobserve --max-items 10
```

Allow about a minute for OpenObserve's WAL flush before expecting S3 objects.
`docker compose down` stops the stack and preserves data. Use `down -v` only
when intentionally deleting all local volumes. Restart Grafana after backend
or plugin metadata changes before repeating acceptance checks.
