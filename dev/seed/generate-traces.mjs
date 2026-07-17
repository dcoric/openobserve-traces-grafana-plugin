#!/usr/bin/env node
/**
 * Trace simulation generator for the local dev stack.
 *
 * Emits realistic multi-service traces as OTLP/JSON over HTTP to the OTel
 * Collector (which forwards them to OpenObserve). No npm dependencies — runs
 * with plain Node >= 18 (global fetch), so it works both from the host and as
 * a one-shot `node:22-alpine` compose service.
 *
 * Environment:
 *   OTLP_HTTP_ENDPOINT  collector OTLP/HTTP base URL (default http://localhost:4318)
 *   TRACE_COUNT         number of traces to generate            (default 200)
 *   TIME_SPREAD_MINUTES traces are spread over the last N min   (default 60)
 *   ERROR_RATE          fraction of traces that fail            (default 0.08)
 *   SEED_RANDOM_SEED    integer for deterministic output        (default: 1 in compose)
 *   SEED                legacy alias for SEED_RANDOM_SEED
 *   LARGE_TRACE_SPAN_COUNT one deterministic trace's span count (default: 5001)
 *   REFERENCE_TIME_MS   optional Unix epoch reference for repeatable timestamps
 *
 * Usage:
 *   node dev/seed/generate-traces.mjs
 *   TRACE_COUNT=1000 TIME_SPREAD_MINUTES=360 node dev/seed/generate-traces.mjs
 *
 * NOTE on TIME_SPREAD_MINUTES: OpenObserve silently drops spans older than
 * ZO_INGEST_ALLOWED_UPTO hours (default 5) — and because this script posts to
 * the collector, o2's rejection response never reaches it, so drops are
 * invisible here. docker-compose.yaml sets ZO_INGEST_ALLOWED_UPTO=24; keep the
 * spread comfortably below that (or below ~270 min against a default o2).
 */

const OTLP_HTTP_ENDPOINT = process.env.OTLP_HTTP_ENDPOINT ?? 'http://localhost:4318';
const TRACE_COUNT = intEnv('TRACE_COUNT', 200);
const TIME_SPREAD_MINUTES = intEnv('TIME_SPREAD_MINUTES', 60);
const ERROR_RATE = floatEnv('ERROR_RATE', 0.08);
const SEED = intEnv('SEED_RANDOM_SEED', intEnv('SEED', Math.floor(Math.random() * 2 ** 31)));
const LARGE_TRACE_SPAN_COUNT = Math.max(0, intEnv('LARGE_TRACE_SPAN_COUNT', 5001));
const REFERENCE_TIME_MS = intEnv('REFERENCE_TIME_MS', Date.now());
const BATCH_SIZE = 50; // traces per OTLP request

function intEnv(name, dflt) {
  const v = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(v) ? v : dflt;
}
function floatEnv(name, dflt) {
  const v = Number.parseFloat(process.env[name] ?? '');
  return Number.isFinite(v) ? v : dflt;
}

// ---------------------------------------------------------------------------
// Deterministic PRNG (mulberry32) so SEED reproduces the exact same traces.
// ---------------------------------------------------------------------------

