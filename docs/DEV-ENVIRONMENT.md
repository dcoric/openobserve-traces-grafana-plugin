# Local dev environment

A docker-compose emulation of GR's production observability stack — S3 bucket
storage, OpenObserve, OTel Collector, Grafana — with simulated trace data, so
the plugin can be developed and validated without access to GR infrastructure.

This environment provides a compose stack with RustFS-backed OpenObserve,
repeatable multi-service trace seeding, error and large-trace scenarios,
documented loopback ports, and exact setup commands.

> For a hands-on walkthrough (what to click, what correct results look like),
> see [`MANUAL-TESTING.md`](MANUAL-TESTING.md). This file is the reference.

```
 dev/seed/generate-traces.mjs (one-shot "seed" service, or `npm run seed`)
   │  OTLP/JSON  http://otel-collector:4318/v1/traces
   ▼
 otel-collector  (otel/opentelemetry-collector-contrib:0.156.0)
   │  OTLP/HTTP + Basic auth  http://openobserve:5080/api/default
   ▼
 openobserve  (v0.91.2, single-node, ZO_LOCAL_MODE_STORAGE=s3)
   │  S3 API (path-style)  http://rustfs:9000, bucket "openobserve"
   ▼
 rustfs  (1.0.0-beta.10) ← bucket created by one-shot "rustfs-init" (minio/mc)

 grafana :3000 ── provisioned "OpenObserve Traces" datasource → openobserve:5080
```

## Start

```bash
npm install
npm run build                # frontend → dist/
mage -v build:linuxARM64     # backend for the container (Apple Silicon)
                             # use build:linux on x86_64 hosts / CI
npm run server               # docker compose up --build
```

Bring-up order is dependency-gated: rustfs (healthy) → rustfs-init creates the
bucket (must complete) → openobserve (healthy) → otel-collector + grafana →
seed runs once and exits after pushing ~200 normal traces plus one deterministic
large trace (5,001 spans by default) spread over the last hour.

All published ports bind to `127.0.0.1` by default, including Grafana's HTTP
and delve ports. To expose the stack to another machine, opt in explicitly:

```bash
DEV_BIND_ADDRESS=0.0.0.0 docker compose up --build
```

Security warning: `0.0.0.0` exposes unauthenticated dev Grafana and the fixed
development OpenObserve/RustFS credentials to every reachable interface. Use
it only on a trusted, firewalled network and prefer an SSH tunnel for remote
access.

## URLs & credentials

| What                   | Where                                        | Credentials                                 |
| ---------------------- | -------------------------------------------- | ------------------------------------------- |
| Grafana                | http://localhost:3000                        | anonymous admin (dev image)                 |
| Provisioned datasource | Explore → **OpenObserve Traces**             | pre-configured                              |
| OpenObserve UI         | http://localhost:5080                        | `root@example.com` / `Complexpass#123`      |
| OTLP from host apps    | grpc `localhost:4317`, http `localhost:4318` | none (collector)                            |
| RustFS console         | http://localhost:9001                        | `openobserve-access` / `openobserve-secret` |
| RustFS S3 API          | http://localhost:9000                        | same keys, path-style                       |

Host ports used: 3000, 2345 (delve, from the Grafana dev image), 4317, 4318,
5080, 5081, 9000, 9001.

## Seeding data

The seed service runs automatically on `up`. Re-seed any time:

```bash
docker compose run --rm seed                       # another 200 traces, last 60 min
docker compose run --rm -e TRACE_COUNT=1000 -e TIME_SPREAD_MINUTES=360 seed
SEED_RANDOM_SEED=1 npm run seed                    # from the host (Node >= 18)
docker compose run --rm -e LARGE_TRACE_SPAN_COUNT=20000 seed  # bigger truncation case
                                                   # (a 5,001-span trace is already seeded
                                                   #  by default)
```

Generator knobs (env): `TRACE_COUNT` (200), `TIME_SPREAD_MINUTES` (60),
`ERROR_RATE` (0.08), `SEED_RANDOM_SEED` (compose default 1; unset on the host
it falls back to a random seed; `SEED` remains a
legacy alias), `LARGE_TRACE_SPAN_COUNT` (compose default 5001; set to 0 to
disable), and optional `REFERENCE_TIME_MS` for repeatable timestamps.
`OTLP_HTTP_ENDPOINT` defaults to `http://localhost:4318` on the host.
Compose-level defaults can be set via `SEED_TRACE_COUNT`,
`SEED_TIME_SPREAD_MINUTES`, `SEED_ERROR_RATE`, `SEED_RANDOM_SEED`, and
`LARGE_TRACE_SPAN_COUNT`. The seed logs the large trace ID and span count so it
can be pasted into Grafana's Trace ID search.

