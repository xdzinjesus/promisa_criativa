import { test, expect } from '@playwright/test';
async function login(page) {
  await page.goto('/acesso.html');
  await expect(page.locator('#access-submit')).toBeEnabled();
  await page.locator('#admin-password').fill('browser-test-only-password');
  await page.locator('#access-submit').click();
  await expect(page.locator('#choice-panel')).toBeVisible();
  await page.goto('/admin?tab=clients');
  await expect(page.locator('#app h1')).toHaveText('Clientes');
}
async function addClient(page, { name, phone, value, stage }) {
  await page.locator('#clientFormBtn').click();
  await page.locator('#sc').fill(name);
  if (phone) await page.locator('#scontact').fill(phone);
  if (value || stage) {
    await page.locator('#clientMoreBtn').click();
    if (value) await page.locator('#sv').fill(String(value));
    if (stage) await page.locator('#st').selectOption(stage);
  }
  await page.locator('[data-click="addSale"]').click();
  await expect(page.locator('.ccard', { hasText: name })).toBeVisible();
}
const card = (page, name) => page.locator('#clientCards .ccard', { hasText: name });

test('Clientes: resumo, filtros, próximo passo e ficha em abas (390px)', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  // Formulário enxuto: só nome e WhatsApp até tocar em "Mais detalhes".
  await page.locator('#clientFormBtn').click();
  await expect(page.locator('#sc')).toBeVisible();
  await expect(page.locator('#ss')).toBeHidden();
  await page.locator('#clientFormBtn').click();
  // Sem sites sem cliente e sem pendentes: nada de seções vazias.
  await expect(page.locator('#orphanTitle')).toBeHidden();
  await expect(page.locator('#clientBulk button')).toHaveCount(0);

  await addClient(page, { name: 'Ana Doces', phone: '49988240164', value: 1200 });
  await addClient(page, { name: 'Bruno Pet', phone: '4934426343', value: 1800, stage: 'Fechado' });
  await addClient(page, { name: 'Carla <b>Moda</b>', value: 900, stage: 'Perdido' });

  // Resumo
  const tiles = page.locator('#clientSummary');
  await expect(tiles).toContainText('Em negociação');
  await expect(tiles.locator('.ctile').nth(0)).toContainText('1.200');
  await expect(tiles.locator('.ctile').nth(1)).toContainText('1.800');
  await expect(page.locator('#clientNeedTile b')).toHaveText('2');

  // Cartões: telefone formatado com WhatsApp, valor e próximo passo
  await expect(card(page, 'Ana Doces').locator('.contact-link')).toHaveText('💬 (49) 98824-0164');
  await expect(card(page, 'Ana Doces').locator('.contact-link')).toHaveAttribute('href', 'https://wa.me/5549988240164');
  await expect(card(page, 'Bruno Pet').locator('.contact-link')).toContainText('(49) 3442-6343');
  await expect(card(page, 'Ana Doces').locator('.cmeta')).toContainText('Site · R$');
  await expect(card(page, 'Ana Doces').locator('.cnext')).toHaveText('＋ Anexar site');
  await expect(card(page, 'Bruno Pet').locator('.cnext')).toHaveText('💰 Marcar como pago');
  await expect(card(page, 'Bruno Pet')).toContainText('A receber');
  await expect(card(page, 'Carla')).toContainText('Sem telefone');
  await expect(card(page, 'Carla').locator('.cnext')).toHaveCount(0);
  await expect(card(page, 'Carla').locator('.cname')).toHaveText('Carla <b>Moda</b>');

  // Filtros
  const seg = page.locator('.cseg');
  await seg.getByRole('button', { name: 'Ativos' }).click();
  await expect(page.locator('#clientCards .ccard')).toHaveCount(1);
  await expect(card(page, 'Ana Doces')).toBeVisible();
  await seg.getByRole('button', { name: 'Fechados' }).click();
  await expect(page.locator('#clientCards .ccard')).toHaveCount(1);
  await expect(card(page, 'Bruno Pet')).toBeVisible();
  await seg.getByRole('button', { name: 'Todos' }).click();
  await expect(page.locator('#clientCards .ccard')).toHaveCount(3);
  await page.locator('#clientNeedChip').click();
  await expect(page.locator('#clientCards .ccard')).toHaveCount(2);
  await page.locator('#clientNeedChip').click();
  await page.locator('.fmore > summary').click();
  await page.locator('.fmore .menu-panel').getByRole('button', { name: 'Novos' }).click();
  await expect(page.locator('#clientCards .ccard')).toHaveCount(1);
  await expect(page.locator('.fmore > summary')).toContainText('Filtro: Novos');
  await seg.getByRole('button', { name: 'Todos' }).click();

  // Próximo passo funciona: marcar como pago tira o "A receber"
  await card(page, 'Bruno Pet').locator('.cnext').click();
  await expect(card(page, 'Bruno Pet')).toContainText('Pago');
  await expect(card(page, 'Bruno Pet').locator('.cnext')).toHaveText('＋ Anexar site');
  await expect(page.locator('#clientSummary .ctile').nth(1)).toContainText('R$ 0');

  // Ficha em abas
  await card(page, 'Bruno Pet').locator('.more').click();
  const sheet = page.locator('dialog.sheet[open]');
  await expect(sheet.getByRole('tab')).toHaveText(['Resumo', 'Site e demo', 'Briefing', 'Entregas']);
  await expect(sheet.getByRole('tab', { name: 'Resumo' })).toHaveAttribute('aria-selected', 'true');
  await expect(sheet.locator('#spanel-resumo')).toContainText('Linha do tempo');
  await expect(sheet.locator('#spanel-resumo')).toContainText('Pagamento recebido');
  await expect(sheet.getByRole('button', { name: 'Excluir cliente' })).toBeHidden();
  await sheet.locator('.smore > summary').click();
  await expect(sheet.getByRole('button', { name: 'Excluir cliente' })).toBeVisible();
  await sheet.getByRole('tab', { name: 'Site e demo' }).click();
  await expect(sheet.locator('#spanel-site')).toBeVisible();
  await expect(sheet.locator('#spanel-resumo')).toBeHidden();
  await expect(sheet.locator('#spanel-site')).toContainText('Anexar site');
  await sheet.getByRole('tab', { name: 'Site e demo' }).press('ArrowRight');
  await expect(sheet.getByRole('tab', { name: 'Briefing' })).toHaveAttribute('aria-selected', 'true');
  await expect(sheet.locator('#spanel-briefing')).toContainText('Formulário');
  await sheet.getByRole('button', { name: 'Fechar' }).click();

  // "Anexar site" abre a ficha direto na aba do site; cliente ativo não tem aba Entregas
  await card(page, 'Ana Doces').locator('.cnext').click();
  await expect(sheet.getByRole('tab', { name: 'Site e demo' })).toHaveAttribute('aria-selected', 'true');
  await expect(sheet.getByRole('tab', { name: 'Entregas' })).toHaveCount(0);
  await sheet.getByRole('button', { name: 'Fechar' }).click();

  // Sem rolagem horizontal no celular
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  expect(errors).toEqual([]);
});

test('Clientes: quadro no computador muda a etapa ao arrastar', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await login(page);
  await addClient(page, { name: 'Dora Café', phone: '49988240164', value: 700 });
  await page.locator('.cview').getByRole('button', { name: 'Quadro' }).click();
  await expect(page.locator('.kboard .kcol')).toHaveCount(5);
  const from = page.locator('.kcol[data-stage="Novo"] .kcard', { hasText: 'Dora Café' });
  await expect(from).toBeVisible();
  await from.dragTo(page.locator('.kcol[data-stage="Proposta enviada"]'));
  await expect(page.locator('.kcol[data-stage="Proposta enviada"] .kcard', { hasText: 'Dora Café' })).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('painel_v1')).sales[0].stage)).toBe('Proposta enviada');
  await page.reload();
  await expect(page.locator('.kboard')).toBeVisible();
  await page.locator('.cview').getByRole('button', { name: 'Lista' }).click();
  await expect(page.locator('#clientCards.clients-grid')).toBeVisible();
});
