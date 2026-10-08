import { expect, test } from '@grafana/plugin-e2e';

test('trace search returns seeded rows without a raw SQL escape hatch', async ({
  gotoPanelEditPage,
  readProvisionedDashboard,
  readProvisionedDataSource,
}) => {
  const provisioned = await readProvisionedDataSource({ fileName: 'datasources.yml' });
  const dashboard = await readProvisionedDashboard({ fileName: 'trace-search.json' });
  const panelEditPage = await gotoPanelEditPage({ dashboard, id: '1' });
  await panelEditPage.datasource.set(provisioned.name);

  const queryEditor = panelEditPage.getQueryEditorRow('A');
  await expect(queryEditor.getByRole('combobox', { name: 'Stream', exact: true })).toBeVisible();
  await queryEditor.getByRole('textbox', { name: 'Service', exact: true }).fill('web-frontend');
  await queryEditor.getByRole('textbox', { name: 'Span name', exact: true }).fill('GET /api/products');
  await queryEditor.getByRole('textbox', { name: 'Min duration', exact: true }).fill('invalid');
  await expect(queryEditor.getByText(/Use a non-negative duration/)).toBeVisible();
  await queryEditor.getByRole('textbox', { name: 'Min duration', exact: true }).fill('1ms');
  await queryEditor.getByRole('textbox', { name: 'Max duration', exact: true }).fill('2s');
  await queryEditor.getByRole('button', { name: 'Add tag filter' }).press('Enter');
  const attribute = queryEditor.getByRole('combobox', { name: 'Tag 1 attribute', exact: true });
  await attribute.fill('http_method');
  await expect(
    queryEditor.locator('xpath=ancestor::body').getByRole('option', { name: 'http_method', exact: true })
  ).toBeVisible();
  await attribute.press('Enter');
  await expect(attribute).toHaveValue('http_method');
  await queryEditor.getByRole('textbox', { name: 'Tag 1 value' }).fill('GET');
  await expect(queryEditor.getByRole('textbox', { name: /Raw (WHERE|SQL)/i })).toHaveCount(0);

  const queryRequest = panelEditPage.waitForQueryDataRequest();
  const queryResponse = panelEditPage.waitForQueryDataResponse();
  await queryEditor.getByRole('textbox', { name: 'Tag 1 value' }).press('Enter');
  await expect(queryResponse).toBeOK();
  const requestBody = (await queryRequest).postData() ?? '';

  expect(requestBody).not.toContain('rawWhere');
  expect(requestBody).not.toContain('rawSql');
  await expect(panelEditPage.panel.data.filter({ hasText: 'web-frontend' })).not.toHaveCount(0);
});

test('a searched seeded trace can be opened through direct trace lookup', async ({
  gotoPanelEditPage,
  readProvisionedDashboard,
  readProvisionedDataSource,
}) => {
  const provisioned = await readProvisionedDataSource({ fileName: 'datasources.yml' });
  const dashboard = await readProvisionedDashboard({ fileName: 'trace-search.json' });
  const panelEditPage = await gotoPanelEditPage({ dashboard, id: '1' });
  await panelEditPage.datasource.set(provisioned.name);

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
