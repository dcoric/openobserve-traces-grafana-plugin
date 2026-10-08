# Local development environment

The Compose stack runs Grafana with this plugin, OpenObserve backed by RustFS,
an OpenTelemetry collector, Loki, and a one-shot telemetry seed. It provides
local trace and log correlation without access to production infrastructure.

## Start and rebuild

Use Node 24 (`.nvmrc`), Go 1.26.5 or newer (`go.mod`), Mage, and Docker Compose
with support for the `!override` tag. The refresh used Node 24.21.0 and Go
1.27.1 locally; CI reads its Go version from `go.mod`.

```bash
npm ci
npm run build
mage buildAll
docker compose up --build -d
docker wait "$(docker compose ps -aq seed)"
docker compose logs seed
```

The seed must exit successfully and print `Indexed ... complete traces and
verified correlated Loki logs.` A successful collector POST alone is not
readiness. CI checks the seed's exit code before browser tests.

For a faster backend rebuild, use `mage build:linuxARM64` on Apple Silicon or
`mage build:linux` on x86_64. Grafana mounts `dist/`; restart it after replacing
backend binaries or changing `src/plugin.json`:

```bash
docker compose restart grafana
```

`npm run dev` watches frontend files. `npm run server` runs the full Compose
stack in the foreground. No generated `.config` files need editing.

## Data flow and services

The seed posts OTLP traces and logs to the collector. Traces go to OpenObserve;
logs go to both OpenObserve and Loki's native OTLP endpoint. OpenObserve stores
WAL/metadata locally and long-term objects in the RustFS `openobserve` bucket.
An idempotent AWS CLI job creates that bucket when absent.

| Service                | Pin                                           | Host endpoint                                           |
| ---------------------- | --------------------------------------------- | ------------------------------------------------------- |
| Grafana                | 13.2.3 by default; override `GRAFANA_VERSION` | http://localhost:3000                                   |
| OpenObserve            | v0.91.2                                       | http://localhost:5080; gRPC 5081                        |
| OTel collector contrib | 0.156.0                                       | OTLP HTTP 4318; gRPC 4317                               |
| RustFS                 | 1.0.0-beta.10                                 | S3 http://localhost:9000; console http://localhost:9001 |
| AWS CLI                | 2.31.0                                        | Bucket bootstrap only                                   |
| Loki                   | 3.7.0                                         | http://localhost:3100                                   |
| Seed                   | node:24-alpine                                | One-shot container                                      |

All published ports bind to loopback, including the Grafana debugger at 2345.
`DEV_BIND_ADDRESS=0.0.0.0` explicitly exposes them to other machines. This is a
development stack with anonymous Grafana admin access and known credentials;
keep it on a trusted network or use an SSH tunnel.

OpenObserve uses `root@example.com` / `Complexpass#123`. RustFS uses
`openobserve-access` / `openobserve-secret`. Loki has no local authentication.
These credentials are development fixtures, not production defaults to adopt.

The provisioned **OpenObserve Traces** datasource uses
`http://openobserve:5080`, organization `default` and trace stream `default`.
**Local Trace Logs** uses `http://loki:3100`. Trace-to-logs maps resource tag
`service.name` to label `service_name`, filters both trace and span IDs, and
widens the span's time range by one minute on either side.

## Seed data

```bash
docker compose run --rm seed
SEED_RANDOM_SEED=1 npm run seed
docker compose run --rm -e TRACE_COUNT=1000 -e TIME_SPREAD_MINUTES=360 seed
docker compose run --rm -e LARGE_TRACE_SPAN_COUNT=20000 seed
```

| Environment variable                       | Default and purpose                                                                           |
| ------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `TRACE_COUNT`                              | 200 normal scenarios, plus any asynchronous follow-up traces                                  |
| `TIME_SPREAD_MINUTES`                      | 60 minutes before the reference time                                                          |
| `ERROR_RATE`                               | 0.08                                                                                          |
| `SEED_RANDOM_SEED`                         | 1 in Compose; random on the host. `SEED` remains a legacy alias.                              |
| `REFERENCE_TIME_MS`                        | Current epoch milliseconds. Set with the random seed for fully repeatable timestamps and IDs. |
| `LARGE_TRACE_SPAN_COUNT`                   | 5001; set 0 to omit the large trace                                                           |
| `OTLP_HTTP_ENDPOINT`                       | `http://localhost:4318` on the host                                                           |
| `OPENOBSERVE_URL`, `LOKI_URL`              | Readiness endpoints, default localhost:5080 and localhost:3100                                |
| `OPENOBSERVE_USER`, `OPENOBSERVE_PASSWORD` | Readiness authentication; local fixture credentials above                                     |

Compose accepts `SEED_TRACE_COUNT`, `SEED_TIME_SPREAD_MINUTES`, and
`SEED_ERROR_RATE` to override the corresponding container variables.
Pass `REFERENCE_TIME_MS` with `docker compose run -e` when needed.

The random seed determines the scenario structure. Trace IDs also incorporate
the reference timestamp, so ordinary reruns get new IDs. Repeating both the
seed and reference timestamp reuses the same IDs and can duplicate ingested
rows; use a fresh dataset when reproducing that exact payload.

The simulated shop has web, API, product, cart, user, payment, inventory and
asynchronous order-processing services. It includes error status, exception
events, parent-child spans and links back to producing traces. Every span
emits a log containing its trace and span IDs. The large trace is tagged
`dev.scenario=large-trace` (stored as `dev_scenario` in OpenObserve).

The seed waits up to two minutes for the exact span count of every generated
trace and for correlated Loki logs. Keep the spread within OpenObserve's
24-hour local ingest allowance. Collector delivery failures, duplicate rows,
or rejected old spans cause readiness to fail rather than silently passing CI.

## Checks and troubleshooting

```bash
npm run typecheck
npm run lint
npm run test:ci
node --test dev/seed/*.test.mjs
go test -race ./pkg/...
npm run e2e
```

For the click-by-click checks, see [MANUAL-TESTING.md](MANUAL-TESTING.md).
For dated evidence and deployment prerequisites, see [VALIDATION.md](VALIDATION.md).

- If the plugin does not load, rebuild the backend for the container's
  architecture and restart Grafana. Check `docker compose logs grafana`.
- If seeding fails, inspect `docker compose logs seed otel-collector openobserve loki`.
  OpenObserve's HTTP exporter endpoint must end in `/api/default` without a
  trailing slash; Loki's endpoint is `/otlp`. The collector appends `/v1/logs`
  or `/v1/traces` as appropriate.
- If Explore has no data after a successful seed, select **Last 1 hour** or
  the window containing the recorded reference timestamp.
- If logs are absent, verify the logs datasource, `service.name` mapping, ID
  filters and the log retention window. The local setup uses Loki; other logs
  plugins need their own Grafana trace-link support.
- If images cannot be pulled, retry the registry request before changing a
  version pin. AWS CLI replaced the unavailable public `minio/mc` image.

OpenObserve flushes objects to S3 after its local WAL interval (60 seconds in
this stack). To inspect stored objects:

```bash
docker compose run --rm --entrypoint aws rustfs-init \
  --endpoint-url http://rustfs:9000 s3api list-objects-v2 \
  --bucket openobserve --max-items 10
```

`docker compose down` stops the stack and keeps data. Only use
`docker compose down -v` when you intend to delete all RustFS, OpenObserve and
Loki data volumes.
