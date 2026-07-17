import { expect, test } from '@grafana/plugin-e2e';

test('datasource configuration exposes the supported settings and saves', async ({
  createDataSourceConfigPage,
  page,
  readProvisionedDataSource,
}) => {
  const provisioned = await readProvisionedDataSource({ fileName: 'datasources.yml' });
  const configPage = await createDataSourceConfigPage({ type: provisioned.type });

  const basicAuth = page.getByRole('switch', { name: /Basic auth/i });
  if ((await basicAuth.isVisible()) && !(await basicAuth.isChecked())) {
    await basicAuth.check({ force: true });
  }

  await expect(page.getByRole('textbox', { name: /^URL/ })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Organization', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'User', exact: true })).toBeVisible();
  const passwordLabel = page.locator('label').filter({ hasText: /^Password$/ });
  await expect(passwordLabel).toHaveCount(1);
  await expect(passwordLabel).toBeVisible();
  const passwordInput = passwordLabel.locator('..').getByRole('textbox');
  await expect(passwordInput).toHaveCount(1);
  await expect(passwordInput).toBeVisible();
  await expect(page.getByRole('switch', { name: /Skip TLS (verification|Verify)/i })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Logs datasource', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Tags', exact: true })).toBeVisible();
  await expect(page.getByRole('switch', { name: 'Node graph', exact: true })).toBeVisible();

  await page.getByRole('textbox', { name: /^URL/ }).fill(provisioned.url ?? '');
  await page.getByRole('textbox', { name: 'Organization', exact: true }).fill('default');
  await page.getByRole('textbox', { name: 'User', exact: true }).fill('root@example.com');
  await passwordInput.fill('Complexpass#123');

  await expect(configPage.saveAndTest()).toBeOK();
  await expect(configPage).toHaveAlert('success');
});
