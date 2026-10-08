import { expect, test } from '@grafana/plugin-e2e';

test('datasource configuration exposes the supported settings and saves', async ({
  createDataSourceConfigPage,
  page,
  readProvisionedDataSource,
}) => {
  const provisioned = await readProvisionedDataSource({ fileName: 'datasources.yml' });
  const configPage = await createDataSourceConfigPage({ type: provisioned.type });

  await page.getByRole('combobox', { name: 'Authentication method' }).click();
  await page.getByText('Basic authentication', { exact: true }).click();

  await expect(page.getByRole('textbox', { name: 'Data source connection URL' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Organization', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'User *', exact: true })).toBeVisible();
  const passwordInput = page.locator('#basic-auth-password-input');
  await expect(passwordInput).toHaveCount(1);
  await expect(passwordInput).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Skip TLS certificate validation' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Logs datasource', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Add tag mapping' }).click();
  await page.getByRole('textbox', { name: 'Trace attribute 1' }).fill('service.name');
  await page.getByRole('textbox', { name: 'Log label 1' }).fill('service_name');
  await expect(page.getByRole('switch', { name: 'Node graph', exact: true })).toBeVisible();

  await page.getByRole('textbox', { name: 'Data source connection URL' }).fill(provisioned.url ?? '');
  await page.getByRole('textbox', { name: 'Organization', exact: true }).fill('default');
  await page.getByRole('textbox', { name: 'User *', exact: true }).fill('root@example.com');
  await passwordInput.fill('Complexpass#123');

  await expect(configPage.saveAndTest()).toBeOK();
  await expect(configPage).toHaveAlert('success');
});
