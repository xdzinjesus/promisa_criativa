import { test, expect } from '@playwright/test';

// Aba "Instagram" do painel com a API simulada (nenhuma chamada real ao Instagram).
async function login(page) {
  await page.goto('/acesso.html');
  await expect(page.locator('#access-submit')).toBeEnabled();
  await page.locator('#admin-password').fill('browser-test-only-password');
  await page.locator('#access-submit').click();
  await expect(page.locator('#choice-panel')).toBeVisible();
}
const day = offset => new Date(Date.now() + offset * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const history = () => ({
  version: 1, account: { username: 'promisa.digital', followers: 1130, follows: 50, media: 12 },
  daily: Array.from({ length: 40 }, (_, i) => ({ date: day(i - 39), followers: 1130 - (39 - i) * 4 - (i % 3), media: 12 })),
  posts: [
    { id: 'a', type: 'REELS', permalink: 'https://www.instagram.com/reel/AAA/', timestamp: new Date(Date.now() - 2 * 86_400_000).toISOString(), caption: 'Bastidores do site da padaria', likes: 31, comments: 4, views: 920, reach: 540, saved: 7 },
    { id: 'b', type: 'CAROUSEL', permalink: 'https://www.instagram.com/p/BBB/', timestamp: new Date(Date.now() - 6 * 86_400_000).toISOString(), caption: '3 erros comuns em sites de pequenas empresas', likes: 12, comments: 1, reach: 300, saved: 9 },
    { id: 'c', type: 'IMAGE', permalink: 'https://www.instagram.com/p/CCC/', timestamp: new Date(Date.now() - 12 * 86_400_000).toISOString(), caption: 'Novo projeto no ar', likes: 40, comments: 3 }
  ],
  goals: { followers: { target: 2000, deadline: day(40) }, clientsPerMonth: { target: 5 } },
  clientsByMonth: {}, lastSync: new Date().toISOString(), lastError: null
});

test('aba Instagram: cartões, metas, gráfico e posts a partir da API simulada, sem violar a CSP', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const violations = [];
  page.on('console', message => { if (/Content Security Policy/i.test(message.text())) violations.push(message.text()); });
  const calls = [];
  await page.route('**/api/instagram', async route => {
    const body = JSON.parse(route.request().postData() || '{}');
    calls.push(body);
    if (body.action === 'status') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ configured: true, today: day(0), history: history(), nextSyncAt: 0 }) });
    if (body.action === 'goals') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });
  await login(page);
  await page.goto('/admin?tab=instagram');
  await expect(page.locator('#app h1')).toContainText('Instagram');
  await expect(page.locator('#ig-kpis')).toContainText('1.130');
  await expect(page.locator('#ig-kpis')).toContainText('Média dos Reels');
  await expect(page.locator('#ig-goal-followers')).toContainText('de 2.000');
  await expect(page.locator('#ig-goal-followers')).toContainText('No ritmo atual');
  await expect(page.locator('#ig-goal-clients')).toContainText('Instagram');
  await expect(page.locator('#ig-chart-card svg polyline')).toHaveCount(1);
  await expect(page.locator('#ig-posts .ig-post')).toHaveCount(3);
  await expect(page.locator('#ig-posts a.ig-open').first()).toHaveAttribute('href', /instagram\.com/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  if (process.env.INSTAGRAM_SHOT) await page.screenshot({ path: process.env.INSTAGRAM_SHOT, fullPage: true });
  await page.locator('#ig-goals').click();
  await expect(page.locator('dialog.sheet[open]')).toBeVisible();
  await page.locator('dialog.sheet[open] input[type=number]').first().fill('2500');
  await page.locator('dialog.sheet[open] button.wide').click();
  await expect.poll(() => calls.some(c => c.action === 'goals' && c.followers?.target === 2500)).toBe(true);
  expect(violations).toEqual([]);
});

test('aba Instagram: sem token mostra o passo a passo e deixa o botão desligado', async ({ page }) => {
  await page.route('**/api/instagram', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ configured: false, today: day(0), history: { version: 1, account: null, daily: [], posts: [], goals: {}, clientsByMonth: {} }, nextSyncAt: 0 }) }));
  await login(page);
  await page.goto('/admin?tab=instagram');
  await expect(page.locator('#ig-setup')).toContainText('INSTAGRAM_TOKEN');
  await expect(page.locator('#ig-setup a[href*="docs/INSTAGRAM.md"]')).toBeVisible();
  await expect(page.locator('#ig-sync')).toBeDisabled();
});

test('cadastro de cliente tem "Como conheceu a Promisa?" e guarda a origem', async ({ page }) => {
  await page.route('**/api/instagram', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ configured: true, today: day(0), history: { version: 1, account: null, daily: [], posts: [], goals: {}, clientsByMonth: {} }, nextSyncAt: 0 }) }));
  await login(page);
  await page.goto('/admin?tab=clients');
  await page.locator('[data-click="toggleClientForm"]').first().click();
  await page.locator('#sc').fill('Padaria Teste');
  await page.locator('#sorigem').selectOption('instagram');
  await page.locator('[data-click="addSale"]').click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('painel_v1')).sales[0]?.origem)).toBe('instagram');
});
