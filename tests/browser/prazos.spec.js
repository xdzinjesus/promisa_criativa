import { test, expect } from '@playwright/test';
const day = (offset = 0) => { const d = new Date(Date.now() + offset * 864e5); return d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }); };
async function login(page) {
  await page.goto('/acesso.html');
  await page.locator('#admin-password').fill('browser-test-only-password');
  await page.locator('#access-submit').click();
  await expect(page.locator('#choice-panel')).toBeVisible();
}
test('Prazos: cadastro com prazo, aviso no Início, filtro, edição sem recarregar e link direto da ficha pelo login', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await login(page);
  await page.goto('/admin?tab=clients');
  await page.locator('#clientFormBtn').click();
  await page.locator('#sc').fill('Teph Kaetano');
  await page.locator('#clientMoreBtn').click();
  await page.locator('#sprazo').fill(day(0));
  await page.locator('[data-click="addSale"]').click();
  const card = page.locator('#clientCards .ccard', { hasText: 'Teph Kaetano' });
  await expect(card.locator('.prazo-badge')).toContainText('Vence hoje');
  const id = await card.getAttribute('data-lead-id');

  await page.goto('/admin');
  await expect(page.locator('#nextSteps')).toContainText('1 entrega vence hoje');
  await page.locator('#nextSteps').getByText('1 entrega vence hoje').click();
  await expect(page.locator('#clientCards .ccard')).toHaveCount(1);

  // Muda o prazo na ficha: o cartão atualiza na hora.
  await card.locator('.more').click();
  const prazo = page.locator('dialog.sheet[open] label.sf', { hasText: 'Prazo de entrega' }).locator('input');
  await prazo.fill(day(1)); await prazo.dispatchEvent('change');
  await page.locator('dialog.sheet[open] .sheet-x').click();
  await page.getByRole('button', { name: 'Todos' }).click();
  await expect(card.locator('.prazo-badge')).toContainText('Vence amanhã');

  // Link direto (Pixel): sem sessão passa pelo login e volta para a ficha.
  await page.context().clearCookies();
  await page.goto(`/admin?tab=clients&cliente=${id}&aba=resumo`);
  await expect(page).toHaveURL(/acesso\.html\?next=/);
  await page.locator('#admin-password').fill('browser-test-only-password');
  await page.locator('#access-submit').click();
  await expect(page.locator('dialog.sheet[open]')).toBeVisible();
  await expect(page.locator('dialog.sheet[open] h2')).toHaveText('Teph Kaetano');
  expect(errors).toEqual([]);
});
