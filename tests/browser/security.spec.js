import { test, expect } from '@playwright/test';
async function login(page) {
  await page.goto('/acesso.html');
  await expect(page.locator('#access-submit')).toBeEnabled();
  await page.locator('#admin-password').fill('browser-test-only-password');
  await page.locator('#access-submit').click();
  await expect(page.locator('#choice-panel')).toBeVisible();
  await page.goto('/admin');
  await expect(page.locator('#app h1')).toBeVisible();
}
test('strict CSP preserves navigation, editing, catalog and revokes copied cookies on logout', async ({ page, request }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await login(page);
  const cookies = await page.context().cookies();
  const cookie = cookies.find(item => item.name === 'promisa_session');
  await page.locator('#nav [data-click="go"]').filter({ hasText: 'Anotações' }).first().click();
  await page.locator('#prospectNotes').fill('Teste privado de navegação');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('painel_v1')).prospectNotes)).toBe('Teste privado de navegação');
  // No real cloud is configured in this test; check the actual offline state without claiming a save.
  await expect(page.locator('#cloud-status')).toContainText('aparelho');
  await page.goto('/catalogo');
  await expect(page.locator('#catalog-grid')).toContainText('catálogo está vazio');
  const result = await request.post('/api/access?action=logout', { headers: { Origin: 'http://127.0.0.1:4193', Cookie: `promisa_session=${cookie.value}` } });
  expect(result.status()).toBe(200);
  const replay = await request.get('/api/access?action=session', { headers: { Cookie: `promisa_session=${cookie.value}` } });
  expect(replay.status()).toBe(401);
  expect(errors).toEqual([]);
});
test('untrusted identifiers are rendered as data, never executed', async ({ page }) => {
  await login(page);
  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('painel_v1') || '{"sales":[],"exp":[],"projects":[]}');
    state.projects = [{ id: "x');globalThis.auditMarker=true;//", title: 'Importação insegura', status: 'Planejado' }];
    localStorage.setItem('painel_v1', JSON.stringify(state));
  });
  await page.reload();
  await expect(page.locator('#app')).toContainText('Não foi possível validar');
  expect(await page.evaluate(() => globalThis.auditMarker)).toBeUndefined();
  expect(await page.evaluate(() => localStorage.getItem('painel_v1'))).toContain('Importação insegura');
});
test('backup restores HTML and original ZIP bytes, and project deletion removes attachments', async ({ page, browser }) => {
  await login(page);
  await page.locator('#nav [data-click="go"]').filter({ hasText: 'Projetos' }).first().click();
  await page.locator('#projectTitle').fill('Projeto de teste');
  await page.locator('[data-click="addProject"]').click();
  await expect(page.locator('#projectList')).toContainText('Excluir projeto');
  await page.locator('#projectList input[type="file"]').setInputFiles({ name: 'pagina.html', mimeType: 'text/html', buffer: Buffer.from('<h1>Prévia segura</h1><script>parent.auditMarker=true</script>') });
  await expect(page.locator('#projectList')).toContainText('pagina.html');
  await page.getByRole('button', { name: 'Visualizar HTML' }).click();
  await expect(page.frameLocator('dialog iframe').locator('h1')).toHaveText('Prévia segura');
  expect(await page.evaluate(() => globalThis.auditMarker)).toBeUndefined();
  await page.getByRole('button', { name: 'Fechar prévia' }).click();
  // Build a valid ZIP through the application's existing exporter, then import it through the file picker.
  const zipBytes = await page.evaluate(async () => [...new Uint8Array(await (await createClientSiteZip({ name: 'Site de teste', htmlPath: 'index.html', files: [{ path: 'index.html', type: 'text/html', data: '<h1>Site anexado</h1>' }] })).arrayBuffer())]);
  await page.locator('#nav [data-click="go"]').filter({ hasText: 'Sites dos clientes' }).first().click();
  await page.locator('#clientZipInput').setInputFiles({ name: 'original.zip', mimeType: 'application/zip', buffer: Buffer.from(zipBytes) });
  await expect(page.locator('#clientSiteList')).toContainText('original');
  await page.locator('#nav [data-click="go"]').filter({ hasText: 'Backup' }).first().click();
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#backupExport').click();
  const download = await downloadPromise;
  const stream = await download.createReadStream(), chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const data = JSON.parse(Buffer.concat(chunks));
  expect(data.version).toBe(2);
  expect(data.projectAttachments[0].blob.__promisaBlob).toBe(1);
  expect(data.projectAttachments[0].blob.type).toBe('text/html');
  expect(Buffer.from(data.sites[0].sourceZip.blob.base64, 'base64')).toEqual(Buffer.from(zipBytes));
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:4193' });
  const restored = await context.newPage();
  try {
    restored.on('dialog', dialog => dialog.accept());
    await login(restored);
    await restored.locator('#nav [data-click="go"]').filter({ hasText: 'Backup' }).first().click();
    await restored.locator('#generalBackupInput').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.concat(chunks) });
    await expect(restored.locator('body')).toContainText('Backup validado e restaurado');
    await restored.locator('#nav [data-click="go"]').filter({ hasText: 'Projetos' }).first().click();
    await expect(restored.locator('#projectList')).toContainText('pagina.html');
    await restored.getByRole('button', { name: 'Visualizar HTML' }).click();
    await expect(restored.frameLocator('dialog iframe').locator('h1')).toHaveText('Prévia segura');
    await restored.getByRole('button', { name: 'Fechar prévia' }).click();
    await restored.locator('#projectList [data-click="deleteProject"]').click();
    await expect(restored.locator('#projectList')).toContainText('Ainda não há projetos');
    expect(await restored.evaluate(async () => (await projectFileAll()).length)).toBe(0);
  } finally { await context.close(); }
});

test('clear-local logout removes IndexedDB and localStorage without deleting other origin keys', async ({ page }) => {
  await login(page);
  await page.evaluate(async () => {
    localStorage.setItem('painel_v1', JSON.stringify(S));
    localStorage.setItem('other-app-key', 'preserve');
    await openClientSiteDB();
  });
  await expect(page.locator('#cloud-status')).toContainText('não configurado');
  page.on('dialog', dialog => dialog.accept());
  await page.locator('[data-clear-local]').click();
  await expect(page).toHaveURL(/acesso\.html/);
  expect(await page.evaluate(() => localStorage.getItem('painel_v1'))).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem('other-app-key'))).toBe('preserve');
  expect(await page.evaluate(async () => (await indexedDB.databases()).some(db => db.name === 'arquivo-sites-v1'))).toBe(false);
});
