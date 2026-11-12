import test from 'node:test';
import assert from 'node:assert/strict';
import { NICHES, newDraft, renderSite, safeImage, phoneDigits, igHandle, priceText } from '../src/client-site-templates.js';

test('modelos: todo ramo gera um site completo', () => {
  for (const niche of Object.keys(NICHES)) {
    const html = renderSite(newDraft(niche));
    assert.match(html, /^<!doctype html>/);
    assert.ok(html.includes(NICHES[niche].items), niche);
    assert.ok(html.includes('https://wa.me/5549999999999'), 'botão do WhatsApp');
    assert.ok(!/<script/i.test(html), 'sem scripts');
  }
});

test('modelos: o que o cliente digita nunca vira código', () => {
  const draft = { ...newDraft('loja'), name: '<img src=x onerror=alert(1)>', slogan: '"><script>alert(1)</script>', items: [{ name: '<b>x</b>', price: '10', desc: 'a & b' }], logo: 'javascript:alert(1)', cover: 'data:image/svg+xml;base64,PHN2Zz4=', gallery: ['https://evil.example/x.png'] };
  const html = renderSite(draft);
  assert.ok(!html.includes('<img src=x'), 'nome escapado');
  assert.ok(!html.includes('<script>'), 'slogan escapado');
  assert.ok(html.includes('&lt;b&gt;x&lt;/b&gt;') && html.includes('a &amp; b'));
  assert.ok(!html.includes('javascript:') && !html.includes('svg+xml') && !html.includes('evil.example'), 'só fotos data:image jpg/png/webp');
});

test('modelos: telefone, Instagram, preço e fotos', () => {
  assert.equal(phoneDigits('(49) 99999-1234'), '5549999991234');
  assert.equal(phoneDigits('+55 49 3442-1234'), '554934421234');
  assert.equal(phoneDigits('123'), '');
  assert.equal(igHandle('https://www.instagram.com/promisa_criativa/?hl=pt'), 'promisa_criativa');
  assert.equal(igHandle('@gv.barber'), 'gv.barber');
  assert.equal(priceText('45'), 'R$ 45'); assert.equal(priceText('39,90'), 'R$ 39,90'); assert.equal(priceText('consulte'), 'consulte');
  assert.equal(safeImage('data:image/jpeg;base64,AAAA'), 'data:image/jpeg;base64,AAAA');
  assert.equal(safeImage('data:image/jpeg;base64,AA"onload=x'), '');
  const html = renderSite({ ...newDraft('barbearia'), showPromo: false, whatsapp: '' });
  assert.ok(!html.includes('class="promo"') && !html.includes('wa.me'), 'sem promoção e sem WhatsApp quando desligados');
});

test('planos: Essencial é enxuto, Premium tem tudo; odontologia sem preços nem promoções', async () => {
  const { PLANS } = await import('../src/client-site-templates.js');
  const base = niche => ({ ...newDraft(niche), testimonials: [{ name: 'Ana', text: 'Ótimo atendimento' }], team: [{ name: 'João', role: 'Barbeiro' }] });
  const ess = renderSite({ ...base('barbearia'), plan: 'essencial' }), pre = renderSite({ ...base('barbearia'), plan: 'premium', heroStyle: 'split' });
  assert.ok(!ess.includes('class="promo"') && !ess.includes('id="duvidas"') && !ess.includes('class="band"'), 'essencial sem promoção, FAQ e chamada final');
  for (const part of ['class="marquee"', 'id="duvidas"', 'id="equipe"', 'id="depoimentos"', 'class="stats"', 'hero split', 'top sticky']) assert.ok(pre.includes(part), 'premium tem ' + part);
  assert.ok(!renderSite({ ...base('barbearia'), plan: 'premium', hide: { faq: true } }).includes('id="duvidas"'), 'cliente pode esconder seção');
  const odonto = renderSite({ ...newDraft('odontologia'), items: [{ name: 'Clareamento', price: '500', desc: '' }], promo: 'Promoção', showPromo: true });
  assert.ok(!odonto.includes('R$ 500') && !odonto.includes('class="promo"'), 'regras do CFO: sem preço e sem promoção');
  assert.ok(odonto.includes('Responsável técnico'), 'responsável técnico no rodapé');
  for (const niche of Object.keys(NICHES)) for (const plan of Object.keys(PLANS)) assert.ok(!/<script/i.test(renderSite(newDraft(niche, plan))));
});

