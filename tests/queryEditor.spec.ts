import { expect, test } from '@grafana/plugin-e2e';
import { lt } from 'semver';

test('trace search returns seeded rows without a raw SQL escape hatch', async ({
  grafanaVersion,
  panelEditPage,
  readProvisionedDataSource,
}) => {
  const provisioned = await readProvisionedDataSource({ fileName: 'datasources.yml' });
  await panelEditPage.datasource.set(provisioned.name);
  if (lt(grafanaVersion, '12.4.0')) {
    await panelEditPage.setVisualization('Table');
  }

  const queryEditor = panelEditPage.getQueryEditorRow('A');
  await expect(queryEditor.getByRole('combobox', { name: 'Stream', exact: true })).toBeVisible();
  await queryEditor.getByRole('textbox', { name: 'Service', exact: true }).fill('web-frontend');
  await queryEditor.getByRole('textbox', { name: 'Span name', exact: true }).fill('GET /api/products');
  await queryEditor.getByRole('textbox', { name: 'Min duration', exact: true }).fill('1ms');
  await queryEditor.getByRole('textbox', { name: 'Max duration', exact: true }).fill('2s');
  await expect(queryEditor.getByRole('textbox', { name: /Raw (WHERE|SQL)/i })).toHaveCount(0);

  const queryRequest = panelEditPage.waitForQueryDataRequest();
  await expect(panelEditPage.refreshPanel()).toBeOK();
  const requestBody = (await queryRequest).postData() ?? '';

  expect(requestBody).not.toContain('rawWhere');
  expect(requestBody).not.toContain('rawSql');
  await expect(panelEditPage.panel.data.filter({ hasText: 'web-frontend' })).not.toHaveCount(0);
});

test('a searched seeded trace can be opened through direct trace lookup', async ({
  grafanaVersion,
  panelEditPage,
  readProvisionedDataSource,
}) => {
  const provisioned = await readProvisionedDataSource({ fileName: 'datasources.yml' });
  await panelEditPage.datasource.set(provisioned.name);
  if (lt(grafanaVersion, '12.4.0')) {
    await panelEditPage.setVisualization('Table');
  }

  const queryEditor = panelEditPage.getQueryEditorRow('A');
  await queryEditor.getByRole('textbox', { name: 'Service', exact: true }).fill('web-frontend');
  const searchResponse = panelEditPage.waitForQueryDataResponse();
  await expect(panelEditPage.refreshPanel()).toBeOK();
  const responseBody = await (await searchResponse).text();
  const traceIDMatch = responseBody.match(/[0-9a-f]{32}/i);
  if (traceIDMatch === null) {
    throw new Error('The seeded trace search response did not contain a trace ID');
  }
  const traceID = traceIDMatch[0];

  await queryEditor.getByRole('radio', { name: 'Trace ID', exact: true }).click();
  await queryEditor.getByRole('switch', { name: 'Node graph', exact: true }).check({ force: true });
  const traceInput = queryEditor.getByRole('textbox', { name: 'Trace ID', exact: true });
  await traceInput.fill(traceID);

  const traceRequest = panelEditPage.waitForQueryDataRequest();
  const traceResponse = panelEditPage.waitForQueryDataResponse();
  await traceInput.press('Enter');
  await expect(traceResponse).toBeOK();
  const traceRequestBody = (await traceRequest).postData() ?? '';
  const traceResponseBody = await (await traceResponse).text();
  expect(traceRequestBody).toContain('"queryType":"traceId"');
  expect(traceRequestBody).toContain(traceID);
  expect(traceResponseBody).toContain('"preferredVisualisationType":"nodeGraph"');
  expect(traceResponseBody).toContain('"name":"nodes"');
  expect(traceResponseBody).toContain('"name":"edges"');
  await expect(panelEditPage.panel.locator.getByText(/^(Trace )?traceID$/)).toBeVisible();
  await expect(panelEditPage.panel.locator.getByText(/^(Trace )?operationName$/)).toBeVisible();
  await expect(panelEditPage.panel.locator.getByText(/^(Trace )?serviceName$/)).toBeVisible();
  await expect(panelEditPage.panel.locator.getByText(traceID, { exact: true })).not.toHaveCount(0);
});
