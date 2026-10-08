import { expect, test } from '@grafana/plugin-e2e';
import type { O2Query } from '../src/types';

function exploreParams(uid: string, query: Partial<O2Query>, range = { from: 'now-1h', to: 'now' }) {
  return new URLSearchParams({ left: JSON.stringify({ datasource: uid, queries: [{ refId: 'A', ...query }], range }) });
}

test('search links open the native waterfall, error details, node graph and correlated logs', async ({
  explorePage,
  page,
  selectors,
  readProvisionedDataSource,
}) => {
  const datasource = await readProvisionedDataSource({ fileName: 'datasources.yml' });
  await explorePage.goto({
    queryParams: exploreParams(datasource.uid, {
      queryType: 'search',
      service: 'web-frontend',
      statusError: true,
      limit: 1,
    }),
  });
  const link = page.getByRole('link', { name: /^[a-f0-9]{32}$/ }).first();
  await expect(link).toBeVisible();
  const traceID = await link.innerText();
  await link.click();
  const trace = page.getByRole('region', { name: 'Trace', exact: true });
  await expect(trace.getByRole('heading', { name: /^web-\s*frontend(?::|\s)/ })).toBeVisible();
  await expect(explorePage.getByGrafanaSelector(selectors.components.TraceViewer.spanBar).first()).toBeVisible();
  await explorePage.getByGrafanaSelector(selectors.components.TraceViewer.spanBar).first().click();
  await expect(trace).toContainText('Status:error');
  await expect(trace.getByRole('switch', { name: 'Resource attributes' })).toBeVisible();
  await expect(trace).toContainText('service.name');

  const graph = page.getByRole('region', { name: 'Node graph', exact: true });
  await graph.getByRole('button', { name: 'Node graph', exact: true }).click();
  await expect(graph).toContainText('web-frontend');
  await trace
    .getByRole('button', { name: 'Logs for this span' })
    .or(trace.getByRole('link', { name: 'Explore the logs for this in split view' }).first())
    .first()
    .click();
  const logs = page.getByRole('region', { name: 'Logs', exact: true });
  await expect(logs).toContainText(traceID);
  await expect(logs).toContainText('Completed');
  await expect(logs).toContainText(/"status":\s*"error"/);
});

test('large traces display the native waterfall and a truncation warning', async ({
  explorePage,
  page,
  selectors,
  readProvisionedDataSource,
}) => {
  const datasource = await readProvisionedDataSource({ fileName: 'datasources.yml' });
  await explorePage.goto({
    queryParams: exploreParams(datasource.uid, {
      queryType: 'search',
      tags: [{ key: 'dev_scenario', value: 'large-trace' }],
      limit: 1,
    }),
  });
  await expect(page.getByRole('region', { name: 'Table - Traces' }).getByText('5001', { exact: true })).toBeVisible();
  await page
    .getByRole('link', { name: /^[a-f0-9]{32}$/ })
    .first()
    .click();
  await expect(explorePage.getByGrafanaSelector(selectors.components.TraceViewer.spanBar).first()).toBeVisible();
  await expect(page.getByRole('region', { name: 'Trace', exact: true })).toContainText('5000 spans');
  await page.getByText('1 warning', { exact: true }).last().hover();
  await expect(page.getByText('Trace contains more than 5000 spans; showing the first 5000 spans.')).toBeVisible();
});

test('trace lookup includes five-minute padding and reports an empty range outside it', async ({
  explorePage,
  page,
  selectors,
  readProvisionedDataSource,
}) => {
  const datasource = await readProvisionedDataSource({ fileName: 'datasources.yml' });
  const response = explorePage.waitForQueryDataResponse();
  await explorePage.goto({
    queryParams: exploreParams(datasource.uid, {
      queryType: 'search',
      service: 'web-frontend',
      limit: 1,
    }),
  });
  const body = await (await response).json();
  const frame = body.results.A.frames[0];
  const traceID: string = frame.data.values[0][0];
  const start: number = frame.data.values[1][0];
  expect(traceID).toMatch(/^[a-f0-9]{32}$/);
  for (const offset of [-4, 4]) {
    await explorePage.goto({
      queryParams: exploreParams(
        datasource.uid,
        { queryType: 'traceId', traceId: traceID },
        {
          from: String(start + offset * 60_000),
          to: String(start + offset * 60_000 + 1000),
        }
      ),
    });
    await expect(explorePage.getByGrafanaSelector(selectors.components.TraceViewer.spanBar).first()).toBeVisible();
  }
  const emptyResponse = explorePage.waitForQueryDataResponse();
  await explorePage.goto({
    queryParams: exploreParams(
      datasource.uid,
      { queryType: 'traceId', traceId: traceID },
      {
        from: String(start + 6 * 60_000),
        to: String(start + 6 * 60_000 + 1000),
      }
    ),
  });
  const empty = await (await emptyResponse).json();
  expect(empty.results.A.frames[0].data.values[0]).toHaveLength(0);
  await expect(page.getByRole('region', { name: 'Trace', exact: true })).toHaveCount(0);
  await expect(explorePage.getByGrafanaSelector(selectors.components.TraceViewer.spanBar)).toHaveCount(0);
});

test('invalid trace IDs display the backend validation error', async ({
  explorePage,
  page,
  readProvisionedDataSource,
}) => {
  const datasource = await readProvisionedDataSource({ fileName: 'datasources.yml' });
  await explorePage.goto({
    queryParams: exploreParams(datasource.uid, { queryType: 'traceId', traceId: 'not-a-trace' }),
  });
  await expect(page.getByText(/invalid trace id.*must be hexadecimal/)).toBeVisible();
});
