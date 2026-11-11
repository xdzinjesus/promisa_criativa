import test from 'node:test';
import assert from 'node:assert/strict';
import { interactions, engagementRate, byFormat, byWeekday, byHourBand, cadence, dailyGains, tips, score } from '../src/instagram-insights.js';

const at = (iso) => new Date(iso).toISOString();
const posts = [
  { id: 'a', type: 'REELS', timestamp: at('2026-11-06T12:00:00-03:00'), likes: 50, comments: 5, saved: 5, reach: 400, views: 900 },
  { id: 'b', type: 'REELS', timestamp: at('2026-10-30T09:00:00-03:00'), likes: 40, comments: 0, reach: 300, views: 700 },
  { id: 'c', type: 'IMAGE', timestamp: at('2026-11-02T20:00:00-03:00'), likes: 10, comments: 2 },
  { id: 'd', type: 'IMAGE', timestamp: at('2026-10-26T21:00:00-03:00'), likes: 8, comments: 0, interactions: 12 }
];

test('interações e taxa de engajamento', () => {
  assert.equal(interactions(posts[0]), 60);
  assert.equal(interactions(posts[3]), 12, 'usa o total da Meta quando existe');
  assert.equal(engagementRate(posts[0], 1000), 15, 'divide pelo alcance');
  assert.equal(engagementRate(posts[2], 1200), 1, 'sem alcance, divide pelos seguidores');
  assert.equal(engagementRate({ likes: 1 }, 0), null);
  assert.ok(score(posts[0]) > score(posts[2]));
});

test('formatos, dias da semana e horários', () => {
  const f = byFormat(posts);
  assert.deepEqual(f.map(x => x.type), ['REELS', 'IMAGE']);
  assert.equal(f[0].avgInteractions, 50);
  assert.equal(f[0].avgViews, 800);
  const w = byWeekday(posts);
  assert.equal(w.length, 7);
  assert.equal(w[5].count, 2, 'sexta (6/11 e 30/10, no fuso de São Paulo)');
  const bands = byHourBand(posts);
  assert.equal(bands.find(b => b.key === 'noite').count, 2);
  assert.equal(bands.find(b => b.key === 'manha').count, 1);
});

test('constância e ganho diário', () => {
  const c = cadence(posts, '2026-11-11');
  assert.equal(c.daysSince, 5);
  assert.equal(c.last28, 4);
  assert.equal(cadence([], '2026-11-11').daysSince, null);
  const daily = [{ date: '2026-11-08', followers: 100 }, { date: '2026-11-09', followers: 104 }, { date: '2026-11-10', followers: 103 }, { date: '2026-11-11', followers: 110 }];
  assert.deepEqual(dailyGains(daily, '2026-11-11', 3).map(g => g.gain), [4, -1, 7]);
});

test('dicas automáticas em português, no máximo 5', () => {
  const daily = Array.from({ length: 8 }, (_, i) => ({ date: `2026-11-0${i + 1}`.replace('0-', '').slice(0, 10), followers: 100 + i * 2 }));
  const list = tips({ posts, daily, followers: 1000, today: '2026-11-11' });
  assert.ok(list.length >= 3 && list.length <= 5);
  assert.match(list[0].text, /Faz 5 dias sem post/);
  assert.ok(list.some(t => /Reels é o formato/.test(t.text)));
  assert.deepEqual(tips({ posts: [], daily: [], today: '2026-11-11' })[0].tone, 'warn');
});
