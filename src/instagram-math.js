// Contas e textos do módulo Instagram, sem rede e sem dependências.
// Usado pelo servidor (lib/instagram-*.js, Discord) e pelo painel (src/instagram-panel.js), por isso fica em src/.
export const TZ = 'America/Sao_Paulo';
export const DAY_MS = 24 * 60 * 60 * 1000;
export const ORIGENS = ['instagram', 'indicacao', 'google', 'whatsapp', 'site', 'outro'];
export const ORIGEM_LABELS = { instagram: 'Instagram', indicacao: 'Indicação', google: 'Google', whatsapp: 'WhatsApp', site: 'Site', outro: 'Outro' };

export const dayKey = ms => new Date(ms).toLocaleDateString('en-CA', { timeZone: TZ });
export const monthKey = ms => dayKey(ms).slice(0, 7);
export const validDay = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(value + 'T00:00:00Z');
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
};
export const validMonth = value => typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
export const addDays = (day, n) => new Date(Date.parse(day + 'T00:00:00Z') + n * DAY_MS).toISOString().slice(0, 10);
export const daysBetween = (from, to) => Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / DAY_MS);
export const weekdayOf = ms => new Date(Date.parse(dayKey(ms) + 'T12:00:00Z')).getUTCDay(); // 0 = domingo, 1 = segunda

export const formatInt = value => Math.round(Number(value) || 0).toLocaleString('pt-BR');
export const formatSigned = value => { const n = Math.round(Number(value) || 0); return (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n).toLocaleString('pt-BR'); };
export const formatPerDay = value => { const n = Math.round((Number(value) || 0) * 10) / 10; return (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n).toLocaleString('pt-BR', { maximumFractionDigits: 1 }); };
export const formatDayShort = day => validDay(day) ? `${day.slice(8, 10)}/${day.slice(5, 7)}` : '';
export const formatDayLong = day => validDay(day) ? `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}` : '';

const sortedDaily = daily => (Array.isArray(daily) ? daily : []).filter(item => validDay(item?.date) && Number.isFinite(item.followers)).sort((a, b) => a.date.localeCompare(b.date));

// Variação de seguidores nos últimos `days` dias, comparando o último registro com o mais recente que tenha
// pelo menos `days` dias de idade. Se a história for mais curta, usa o primeiro registro e marca partial.
export function followersDelta(daily, today, days) {
  const list = sortedDaily(daily).filter(item => item.date <= today);
  if (list.length < 2) return null;
  const last = list.at(-1), limit = addDays(last.date, -days);
  let base = null;
  for (const item of list) if (item.date <= limit) base = item;
  const partial = !base;
  if (!base) base = list[0];
  if (base === last) return null;
  return { value: last.followers - base.followers, days: daysBetween(base.date, last.date), partial };
}

// Meta de seguidores. Tendência linear nos últimos 14 dias (ou desde o primeiro registro, se houver menos).
// status: 'none' (sem meta) | 'nodata' (poucos registros) | 'achieved' | 'on-pace' | 'behind'
export function projectFollowers({ daily, goal, today, window = 14 }) {
  const list = sortedDaily(daily).filter(item => item.date <= today);
  const current = list.at(-1)?.followers ?? null;
  const target = Number(goal?.target), deadline = goal?.deadline;
  if (!Number.isSafeInteger(target) || target < 1 || !validDay(deadline)) return { status: 'none', current };
  const base = { current, target, deadline, remaining: current === null ? target : Math.max(0, target - current), percent: current === null ? 0 : Math.max(0, Math.min(100, Math.floor(current / target * 100))) };
  if (current !== null && current >= target) return { ...base, status: 'achieved', remaining: 0, percent: 100 };
  if (current === null) return { ...base, status: 'nodata' };
  const last = list.at(-1), limit = addDays(last.date, -window);
  const inside = list.filter(item => item.date >= limit);
  const first = inside[0];
  const daysLeft = daysBetween(today, deadline);
  const needed = daysLeft > 0 ? base.remaining / daysLeft : null;
  if (!first || first === last) return { ...base, status: 'nodata', daysLeft, perDayNeeded: needed };
  const perDayActual = (last.followers - first.followers) / Math.max(1, daysBetween(first.date, last.date));
  let etaDate = null;
  if (perDayActual > 0) etaDate = addDays(today, Math.ceil(base.remaining / perDayActual));
  const onPace = etaDate !== null && etaDate <= deadline;
  return { ...base, status: onPace ? 'on-pace' : 'behind', daysLeft, perDayActual, perDayNeeded: needed, etaDate };
}

