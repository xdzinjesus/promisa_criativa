import { test } from 'node:test';
import assert from 'node:assert/strict';
import { visitorFromHeaders, deviceFromUA, browserFromUA } from '../lib/visitor.js';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const SAMSUNG = 'Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0 Mobile Safari/537.36';
const INSTA = IPHONE.replace('Safari/604.1', 'Instagram 350.0.0.0 (iPhone15,2; iOS 18_1)');

test('identifica aparelho e navegador sem usar IP', () => {
  assert.equal(deviceFromUA(IPHONE), '📱 iPhone');
  assert.equal(browserFromUA(IPHONE), 'Safari');
  assert.match(deviceFromUA(SAMSUNG), /Android Samsung/);
  assert.equal(browserFromUA(SAMSUNG), 'Samsung Internet');
  assert.equal(browserFromUA(INSTA), 'Instagram');
  assert.equal(deviceFromUA('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130 Safari/537.36'), '💻 Computador Windows');
});

test('cidade aproximada vem dos cabeçalhos da Vercel e o IP nunca aparece', () => {
  const v = visitorFromHeaders({ 'user-agent': IPHONE, 'x-vercel-ip-city': 'Conc%C3%B3rdia', 'x-vercel-ip-country-region': 'SC', 'x-vercel-ip-country': 'BR', 'x-forwarded-for': '177.12.34.56', 'x-real-ip': '177.12.34.56' });
  assert.equal(v.place, 'Concórdia/SC');
  assert.equal(v.bot, false);
  assert.ok(!JSON.stringify(v).includes('177.12'));
});

test('prévia de link do WhatsApp é marcada como robô', () => {
  const v = visitorFromHeaders({ 'user-agent': 'WhatsApp/2.24.1 A' });
  assert.equal(v.bot, true);
  assert.match(v.device, /robô/);
});

test('remove caracteres de formatação do Discord vindos dos cabeçalhos', () => {
  const v = visitorFromHeaders({ 'user-agent': IPHONE, 'x-vercel-ip-city': '%40everyone%20*x*' });
  assert.ok(!v.place.includes('@') && !v.place.includes('*'));
});
