import { setTimeout } from 'node:timers/promises';

export function tracePayloadToLogs({ resourceSpans }) {
  return {
    resourceLogs: resourceSpans.map(({ resource, scopeSpans }) => ({
      resource,
      scopeLogs: scopeSpans.map(({ scope, spans }) => ({
        scope,
        logRecords: spans.map((span) => ({
          timeUnixNano: span.endTimeUnixNano,
          traceId: span.traceId,
          spanId: span.spanId,
          severityNumber: span.status.code === 2 ? 17 : 9,
          severityText: span.status.code === 2 ? 'ERROR' : 'INFO',
          body: {
            stringValue: JSON.stringify({
              message: `Completed ${span.name}`,
              trace_id: span.traceId,
              span_id: span.spanId,
              status: span.status.code === 2 ? 'error' : 'ok',
            }),
          },
        })),
      })),
    })),
  };
}

export async function waitForIndexedData(traces) {
  if (traces.length === 0) {
    throw new Error('No traces generated to verify');
  }
  const openobserve = process.env.OPENOBSERVE_URL ?? 'http://localhost:5080';
  const loki = process.env.LOKI_URL ?? 'http://localhost:3100';
  const authorization = Buffer.from(
    `${process.env.OPENOBSERVE_USER ?? 'root@example.com'}:${process.env.OPENOBSERVE_PASSWORD ?? 'Complexpass#123'}`
  ).toString('base64');
  const timestamps = traces.flatMap((trace) => trace.spans.map((span) => BigInt(span.startTimeUnixNano) / 1000n));
  const start = timestamps.reduce((a, b) => (a < b ? a : b)) - 1_000_000n;
  const end = timestamps.reduce((a, b) => (a > b ? a : b)) + 60_000_000n;
  const ids = traces.map((trace) => `'${trace.traceId}'`).join(',');
  const deadline = Date.now() + 120_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${openobserve}/api/default/_search?type=traces`, {
        method: 'POST',
        headers: { Authorization: `Basic ${authorization}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: {
            sql: `SELECT trace_id, count(*) AS span_count FROM "default" WHERE trace_id IN (${ids}) GROUP BY trace_id`,
            start_time: Number(start),
            end_time: Number(end),
            size: traces.length,
          },
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        throw new Error(`OpenObserve readiness HTTP ${response.status}`);
      }
      const { hits } = await response.json();
      const counts = new Map(hits.map((hit) => [hit.trace_id, Number(hit.span_count)]));
      const missing = traces.filter((trace) => counts.get(trace.traceId) !== trace.spans.length);
      if (missing.length > 0) {
        throw new Error(`${missing.length} traces still awaiting complete indexing`);
      }
      const first = traces[0];
      const query = new URLSearchParams({
        query: `{service_name="${first.spans[0].service}"} |= "${first.traceId}"`,
        start: String(start * 1000n),
        end: String(end * 1000n),
        limit: '1',
      });
      const logs = await fetch(`${loki}/loki/api/v1/query_range?${query}`, { signal: AbortSignal.timeout(10_000) });
      if (!logs.ok || !(await logs.json()).data?.result?.some((stream) => stream.values.length > 0)) {
        throw new Error('Loki is still awaiting correlated logs');
      }
      console.log(`Indexed ${traces.length} complete traces and verified correlated Loki logs.`);
      return;
    } catch (error) {
      lastError = error;
      await setTimeout(2000);
    }
  }
  throw new Error('Seed readiness timed out after 120 seconds', { cause: lastError });
}
