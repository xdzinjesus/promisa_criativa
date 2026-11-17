// Uso da conta na Vercel (últimos 30 dias), pela API oficial de cobrança: GET https://api.vercel.com/v1/billing/charges (JSONL, formato FOCUS).
// Precisa de VERCEL_API_TOKEN (criado pelo dono em vercel.com/account/settings/tokens). Opcional: VERCEL_TEAM_ID ou VERCEL_TEAM_SLUG.
// A chave só é usada aqui no servidor: nunca vai para o navegador nem para as respostas.

// Limites do plano Hobby (grátis), como aparecem no painel da Vercel. Chave = nome do serviço normalizado.
export const HOBBY_LIMITS = {
  'blob simple operations': { limit: 10_000, unit: 'ops' },
  'blob advanced operations': { limit: 2_000, unit: 'ops' },
  'blob data storage': { limit: 1, unit: 'GB' },
  'blob data transfer': { limit: 10, unit: 'GB' },
  'functions storage': { limit: 10, unit: 'GB' },
  'fast origin transfer': { limit: 10, unit: 'GB' },
  'fast data transfer': { limit: 100, unit: 'GB' },
  'fluid active cpu': { limit: 4, unit: 'h' },
  'fluid provisioned memory': { limit: 360, unit: 'GB-h' },
  'cdn requests': { limit: 1_000_000, unit: 'req' },
  'edge requests': { limit: 1_000_000, unit: 'req' },
  'deployment storage': { limit: 10, unit: 'GB' },
  'function invocations': { limit: 1_000_000, unit: 'req' },
};
// Plano Pro: US$ 20 de crédito de uso por mês; acima disso a Vercel cobra só o excedente.
export const PRO_CREDIT = 20;
const key = name => String(name || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

// Junta as linhas de uso por serviço (soma dos dias).
export function summarize(rows, plan = 'hobby') {
  const paid = plan !== 'hobby';
  const by = new Map(); let cost = 0;
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    const billed = Number(r.BilledCost) || 0; cost += billed;
    if (r.ChargeCategory !== 'Usage' || !r.ServiceName) continue;
    const k = key(r.ServiceName), item = by.get(k) || { name: String(r.ServiceName).slice(0, 80), quantity: 0, unit: String(r.ConsumedUnit || r.PricingUnit || '').slice(0, 20), cost: 0 };
    item.quantity += Number(r.ConsumedQuantity) || 0; item.cost += billed; by.set(k, item);
  }
  const items = [...by.entries()].map(([k, x]) => {
    const lim = paid ? null : HOBBY_LIMITS[k];
    return { ...x, blob: k.startsWith('blob '), quantity: Math.round(x.quantity * 1000) / 1000, cost: Math.round(x.cost * 100) / 100, limit: lim?.limit ?? null, pct: lim ? Math.round(x.quantity / lim.limit * 1000) / 10 : null };
  }).sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1) || a.name.localeCompare(b.name));
  return { items, cost: Math.round(cost * 100) / 100, plan, ...(paid ? { credit: PRO_CREDIT } : {}) };
}

export function parseJsonl(text) {
  const rows = [];
  for (const line of String(text || '').split('\n')) { const t = line.trim(); if (!t) continue; try { rows.push(JSON.parse(t)); } catch { /* linha inválida: ignora */ } }
  return rows;
}

// Mensagem de erro da própria Vercel (curta), para saber o motivo.
async function reason(response) {
  try { const t = await response.text(); const j = JSON.parse(t); return String(j?.error?.message || j?.message || '').slice(0, 200); } catch { return ''; }
}
// Times que a chave enxerga (no plano grátis existe um time automático, ex.: "nome-projects").
// Times que a chave enxerga, com o plano de cada um (no plano grátis existe um time automático, ex.: "nome-projects").
async function teams(token, fetchFn) {
  let r;
  try { r = await fetchFn('https://api.vercel.com/v2/teams?limit=100', { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) }); } catch { return []; }
  if (!r.ok) return [];
  const j = await r.json().catch(() => ({}));
  return (j.teams || []).filter(t => typeof t?.id === 'string' && /^[\w-]{3,80}$/.test(t.id))
    .map(t => ({ id: t.id, name: String(t.name || t.slug || t.id).slice(0, 60), plan: ['hobby', 'pro', 'enterprise'].includes(String(t.billing?.plan || '').toLowerCase()) ? String(t.billing.plan).toLowerCase() : null }));
}

