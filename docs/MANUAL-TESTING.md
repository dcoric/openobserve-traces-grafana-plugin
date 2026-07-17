# Manual run & test walkthrough

Step-by-step instructions to run the local stack and exercise the plugin by
hand. Reference details (URLs, credentials, image pins, troubleshooting) live
in [`DEV-ENVIRONMENT.md`](DEV-ENVIRONMENT.md); the validation checklist this
walkthrough feeds is [`VALIDATION.md`](VALIDATION.md).

## 1. Build the plugin (once, and after code changes)

```bash
npm install
npm run build              # frontend → dist/
mage -v build:linuxARM64   # backend for the container on Apple Silicon
                           # use `mage -v build:linux` on x86_64 hosts
```

The Grafana container mounts `dist/`, so the backend binary must match the
container's architecture (`gpx_openobserve_traces_linux_arm64` on Apple
Silicon, `..._linux_amd64` on x86_64).

## 2. Start the stack

```bash
npm run server             # = docker compose up --build
```

Bring-up is ordered: `rustfs` → bucket init → `openobserve` → collector +
grafana → **seed runs automatically** and exits after pushing ~200 simulated
traces spread over the last hour. Watch for its completion line:

```
seed-1  | Done: 236 traces, 1260 spans (incl. 36 async order-processing traces with links).
```

## 3. Test in Grafana (the main event)

Open **http://localhost:3000** (anonymous admin, no login) → **Explore** →
datasource **OpenObserve Traces**.

### Search tab

- Run with defaults → a table of traces appears.
- Filter **Service** = `payment-service` and enable **Errors only** → only
  failed `PaymentService/Charge` traces should return.
- Try **Min duration** `200ms` → only slower traces remain.

### Waterfall (trace drill-down)

- Click any **trace ID** in the results → the native trace view opens.
- Check: spans nest under a single root, bar widths/offsets look sane, and
  error spans are marked red.
- Expand a failed `PaymentService/Charge` span → **Logs/Events** contain the
  `exception` event with type, message and stacktrace.
- Open an `orders process` span (service `order-processor`) → **References**
  link back to the originating checkout trace (cross-trace span link).

### Trace ID tab & node graph

- Paste a trace ID directly into the **Trace ID** tab.
- Toggle **Node graph** on → a service call graph renders above the waterfall.

### Cross-check against OpenObserve's own UI

Open **http://localhost:5080** (`root@example.com` / `Complexpass#123`) →
Traces, and open the same trace. Total duration, span offsets and bar widths
should match what Grafana shows — this is the §1 timing check from
[`VALIDATION.md`](VALIDATION.md).

## 4. Seed more / different data

```bash
npm run seed                                            # +200 traces from the host
docker compose run --rm -e TRACE_COUNT=1000 -e TIME_SPREAD_MINUTES=360 seed
docker compose run --rm -e SEED=42 seed                 # deterministic output
```

All generator knobs (`TRACE_COUNT`, `TIME_SPREAD_MINUTES`, `ERROR_RATE`,
`SEED`) are documented in [`DEV-ENVIRONMENT.md`](DEV-ENVIRONMENT.md#seeding-data).

## 5. Poke the layers directly (optional)

Raw OpenObserve search API — the exact payload shape the plugin's backend
consumes:

```bash
curl -s -u 'root@example.com:Complexpass#123' \
  'http://localhost:5080/api/default/_search?type=traces' \
  -H 'Content-Type: application/json' \
  -d '{"query":{"sql":"SELECT count(*) FROM \"default\"","start_time":'$(( ($(date +%s)-7200)*1000000 ))',"end_time":'$(( $(date +%s)*1000000 ))',"from":0,"size":10}}'
```

S3 leg — list the Parquet objects OpenObserve wrote (allow ~1 min after
seeding for the WAL→Parquet flush):

```bash
docker compose run --rm --entrypoint /bin/sh rustfs-init -c \
  'mc alias set rustfs http://rustfs:9000 openobserve-access openobserve-secret >/dev/null \
   && mc ls --recursive rustfs/openobserve'
```

Or browse the bucket in the RustFS console at **http://localhost:9001**
(`openobserve-access` / `openobserve-secret`).

Datasource health through the plugin backend:

```bash
curl -s http://localhost:3000/api/datasources/uid/openobserve-traces-local/health
# → {"message":"Connected to OpenObserve","status":"OK"}
```

## 6. Reset

```bash
docker compose down        # stop, keep data
docker compose down -v     # stop + wipe all volumes (fresh start)
```

If something misbehaves, see the troubleshooting section in
[`DEV-ENVIRONMENT.md`](DEV-ENVIRONMENT.md#troubleshooting) — e.g. "seed said
Done but Grafana shows nothing" is usually the Explore time range not covering
the seeded window, or collector-side delivery errors visible via
`docker compose logs otel-collector`.
