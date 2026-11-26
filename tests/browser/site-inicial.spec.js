import { test, expect } from '@playwright/test';
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'self'";

for (const [name, size] of [['computador', { width: 1440, height: 900 }], ['celular', { width: 390, height: 844 }]]) {
  test(`Site inicial (${name}): carrega sem erros, com a regra de segurança, WhatsApp e projetos em destaque do painel`, async ({ page }) => {
    const errors = [], csp = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && /Content Security Policy|Refused/.test(m.text())) csp.push(m.text()); });
    await page.setViewportSize(size);
    // Mesma regra de segurança da Vercel (vercel.json) e uma vitrine fictícia vinda do painel.
    await page.route('**/', async route => { const r = await route.fetch(); await route.fulfill({ response: r, headers: { ...r.headers(), 'content-security-policy': CSP } }); });
    await page.route('**/api/featured', route => route.fulfill({ json: { items: [{ id: 'demo-padaria', title: 'Padaria Exemplo', category: 'Alimentação', demo: true }, { id: 'kaetano', title: 'Kaetano Ink', category: 'Tatuagem', demo: false }] } }));
    await page.route('**/_vercel/insights/script.js', route => route.fulfill({ contentType: 'application/javascript', body: '' }));
    await page.route('**/projeto/**', route => route.fulfill({ contentType: 'text/html', body: '<html><body style="margin:0;background:#9c6aff;color:#fff;font:60px sans-serif">Prévia</body></html>' }));
    await page.goto('/');
    await expect(page.locator('#hero-title')).toBeVisible();
    await expect(page).toHaveTitle(/Promisa/);
    expect(await page.locator('script:not([src]):not([type="application/ld+json"])').count()).toBe(0);
    await expect(page.locator('a[href^="https://wa.me/5549933811600"]').first()).toHaveAttribute('href', /wa\.me\/5549933811600/);
    await expect(page.locator('footer a.admin-footer-link[href="/acesso.html"]')).toHaveText('Área administrativa');
    // Baralho: projetos do painel na frente, sem repetir o Kaetano fixo.
    const deck = page.locator('[data-deck]');
    await expect(deck.locator('.deck-card--live')).toHaveCount(2);
    await expect(deck.locator('[data-deck-card] h3', { hasText: 'Kaetano Ink' })).toHaveCount(1);
    await expect(deck.locator('[data-deck-card]').first()).toContainText('Padaria Exemplo');
    await expect(page.locator('[data-deck-total]')).not.toHaveText('');
    await deck.scrollIntoViewIfNeeded();
    expect(errors).toEqual([]);
    expect(csp).toEqual([]);
  });
}
