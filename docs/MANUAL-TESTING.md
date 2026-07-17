# Manual run & test walkthrough

Step-by-step instructions to run the local stack and exercise the plugin by
hand. Reference details (URLs, credentials, image pins, troubleshooting) live
in [`DEV-ENVIRONMENT.md`](DEV-ENVIRONMENT.md); the validation checklist this
walkthrough feeds is [`VALIDATION.md`](VALIDATION.md).

Each step below is annotated with the [`REQUIREMENTS.md`](../REQUIREMENTS.md)
requirement IDs and acceptance-gate bullets (Gates A and B) it exercises, so a
completed walkthrough doubles as gate evidence.

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
traces spread over the last hour plus one 5,001-span trace. The compose seed
is structurally deterministic (pinned `SEED_RANDOM_SEED=1`: same IDs, spans,
scenarios); timestamps default to the current time, so for Gate B's
"deterministic traces" evidence also set `REFERENCE_TIME_MS` and record the
invocation (see [`VALIDATION.md`](VALIDATION.md) §8). Watch for the seed's
completion lines:

```
seed-1  | Done: 237 traces, 6261 spans (incl. 36 async order-processing traces with links).
seed-1  | Large trace: traceId=<32-hex> spans=5001 scenario=large-trace
```

Keep the `Large trace: traceId=...` value — you will paste it into the
truncation check below.

## 3. Test in Grafana (the main event)

Open **http://localhost:3000** (anonymous admin, no login) → **Explore** →
datasource **OpenObserve Traces**.

### Datasource configuration _(CF-01..CF-03, CF-05 — Gate A: "A user can configure OpenObserve connection details in Grafana")_

The provisioned datasource skips this flow, so exercise it once by hand:
**Connections → Data sources → Add new data source → OpenObserve Traces**
(or open the provisioned one). Set URL `http://openobserve:5080`, enable
Basic auth (`root@example.com` / `Complexpass#123` — the password lands in a
secure field), Organization `default`, Default traces stream `default`, and
click **Save & test** → "Connected to OpenObserve". Break the password and
save again → a clear error, not a silent failure (CF-05).

### Search tab _(SQ-01..SQ-06 — Gate A: search, filters, no raw SQL)_

- Run with defaults → a table of traces appears (SQ-01, SQ-02).
- Filter **Service** = `payment-service` and enable **Errors only** → only
  failed `PaymentService/Charge` traces should return (SQ-03, SQ-05).
- Set **Span name** = `PaymentService/Charge` → only traces containing that
  operation return (SQ-04).
- Try **Min duration** `200ms` → only slower traces remain (SQ-06).
- Injection probe (SR-02 — Gate A: "User filters cannot inject raw SQL"): set
  **Service** to `payment-service' OR '1'='1` → it must be treated as a
  literal string — zero results and no query error, never a widened result
  set.

### Waterfall (trace drill-down) _(TR-02..TR-04, TR-06 — Gate A: waterfall, parent-child, errors/timing visible)_

- Click any **trace ID** in the results → the native trace view opens.
- Check: spans nest under a single root, bar widths/offsets look sane, and
  error spans are marked red (TR-03, TR-04).
- Expand a failed `PaymentService/Charge` span → **Logs/Events** contain the
  `exception` event with type, message and stacktrace (TR-06).
- Open an `orders process` span (service `order-processor`) → **References**
  link back to the originating checkout trace (cross-trace span link, TR-06).

### Trace ID tab & node graph _(TR-01, TR-07)_

- Paste a trace ID directly into the **Trace ID** tab (TR-01).
- Toggle **Node graph** on → a span-level node graph renders above the
  waterfall (one node per span, edges = parent-child relationships). It shows
  span relationships within this trace — it is **not** a Tempo-style service
  graph (TR-07).

### Truncation warning (large trace) _(TR-05, SR-03, SR-05, DV-06 — Gates A+B: partial results are never silent)_

- Paste the seed's `Large trace: traceId=...` value into the **Trace ID** tab.
- The waterfall renders at most 5,000 of the 5,001 spans **and** Grafana shows
  a visible warning that OpenObserve returned fewer spans than the trace
  total. A silently complete-looking result here is a bug.
- Caveat: every seed re-run with the same `SEED_RANDOM_SEED` re-ingests the
  **same** large-trace ID (a second `docker compose up` doubles it to
  10,002 spans at new timestamps), so the warning's span total grows. For the
  clean "5,000 of 5,001" case, start from `docker compose down -v`.
- Back on the **Search** tab, set **Limit** to a value the result set fills
  (e.g. `10`) → the results table carries a "search returned the maximum of
  10 traces; more may match" warning (SR-03).

### Cross-check against OpenObserve's own UI _(TR-02/TR-04 timing correctness — Gate A)_

Open **http://localhost:5080** (`root@example.com` / `Complexpass#123`) →
Traces, and open the same trace. Total duration, span offsets and bar widths
should match what Grafana shows — this is the §1 timing check from
[`VALIDATION.md`](VALIDATION.md).

## 4. Seed more / different data _(DV-03..DV-06)_

```bash
npm run seed                                            # +200 traces from the host
                                                        # (random seed unless
                                                        #  SEED_RANDOM_SEED is set)
docker compose run --rm -e TRACE_COUNT=1000 -e TIME_SPREAD_MINUTES=360 seed
docker compose run --rm -e SEED_RANDOM_SEED=42 seed     # deterministic IDs/structure
```

All generator knobs (`TRACE_COUNT`, `TIME_SPREAD_MINUTES`, `ERROR_RATE`,
`SEED_RANDOM_SEED`, `LARGE_TRACE_SPAN_COUNT`, `REFERENCE_TIME_MS`) are
documented in [`DEV-ENVIRONMENT.md`](DEV-ENVIRONMENT.md#seeding-data).

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
seeding for the WAL→Parquet flush). This is Gate B's "OpenObserve stores local
data through RustFS" evidence (DV-02):

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