let prngState = SEED >>> 0;
function rand() {
  prngState |= 0;
  prngState = (prngState + 0x6d2b79f5) | 0;
  let t = Math.imul(prngState ^ (prngState >>> 15), 1 | prngState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const randBetween = (min, max) => min + rand() * (max - min);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const chance = (p) => rand() < p;

function hexId(bytes) {
  let s = '';
  for (let i = 0; i < bytes; i++) {
    s += Math.floor(rand() * 256)
      .toString(16)
      .padStart(2, '0');
  }
  return s;
}
const newTraceId = () => hexId(16);
const newSpanId = () => hexId(8);

// ---------------------------------------------------------------------------
// OTLP/JSON helpers (protobuf JSON mapping).
// ---------------------------------------------------------------------------

const SpanKind = { INTERNAL: 1, SERVER: 2, CLIENT: 3, PRODUCER: 4, CONSUMER: 5 };
const StatusCode = { UNSET: 0, OK: 1, ERROR: 2 };

function attrValue(v) {
  if (typeof v === 'boolean') {
    return { boolValue: v };
  }
  if (typeof v === 'number') {
    return Number.isInteger(v) ? { intValue: String(v) } : { doubleValue: v };
  }
  return { stringValue: String(v) };
}
const toAttrs = (obj) => Object.entries(obj).map(([key, v]) => ({ key, value: attrValue(v) }));

// ---------------------------------------------------------------------------
// Service catalog — each service gets its own OTLP resource so resource
// attributes (serviceTags in Grafana) are exercised per service.
// ---------------------------------------------------------------------------

const ENV = 'local-sim';
function makeResource(serviceName, extra = {}) {
  return {
    'service.name': serviceName,
    'service.version': `1.${(SEED % 9) + 1}.0`,
    'service.namespace': 'shop',
    'deployment.environment': ENV,
    'host.name': `${serviceName}-host`,
    'k8s.namespace.name': 'shop',
    'k8s.pod.name': `${serviceName}-${hexId(3)}`,
    'process.runtime.name': extra.runtime ?? 'nodejs',
    ...extra.attrs,
  };
}

const SERVICES = {
  'web-frontend': makeResource('web-frontend', { attrs: { 'browser.mobile': false } }),
  'api-gateway': makeResource('api-gateway'),
  'product-service': makeResource('product-service', { runtime: 'go' }),
  'cart-service': makeResource('cart-service', { runtime: 'go' }),
  'user-service': makeResource('user-service', { runtime: 'python' }),
  'payment-service': makeResource('payment-service', { runtime: 'jvm' }),
  'inventory-service': makeResource('inventory-service', { runtime: 'go' }),
  'order-processor': makeResource('order-processor', { runtime: 'jvm' }),
};

// ---------------------------------------------------------------------------
// Span builder. Times are BigInt nanoseconds since epoch.
// ---------------------------------------------------------------------------

const msToNs = (ms) => BigInt(Math.round(ms * 1e6));

/** A trace under construction: flat list of spans, each tagged with its service. */
class Trace {
  constructor(startMs) {
    this.traceId = newTraceId();
    this.startMs = startMs;
    this.spans = [];
  }

  /**
   * Add a span. start/duration are milliseconds relative to the trace start.
   * Returns the span so children can reference `.spanId` and error state.
   */
  span({ service, name, kind, parent, startOffsetMs, durationMs, attrs = {}, events = [], links = [], error }) {
    const startNs = msToNs(this.startMs + startOffsetMs);
    const span = {
      service,
      spanId: newSpanId(),
      parentSpanId: parent ? parent.spanId : '',
      name,
      kind,
      startTimeUnixNano: startNs.toString(),
      endTimeUnixNano: (startNs + msToNs(durationMs)).toString(),
      attributes: attrs,
      events,
      links,
      status: error
        ? { code: StatusCode.ERROR, message: error }
        : { code: kind === SpanKind.SERVER || kind === SpanKind.CLIENT ? StatusCode.OK : StatusCode.UNSET },
      startOffsetMs,
      durationMs,
    };
    this.spans.push(span);
    return span;
  }
}

function exceptionEvent(atOffsetMs, trace, type, message) {
  return {
    name: 'exception',
    timeUnixNano: msToNs(trace.startMs + atOffsetMs).toString(),
    attributes: toAttrs({
      'exception.type': type,
      'exception.message': message,
      'exception.stacktrace': `${type}: ${message}\n    at handler (/srv/app/index.js:42:13)\n    at process (/srv/app/router.js:88:9)`,
    }),
  };
}

function dbSpan(trace, parent, { peerService, system, statement, startOffsetMs, durationMs }) {
  return trace.span({
    service: parent.service,
    name: system === 'redis' ? 'GET' : 'SELECT shop',
    kind: SpanKind.CLIENT,
    parent,
    startOffsetMs,
    durationMs,
    attrs: {
      'db.system': system,
      'db.statement': statement,
      'db.name': system === 'redis' ? '0' : 'shop',
      'net.peer.name': peerService,
      'net.peer.port': system === 'redis' ? 6379 : 5432,
    },
  });
}

// ---------------------------------------------------------------------------
// Scenarios — each returns a fully populated Trace.
// ---------------------------------------------------------------------------

function httpServerAttrs(method, route, status) {
  return {
    'http.method': method,
    'http.route': route,
    'http.target': route.replace('{id}', String(Math.floor(randBetween(1, 5000)))),
    'http.status_code': status,
    'http.scheme': 'http',
    'net.host.name': 'shop.local',
  };
}

/** GET /api/products — frontend → gateway → product-service → redis (hit/miss) → postgres */
function productListing(startMs, fail) {
  const t = new Trace(startMs);
  const total = randBetween(40, 350);
  const status = fail ? 500 : 200;

  const root = t.span({
    service: 'web-frontend',
    name: 'GET /api/products',
    kind: SpanKind.SERVER,
    startOffsetMs: 0,
    durationMs: total,
    attrs: httpServerAttrs('GET', '/api/products', status),
    error: fail ? 'upstream returned 500' : undefined,
  });
  const gwClient = t.span({
    service: 'web-frontend',
    name: 'HTTP GET api-gateway',
    kind: SpanKind.CLIENT,
    parent: root,
    startOffsetMs: total * 0.05,
    durationMs: total * 0.9,
    attrs: { 'http.method': 'GET', 'http.url': 'http://api-gateway:8080/products', 'http.status_code': status },
  });
  const gw = t.span({
    service: 'api-gateway',
    name: 'GET /products',
    kind: SpanKind.SERVER,
    parent: gwClient,
    startOffsetMs: total * 0.07,
    durationMs: total * 0.85,
    attrs: httpServerAttrs('GET', '/products', status),
    error: fail ? 'product-service unavailable' : undefined,
  });
  const svc = t.span({
    service: 'product-service',
    name: 'ProductService/ListProducts',
    kind: SpanKind.SERVER,
    parent: gw,
    startOffsetMs: total * 0.1,
    durationMs: total * 0.75,
    attrs: { 'rpc.system': 'grpc', 'rpc.service': 'ProductService', 'rpc.method': 'ListProducts', 'page.size': 25 },
    error: fail ? 'connection reset by peer' : undefined,
    events: fail ? [exceptionEvent(total * 0.6, t, 'ConnectionError', 'connection reset by peer')] : [],
  });

  const cacheHit = !fail && chance(0.6);
  dbSpan(t, svc, {
    peerService: 'redis',
    system: 'redis',
    statement: 'GET products:page:1',
    startOffsetMs: total * 0.12,
    durationMs: randBetween(1, 6),
  });
  if (!cacheHit) {
    dbSpan(t, svc, {
      peerService: 'postgres',
      system: 'postgresql',
      statement: 'SELECT id, name, price FROM products ORDER BY popularity DESC LIMIT 25',
      startOffsetMs: total * 0.2,
      durationMs: total * 0.4,
    });
    t.span({
      service: 'product-service',
      name: 'cache.write',
      kind: SpanKind.INTERNAL,
      parent: svc,
      startOffsetMs: total * 0.65,
      durationMs: randBetween(1, 4),
      attrs: { 'cache.key': 'products:page:1', 'cache.ttl_seconds': 300 },
    });
  }
  return t;
}

/** POST /api/checkout — deepest trace: gateway → cart → payment (external) + inventory; emits a queue message */
function checkout(startMs, fail) {
  const t = new Trace(startMs);
  const total = randBetween(180, 900);
  const status = fail ? 402 : 201;
  const orderId = `ord-${hexId(4)}`;

  const root = t.span({
    service: 'web-frontend',
    name: 'POST /api/checkout',
    kind: SpanKind.SERVER,
    startOffsetMs: 0,
    durationMs: total,
    attrs: httpServerAttrs('POST', '/api/checkout', status),
    error: fail ? 'payment declined' : undefined,
  });
  const gw = t.span({
    service: 'api-gateway',
    name: 'POST /checkout',
    kind: SpanKind.SERVER,
    parent: root,
    startOffsetMs: total * 0.04,
    durationMs: total * 0.92,
    attrs: httpServerAttrs('POST', '/checkout', status),
    error: fail ? 'payment declined' : undefined,
  });
  const cart = t.span({
    service: 'cart-service',
    name: 'CartService/Checkout',
    kind: SpanKind.SERVER,
    parent: gw,
    startOffsetMs: total * 0.08,
    durationMs: total * 0.84,
    attrs: { 'rpc.system': 'grpc', 'rpc.service': 'CartService', 'rpc.method': 'Checkout', 'order.id': orderId, 'cart.items': Math.floor(randBetween(1, 8)) },
    error: fail ? 'PaymentDeclined: card_declined' : undefined,
  });

  dbSpan(t, cart, {
    peerService: 'postgres',
    system: 'postgresql',
    statement: 'SELECT sku, qty FROM cart_items WHERE cart_id = $1',
    startOffsetMs: total * 0.1,
    durationMs: randBetween(3, 15),
  });

  // Payment + inventory run in parallel.
  const pay = t.span({
    service: 'payment-service',
    name: 'PaymentService/Charge',
    kind: SpanKind.SERVER,
    parent: cart,
    startOffsetMs: total * 0.2,
    durationMs: total * 0.5,
    attrs: { 'rpc.system': 'grpc', 'payment.amount': Math.round(randBetween(10, 500) * 100) / 100, 'payment.currency': 'GBP', 'order.id': orderId },
    error: fail ? 'card_declined' : undefined,
    events: fail ? [exceptionEvent(total * 0.55, t, 'PaymentDeclined', 'card_declined: insufficient funds')] : [],
  });
  t.span({
    service: 'payment-service',
    name: 'HTTP POST psp.example.com',
    kind: SpanKind.CLIENT,
    parent: pay,
    startOffsetMs: total * 0.25,
    durationMs: total * 0.4,
    attrs: { 'http.method': 'POST', 'http.url': 'https://psp.example.com/v1/charges', 'http.status_code': fail ? 402 : 200, 'peer.service': 'psp.example.com' },
    error: fail ? 'HTTP 402' : undefined,
  });

  const inv = t.span({
    service: 'inventory-service',
    name: 'InventoryService/Reserve',
    kind: SpanKind.SERVER,
    parent: cart,
    startOffsetMs: total * 0.2,
    durationMs: total * 0.3,
    attrs: { 'rpc.system': 'grpc', 'order.id': orderId },
  });
  dbSpan(t, inv, {
    peerService: 'postgres',
    system: 'postgresql',
    statement: 'UPDATE stock SET reserved = reserved + $1 WHERE sku = $2',
    startOffsetMs: total * 0.25,
    durationMs: randBetween(5, 25),
  });

  if (!fail) {
    // Producer span; a separate order-processor trace links back to it.
    const producer = t.span({
      service: 'cart-service',
      name: 'orders publish',
      kind: SpanKind.PRODUCER,
      parent: cart,
      startOffsetMs: total * 0.8,
      durationMs: randBetween(2, 10),
      attrs: { 'messaging.system': 'kafka', 'messaging.destination.name': 'orders', 'messaging.operation': 'publish', 'order.id': orderId },
    });
    t.producedMessage = { traceId: t.traceId, spanId: producer.spanId, orderId, publishedAtMs: startMs + total * 0.8 };
  }
  return t;
}

/** Async consumer: separate trace linked to the checkout's PRODUCER span. */
function orderProcessing(msg) {
  const startMs = msg.publishedAtMs + randBetween(20, 400);
  const t = new Trace(startMs);
  const total = randBetween(50, 400);

  const consume = t.span({
    service: 'order-processor',
    name: 'orders process',
    kind: SpanKind.CONSUMER,
    startOffsetMs: 0,
    durationMs: total,
    attrs: { 'messaging.system': 'kafka', 'messaging.destination.name': 'orders', 'messaging.operation': 'process', 'order.id': msg.orderId },
    links: [{ traceId: msg.traceId, spanId: msg.spanId, attributes: toAttrs({ 'messaging.operation': 'publish' }) }],
  });
  dbSpan(t, consume, {
    peerService: 'postgres',
    system: 'postgresql',
    statement: 'INSERT INTO orders (id, status) VALUES ($1, $2)',
    startOffsetMs: total * 0.2,
    durationMs: randBetween(4, 20),
  });
  t.span({
    service: 'order-processor',
    name: 'send confirmation email',
    kind: SpanKind.INTERNAL,
    parent: consume,
    startOffsetMs: total * 0.5,
    durationMs: randBetween(10, 80),
    attrs: { 'email.template': 'order-confirmation' },
  });
  return t;
}

/** GET /api/user/{id} — small, fast trace */
function userProfile(startMs, fail) {
  const t = new Trace(startMs);
  const total = randBetween(10, 120);
  const status = fail ? 404 : 200;

  const root = t.span({
    service: 'web-frontend',
    name: 'GET /api/user/{id}',
    kind: SpanKind.SERVER,
    startOffsetMs: 0,
    durationMs: total,
    attrs: httpServerAttrs('GET', '/api/user/{id}', status),
    error: fail ? 'user not found' : undefined,
  });
  const gw = t.span({
    service: 'api-gateway',
    name: 'GET /user/{id}',
    kind: SpanKind.SERVER,
    parent: root,
    startOffsetMs: total * 0.08,
    durationMs: total * 0.85,
    attrs: httpServerAttrs('GET', '/user/{id}', status),
  });
  const svc = t.span({
    service: 'user-service',
    name: 'UserService/GetUser',
    kind: SpanKind.SERVER,
    parent: gw,
    startOffsetMs: total * 0.15,
    durationMs: total * 0.7,
    attrs: { 'rpc.system': 'grpc', 'rpc.service': 'UserService', 'rpc.method': 'GetUser' },
    error: fail ? 'NotFound' : undefined,
  });
  dbSpan(t, svc, {
    peerService: 'postgres',
    system: 'postgresql',
    statement: 'SELECT * FROM users WHERE id = $1',
    startOffsetMs: total * 0.25,
    durationMs: total * 0.4,
  });
  return t;
}

function largeTrace(startMs, spanCount) {
  const t = new Trace(startMs);
  const root = t.span({
    service: 'product-service',
    name: 'large-trace root',
    kind: SpanKind.SERVER,
    startOffsetMs: 0,
    durationMs: Math.max(1, spanCount * 0.01 + 1),
    attrs: { 'dev.scenario': 'large-trace', 'dev.span_count': spanCount, 'dev.span_index': 0 },
  });
  for (let i = 1; i < spanCount; i++) {
    t.span({
      service: 'product-service',
      name: `large-trace span ${String(i).padStart(4, '0')}`,
      kind: SpanKind.INTERNAL,
      parent: root,
      startOffsetMs: i * 0.01,
      durationMs: 1,
      attrs: { 'dev.scenario': 'large-trace', 'dev.span_count': spanCount, 'dev.span_index': i },
    });
  }
  return t;
}

const SCENARIOS = [
  { build: productListing, weight: 5 },
  { build: checkout, weight: 3 },
  { build: userProfile, weight: 4 },
];

function pickScenario() {
  const totalWeight = SCENARIOS.reduce((s, sc) => s + sc.weight, 0);
  let r = rand() * totalWeight;
  for (const sc of SCENARIOS) {
    r -= sc.weight;
    if (r <= 0) {
      return sc;
    }
  }
  return SCENARIOS[0];
}

// ---------------------------------------------------------------------------
// OTLP export: group spans by service into resourceSpans and POST.
// ---------------------------------------------------------------------------

function tracesToOtlpPayload(traces) {
  const byService = new Map();
  for (const trace of traces) {
    for (const span of trace.spans) {
      if (!byService.has(span.service)) {
        byService.set(span.service, []);
      }
      byService.get(span.service).push({
        traceId: trace.traceId,
        spanId: span.spanId,
        ...(span.parentSpanId ? { parentSpanId: span.parentSpanId } : {}),
        name: span.name,
        kind: span.kind,
        startTimeUnixNano: span.startTimeUnixNano,
        endTimeUnixNano: span.endTimeUnixNano,
        attributes: toAttrs(span.attributes),
        events: span.events,
        links: span.links ?? [],
        status: span.status,
      });
    }
  }
  return {
    resourceSpans: [...byService.entries()].map(([service, spans]) => ({
      resource: { attributes: toAttrs(SERVICES[service]) },
      scopeSpans: [{ scope: { name: 'o2-traces-seed', version: '1.0.0' }, spans }],
    })),
  };
}

async function postBatch(payload, attempt = 1) {
  const url = `${OTLP_HTTP_ENDPOINT.replace(/\/$/, '')}/v1/traces`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await res.text();
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${body.slice(0, 300)}`);
    }
    const parsed = body ? JSON.parse(body) : {};
    if (parsed.partialSuccess?.rejectedSpans) {
      console.warn(`partial success: ${parsed.partialSuccess.rejectedSpans} spans rejected — ${parsed.partialSuccess.errorMessage}`);
    }
  } catch (err) {
    if (attempt >= 5) {
      throw err;
    }
    const backoffMs = 1000 * attempt;
    console.warn(`POST ${url} failed (${err.message ?? err}), retry ${attempt}/4 in ${backoffMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, backoffMs));
    return postBatch(payload, attempt + 1);
  }
}

