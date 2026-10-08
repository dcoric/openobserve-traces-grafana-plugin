import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tracePayloadToLogs } from './telemetry.mjs';

test('seed logs retain the resource, trace and span correlation and error severity', () => {
  const resource = { attributes: [{ key: 'service.name', value: { stringValue: 'checkout' } }] };
  const { resourceLogs } = tracePayloadToLogs({
    resourceSpans: [
      {
        resource,
        scopeSpans: [
          {
            scope: { name: 'test' },
            spans: [
              {
                name: 'POST /orders',
                traceId: 'a'.repeat(32),
                spanId: 'b'.repeat(16),
                endTimeUnixNano: '123000000',
                status: { code: 2 },
              },
            ],
          },
        ],
      },
    ],
  });
  assert.deepEqual(resourceLogs[0].resource, resource);
  const log = resourceLogs[0].scopeLogs[0].logRecords[0];
  assert.equal(log.traceId, 'a'.repeat(32));
  assert.equal(log.spanId, 'b'.repeat(16));
  assert.equal(log.timeUnixNano, '123000000');
  assert.equal(log.severityText, 'ERROR');
  assert.deepEqual(JSON.parse(log.body.stringValue), {
    message: 'Completed POST /orders',
    trace_id: 'a'.repeat(32),
    span_id: 'b'.repeat(16),
    status: 'error',
  });
});