Re-running the compose seed with the same fixed seed reuses trace IDs at new
timestamps. Use a different `SEED_RANDOM_SEED`, or reset the volumes, when a
clean one-trace-per-ID dataset matters.

The simulated system is a small shop with eight resource services:
`web-frontend → api-gateway → product/cart/user/payment/inventory services`,
plus an async `order-processor` whose traces **link** back to the checkout
trace's PRODUCER span. Database and cache CLIENT spans remain children of the
calling resource service; their `net.peer.name` values identify postgres or
redis endpoints, which are not emitted as fake resource services. ~8% of
traces fail with ERROR status + `exception` events. This exercises the
waterfall, node graph, span logs (events), references (links), kind icons, and
search filters. The large-trace scenario reuses `product-service` and
marks every span with `dev.scenario=large-trace`.

Keep `TIME_SPREAD_MINUTES` well below o2's backdated-ingest window
(`ZO_INGEST_ALLOWED_UPTO`, set to 24h in compose; o2 default is 5h) — spans
older than the window are **silently dropped** (the rejection is only visible
in collector logs, not to the seed script).

## Verifying the S3 leg

o2 serves fresh data from its local WAL; Parquet lands in the bucket only
after `ZO_MAX_FILE_RETENTION_TIME` (set to 60s in compose; default 600s). An
empty bucket in the first minute is **not** a misconfiguration. To check:

```bash
# objects present?
docker compose run --rm --entrypoint /bin/sh rustfs-init -c \
  'mc alias set rustfs http://rustfs:9000 openobserve-access openobserve-secret >/dev/null \
   && mc ls --recursive rustfs/openobserve | head'

# any storage errors in o2?
docker compose logs openobserve | grep -iE 's3|storage' | grep -iE 'error|fail'

# force reads from S3 (not memtable): restart o2, then re-query an old trace
docker compose restart openobserve
```

## Reset / wipe

```bash
docker compose down              # stop, keep data
docker compose down -v           # stop and WIPE rustfs + openobserve volumes
```

## Pinned versions (bump deliberately)

| Image                                           | Why this pin                                                                                                                                                   |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `public.ecr.aws/zinclabs/openobserve:v0.91.2`   | Latest stable at pin time (2026-07-17). Env vars/routes used here verified against this tag's source. Re-pin to the deployment's exact version before rollout. |
| `rustfs/rustfs:1.0.0-beta.10`                   | Latest beta at pin time — RustFS is beta with fast release churn; record the digest after first pull if reproducibility matters.                               |
| `otel/opentelemetry-collector-contrib:0.156.0`  | Latest stable contrib release at pin time.                                                                                                                     |
| `minio/mc:RELEASE.2025-08-13T08-35-41Z`         | Bucket bootstrap only (`mc mb -p` is idempotent).                                                                                                              |
| Grafana (via `GRAFANA_VERSION`, default 13.0.2) | From `.config/docker-compose-base.yaml`.                                                                                                                       |

## Troubleshooting

- **Plugin fails to load in Grafana** — the backend binary for the container's
  architecture must exist in `dist/` (`gpx_openobserve_traces_linux_arm64` on
  Apple Silicon, `..._linux_amd64` on x86_64). Run the matching `mage
build:...` target. Changing `plugin.json` requires a Grafana restart.
- **No traces in Grafana but seed said "Done"** — check collector logs
  (`docker compose logs otel-collector`) for 4xx from o2: auth header, or the
  endpoint having a trailing slash (must be `/api/default`, the exporter
  appends `/v1/traces`). Also confirm the time range in Grafana covers the
  seeded window.
- **o2 can't write to the bucket** — confirm `rustfs-init` completed
  (`docker compose ps -a`), then look for upload errors in o2 logs. Break-glass
  options, in order: set `ZO_S3_FEATURE_HTTP1_ONLY=true` on o2; try
  `ZO_S3_PROVIDER=s3` instead of `minio`; swap the `rustfs` service for
  `minio/minio` (RustFS is beta — o2↔RustFS has no prior art; this stack is
  the first exercise of it, by design).
- **Seed spans partially missing** — spread exceeded the ingest window; see
  "Seeding data" above.
- **gRPC ingest** (if you point an app at o2:5081 directly) — requires the
  `organization: default` metadata header; HTTP ingest must NOT set it.
