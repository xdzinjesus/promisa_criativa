import { test, expect } from '@playwright/test';
test('Clientes: lixeira move, desfaz, restaura e exclui para sempre sem atualizar a página', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  let reloads = 0; page.on('framenavigated', f => { if (f === page.mainFrame()) reloads++; });
  await page.goto('/acesso.html');
  await page.locator('#admin-password').fill('browser-test-only-password');
  await page.locator('#access-submit').click();
  await expect(page.locator('#choice-panel')).toBeVisible();
  await page.goto('/admin?tab=clients');
  for (const n of ['Ana Lixo', 'Bia Fica']) { await page.locator('#clientFormBtn').click(); await page.locator('#sc').fill(n); await page.locator('[data-click="addSale"]').click(); }
  const before = reloads;
  const moveToTrash = async name => {
    await page.locator('.ccard', { hasText: name }).locator('.more').click();
    await page.locator('dialog.sheet[open] .smore > summary').click();
    await page.locator('dialog.sheet[open]').getByRole('button', { name: 'Mover para a lixeira' }).click();
  };
  await moveToTrash('Ana Lixo');
  await expect(page.locator('.ccard', { hasText: 'Ana Lixo' })).toHaveCount(0);
  await page.locator('.undo-toast button').click(); // Desfazer
  await expect(page.locator('.ccard', { hasText: 'Ana Lixo' })).toHaveCount(1);
  await moveToTrash('Ana Lixo');
  await page.getByRole('button', { name: /Lixeira \(1\)/ }).click();
  await expect(page.locator('.trash-row')).toHaveCount(1);
  await page.locator('.trash-row').getByRole('button', { name: 'Restaurar' }).click();
  await expect(page.locator('.trash-row')).toHaveCount(0);
  await page.getByRole('button', { name: 'Todos' }).click();
  await moveToTrash('Ana Lixo');
  await page.getByRole('button', { name: /Lixeira \(1\)/ }).click();
  await page.locator('.trash-row').getByRole('button', { name: 'Excluir para sempre' }).click();
  await expect(page.locator('dialog.ask-dialog')).toContainText('Excluir para sempre?');
  await page.locator('dialog.ask-dialog .ask-no').click(); // Cancelar não apaga
  await expect(page.locator('.trash-row')).toHaveCount(1);
  await page.locator('.trash-row').getByRole('button', { name: 'Excluir para sempre' }).click();
  await page.locator('dialog.ask-dialog .ask-yes').click();
  await expect(page.locator('.trash-list .site-empty')).toContainText('A lixeira está vazia');
  await page.getByRole('button', { name: 'Todos' }).click();
  await expect(page.locator('.ccard', { hasText: 'Bia Fica' })).toHaveCount(1);
  await expect(page.locator('.ccard', { hasText: 'Ana Lixo' })).toHaveCount(0);
  expect(reloads).toBe(before);
  expect(errors).toEqual([]);
});