export const STATUS_LABEL = { 'on-pace': '✅ No ritmo', behind: '⚠️ Abaixo do ritmo', achieved: '🎉 Meta batida!', nodata: '⏳ Coletando dados', none: 'Sem meta' };

// "No ritmo atual você chega a 2.000 em 18/12 — precisa de +9/dia, está fazendo +6/dia."
export function projectionText(p) {
  if (!p || p.status === 'none') return 'Defina uma meta de seguidores para ver a projeção.';
  if (p.status === 'achieved') return `🎉 Meta batida! Você tem ${formatInt(p.current)} seguidores (meta: ${formatInt(p.target)}).`;
  if (p.status === 'nodata') return 'Ainda não há dias suficientes para calcular o ritmo. Volte amanhã.';
  const needed = p.perDayNeeded === null ? null : formatPerDay(p.perDayNeeded);
  const doing = formatPerDay(p.perDayActual);
  if (p.daysLeft <= 0) return `O prazo (${formatDayLong(p.deadline)}) já passou e faltam ${formatInt(p.remaining)} seguidores. Defina um novo prazo.`;
  if (p.etaDate) {
    const eta = p.etaDate <= p.deadline ? `No ritmo atual você chega a ${formatInt(p.target)} em ${formatDayShort(p.etaDate)}` : `No ritmo atual você chega a ${formatInt(p.target)} só em ${formatDayLong(p.etaDate)} (depois do prazo)`;
    return `${eta} — precisa de ${needed}/dia, está fazendo ${doing}/dia.`;
  }
  return `Sem crescimento nos últimos dias — para chegar a ${formatInt(p.target)} até ${formatDayShort(p.deadline)} precisa de ${needed}/dia, está fazendo ${doing}/dia.`;
}

// Clientes que vieram do Instagram no mês (meta por mês). Retorna { target, clients, leads, percent, status }.
export function clientsProgress({ goal, counts }) {
  const target = Number(goal?.target) || 0, clients = Number(counts?.clients) || 0, leads = Number(counts?.leads) || 0;
  const percent = target > 0 ? Math.max(0, Math.min(100, Math.floor(clients / target * 100))) : 0;
  return { target, clients, leads, percent, status: target > 0 && clients >= target ? 'achieved' : 'open' };
}

// Mês de criação de um cadastro do painel: pelo id (Date.now() em base 36) e, se não der, pela data do cadastro.
export function leadMonth(lead) {
  const match = /^([0-9a-z]{8})[0-9a-z]{0,6}$/.exec(String(lead?.id ?? ''));
  if (match) {
    const time = parseInt(match[1], 36);
    if (time > Date.UTC(2020, 0, 1) && time < Date.UTC(2100, 0, 1)) return monthKey(time);
  }
  const date = String(lead?.date || '');
  return /^\d{4}-\d{2}/.test(date) ? date.slice(0, 7) : '';
}

// Contagem do painel: cadastros com origem=instagram criados no mês e quantos viraram clientes (etapa Fechado).
export function countInstagramLeads(leads, month, closed = lead => lead?.stage === 'Fechado') {
  let total = 0, clients = 0;
  for (const lead of Array.isArray(leads) ? leads : []) {
    if (lead?.origem !== 'instagram' || leadMonth(lead) !== month) continue;
    total++;
    if (closed(lead)) clients++;
  }
  return { leads: total, clients };
}
