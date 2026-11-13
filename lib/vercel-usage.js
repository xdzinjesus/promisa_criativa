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
const key = name => String(name || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

// Junta as linhas de uso por serviço (soma dos dias).
export function summarize(rows) {
  const by = new Map(); let cost = 0;
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    const billed = Number(r.BilledCost) || 0; cost += billed;
    if (r.ChargeCategory !== 'Usage' || !r.ServiceName) continue;
    const k = key(r.ServiceName), item = by.get(k) || { name: String(r.ServiceName).slice(0, 80), quantity: 0, unit: String(r.ConsumedUnit || r.PricingUnit || '').slice(0, 20), cost: 0 };
    item.quantity += Number(r.ConsumedQuantity) || 0; item.cost += billed; by.set(k, item);
  }
  const items = [...by.entries()].map(([k, x]) => {
    const lim = HOBBY_LIMITS[k];
    return { ...x, quantity: Math.round(x.quantity * 1000) / 1000, cost: Math.round(x.cost * 100) / 100, limit: lim?.limit ?? null, pct: lim ? Math.round(x.quantity / lim.limit * 1000) / 10 : null };
  }).sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1) || a.name.localeCompare(b.name));
  return { items, cost: Math.round(cost * 100) / 100 };
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
async function teams(token, fetchFn) {
  const r = await fetchFn('https://api.vercel.com/v2/teams?limit=20', { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) });
  if (!r.ok) return [];
  const j = await r.json().catch(() => ({}));
  return (j.teams || []).map(t => t?.id).filter(id => typeof id === 'string' && /^[\w-]{3,80}$/.test(id));
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
  const configuredTeam = env.VERCEL_TEAM_ID ? { id: env.VERCEL_TEAM_ID } : env.VERCEL_TEAM_SLUG ? { slug: env.VERCEL_TEAM_SLUG } : null;
  let response = await ask(configuredTeam);
  // Sem time informado, a Vercel pode responder 404: descobre o(s) time(s) da conta e tenta cada um.
  if (response.status === 404 && !configuredTeam) {
    for (const id of await teams(token, fetchFn)) { const r = await ask({ id }); if (r.ok) { response = r; break; } response = r; }
  }
  if (response.status === 401 || response.status === 403) return { configured: true, error: 'A Vercel recusou a chave (VERCEL_API_TOKEN). Crie uma nova em vercel.com/account/settings/tokens, escolhendo a sua conta em Scope, e troque na Vercel.' };
  if (!response.ok) {
    const why = await reason(response);
    return { configured: true, error: `A Vercel respondeu erro ${response.status}${why ? ': ' + why : ''}. ${response.status === 404 ? 'Essa consulta pode não estar liberada para o plano grátis (Hobby).' : 'Tente de novo em alguns minutos.'}` };
  }
  const text = await response.text();
  if (text.length > 20 * 1024 * 1024) return { configured: true, error: 'Resposta grande demais da Vercel.' };
  return { configured: true, from: from.toISOString(), to: to.toISOString(), ...summarize(parseJsonl(text)) };
}
