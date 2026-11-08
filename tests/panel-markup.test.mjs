import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Atributos data-*-args com aspas duplas internas quebram o HTML e geram
// "JSON Parse error" ao tocar no botão (ex.: Anexar HTML).
test('argumentos dos botões do painel são JSON válido no atributo', async () => {
  const source = await readFile('private/panel.js', 'utf8');
  const broken = source.match(/data-[a-z]+-args="\[[^\]$]*"[^\]]*\]"/g) || [];
  assert.deepEqual(broken, []);
});