async function main() {
  console.log(`Generating ${TRACE_COUNT} traces over the last ${TIME_SPREAD_MINUTES} min (seed=${SEED}, errorRate=${ERROR_RATE})`);
  console.log(`OTLP/HTTP endpoint: ${OTLP_HTTP_ENDPOINT}`);

  const spreadMs = TIME_SPREAD_MINUTES * 60 * 1000;
  const traces = [];
  const pendingMessages = [];
  let largeTraceId;

  for (let i = 0; i < TRACE_COUNT; i++) {
    // Leave a small head gap so child spans never land in the future.
    const startMs = REFERENCE_TIME_MS - 5000 - rand() * spreadMs;
    const trace = pickScenario().build(startMs, chance(ERROR_RATE));
    traces.push(trace);
    if (trace.producedMessage) {
      pendingMessages.push(trace.producedMessage);
    }
  }
  for (const msg of pendingMessages) {
    traces.push(orderProcessing(msg));
  }
  if (LARGE_TRACE_SPAN_COUNT > 0) {
    const trace = largeTrace(REFERENCE_TIME_MS - 5000, LARGE_TRACE_SPAN_COUNT);
    traces.push(trace);
    largeTraceId = trace.traceId;
  }

  let sent = 0;
  for (let i = 0; i < traces.length; i += BATCH_SIZE) {
    const batch = traces.slice(i, i + BATCH_SIZE);
    await postBatch(tracesToOtlpPayload(batch));
    sent += batch.length;
    console.log(`  sent ${sent}/${traces.length} traces`);
  }

  const spanCount = traces.reduce((s, t) => s + t.spans.length, 0);
  console.log(`Done: ${traces.length} traces, ${spanCount} spans (incl. ${pendingMessages.length} async order-processing traces with links).`);
  console.log(`Example trace id: ${traces[0]?.traceId ?? 'none'}`);
  if (largeTraceId) {
    console.log(`Large trace: traceId=${largeTraceId} spans=${LARGE_TRACE_SPAN_COUNT} scenario=large-trace`);
  }
}

main().catch((err) => {
  console.error('trace generation failed:', err);
  process.exit(1);
});