// Plano da conta (hobby/pro/enterprise), lido do time na Vercel. VERCEL_PLAN no ambiente força um valor.
async function planOf(token, team, fetchFn) {
  if (!team?.id && !team?.slug) return null;
  const url = new URL(`https://api.vercel.com/v2/teams/${encodeURIComponent(team.id || team.slug)}`);
  try { const r = await fetchFn(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) }); if (!r.ok) return null; const j = await r.json().catch(() => ({})); const p = String(j?.billing?.plan || '').toLowerCase(); return ['hobby', 'pro', 'enterprise'].includes(p) ? p : null; } catch { return null; }
}

export async function vercelUsage({ env = process.env, now = Date.now(), fetchFn = fetch } = {}) {
  const token = env.VERCEL_API_TOKEN;
  if (!token) return { configured: false };
  const day = 864e5, to = new Date(Math.floor(now / day) * day + day), from = new Date(to - 30 * day);
  const ask = async team => {
    const url = new URL('https://api.vercel.com/v1/billing/charges');
    url.searchParams.set('from', from.toISOString()); url.searchParams.set('to', to.toISOString());
    if (team?.id) url.searchParams.set('teamId', team.id); else if (team?.slug) url.searchParams.set('slug', team.slug);
    return fetchFn(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) });
  };
  const forced = String(env.VERCEL_PLAN || '').toLowerCase();
  const configuredTeam = env.VERCEL_TEAM_ID ? { id: env.VERCEL_TEAM_ID } : env.VERCEL_TEAM_SLUG ? { slug: env.VERCEL_TEAM_SLUG } : null;
  // Ordem das tentativas: o time configurado; senão a conta da chave e depois cada time (os pagos primeiro).
  let list = [], candidates;
  if (configuredTeam) candidates = [configuredTeam];
  else {
    list = await teams(token, fetchFn);
    for (const t of list) if (!t.plan) t.plan = await planOf(token, t, fetchFn);
    const rank = t => t.plan === 'pro' || t.plan === 'enterprise' ? 0 : 1;
    candidates = [null, ...[...list].sort((x, y) => rank(x) - rank(y))];
  }
  let response = null, usedTeam = null; const tried = [];
  for (const team of candidates) {
    const r = await ask(team);
    if (r.ok) { response = r; usedTeam = team; break; }
    if (r.status === 401 || r.status === 403) { if (!team) return { configured: true, error: 'A Vercel recusou a chave (VERCEL_API_TOKEN). Crie uma nova em vercel.com/account/settings/tokens, escolhendo a sua conta em Scope, e troque na Vercel.' }; }
    tried.push({ team, status: r.status, why: (await reason(r)).replace(/\.+$/, '') });
  }
  if (!response) {
    const paidTeam = list.find(t => t.plan === 'pro' || t.plan === 'enterprise');
    const plan = ['hobby', 'pro', 'enterprise'].includes(forced) ? forced : paidTeam?.plan || (configuredTeam ? await planOf(token, configuredTeam, fetchFn) : null) || 'hobby';
    const last = tried[tried.length - 1] || { status: 0, why: '' };
    const seen = list.length ? ` Times que a chave enxerga: ${list.map(t => `${t.name} (${t.plan || 'plano ?'})`).join(', ')}.` : '';
    if (plan !== 'hobby' && tried.some(t => t.status === 404)) {
      return { configured: true, plan, pending: true, error: `A Vercel ainda não liberou o relatório de uso do plano ${plan === 'pro' ? 'Pro' : 'Enterprise'}${paidTeam ? ` (time "${paidTeam.name}")` : ''}. Isso costuma levar até 1 dia depois de assinar; o painel tenta sozinho de novo. O monitor do Blob ao lado já funciona.` };
    }
    if (last.status === 404 && list.length && !paidTeam) {
      return { configured: true, plan, error: `A Vercel não achou um plano pago para esta chave (${last.why || 'erro 404'}).${seen} Se o Pro está em outro time, crie uma chave nova em vercel.com/account/settings/tokens escolhendo esse time em Scope e troque VERCEL_API_TOKEN na Vercel.` };
    }
    return { configured: true, plan, error: `A Vercel respondeu erro ${last.status}${last.why ? ': ' + last.why : ''}. ${last.status === 404 ? 'Essa consulta pode não estar liberada para o plano grátis (Hobby).' : 'Tente de novo em alguns minutos.'}` };
  }
  const text = await response.text();
  if (text.length > 20 * 1024 * 1024) return { configured: true, error: 'Resposta grande demais da Vercel.' };
  const plan = ['hobby', 'pro', 'enterprise'].includes(forced) ? forced : (usedTeam && list.find(t => t.id === usedTeam.id)?.plan) || (await planOf(token, usedTeam || list[0], fetchFn)) || 'hobby';
  return { configured: true, from: from.toISOString(), to: to.toISOString(), ...summarize(parseJsonl(text), plan) };
}
