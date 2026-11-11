import { dayKey, addDays, daysBetween, weekdayOf, TZ } from './instagram-math.js';

// Cálculos da aba Instagram feitos só com o histórico que o painel já tem
// (nenhuma chamada extra ao Instagram nem ao Blob).

export const WEEKDAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
export const WEEKDAYS_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
export const FORMAT_LABEL = { REELS: 'Reels', CAROUSEL: 'Carrossel', IMAGE: 'Foto', VIDEO: 'Vídeo' };
export const HOUR_BANDS = [
  { key: 'manha', label: 'Manhã (6h–12h)', from: 6, to: 12 },
  { key: 'tarde', label: 'Tarde (12h–18h)', from: 12, to: 18 },
  { key: 'noite', label: 'Noite (18h–24h)', from: 18, to: 24 },
  { key: 'madrugada', label: 'Madrugada (0h–6h)', from: 0, to: 6 }
];

const num = value => Number.isFinite(Number(value)) ? Number(value) : 0;

// Interações de um post: o total da Meta, ou a soma do que houver.
export const interactions = post => post?.interactions != null ? num(post.interactions) : num(post?.likes) + num(post?.comments) + num(post?.saved) + num(post?.shares);

// Taxa de engajamento (%): interações ÷ alcance; sem alcance, ÷ seguidores.
export function engagementRate(post, followers) {
  const base = num(post?.reach) > 0 ? num(post.reach) : num(followers);
  if (base <= 0) return null;
  return Math.round(interactions(post) / base * 1000) / 10;
}

// Pontuação para ranquear posts: visualizações/alcance pesam, interações pesam mais.
export const score = post => interactions(post) * 10 + num(post?.views ?? post?.reach);

export const hourOf = ms => Number(new Date(ms).toLocaleString('en-US', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' })) % 24;

const average = list => list.length ? list.reduce((sum, value) => sum + value, 0) / list.length : null;

// Média de interações por formato (Reels, Carrossel, Foto…), do melhor para o pior.
export function byFormat(posts) {
  const groups = {};
  for (const post of posts || []) (groups[post.type] ||= []).push(post);
  return Object.entries(groups).map(([type, list]) => ({
    type, label: FORMAT_LABEL[type] || 'Post', count: list.length,
    avgInteractions: Math.round(average(list.map(interactions))),
    avgViews: (() => { const views = list.map(p => p.views ?? p.reach).filter(v => v != null); return views.length ? Math.round(average(views.map(num))) : null; })()
  })).sort((a, b) => b.avgInteractions - a.avgInteractions);
}

// Média de interações por dia da semana (0 = domingo).
export function byWeekday(posts) {
  const buckets = Array.from({ length: 7 }, (_, day) => ({ day, label: WEEKDAYS_SHORT[day], count: 0, total: 0 }));
  for (const post of posts || []) { const bucket = buckets[weekdayOf(Date.parse(post.timestamp))]; bucket.count++; bucket.total += interactions(post); }
  return buckets.map(bucket => ({ ...bucket, avg: bucket.count ? Math.round(bucket.total / bucket.count) : null }));
}

export function byHourBand(posts) {
  return HOUR_BANDS.map(band => {
    const list = (posts || []).filter(post => { const hour = hourOf(Date.parse(post.timestamp)); return hour >= band.from && hour < band.to; });
    return { ...band, count: list.length, avg: list.length ? Math.round(average(list.map(interactions))) : null };
  });
}

// Constância: dias desde o último post e posts por semana nas últimas 4 semanas.
export function cadence(posts, today) {
  const sorted = [...(posts || [])].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  const last = sorted[0] ? dayKey(Date.parse(sorted[0].timestamp)) : null;
  const since = addDays(today, -27);
  const recent = sorted.filter(post => dayKey(Date.parse(post.timestamp)) >= since).length;
  return { lastDay: last, daysSince: last ? Math.max(0, daysBetween(last, today)) : null, perWeek: Math.round(recent / 4 * 10) / 10, last28: recent };
}

// Ganho de seguidores por dia (para as barrinhas abaixo do gráfico).
export function dailyGains(daily, today, days) {
  const since = addDays(today, -days + 1);
  const list = (daily || []).filter(item => item.date <= today).sort((a, b) => a.date.localeCompare(b.date));
  const out = [];
  for (let i = 1; i < list.length; i++) if (list[i].date >= since) out.push({ date: list[i].date, gain: list[i].followers - list[i - 1].followers });
  return out;
}

// Dicas automáticas em linguagem simples, a partir dos números.
export function tips({ posts = [], daily = [], followers = 0, today }) {
  const out = [];
  const c = cadence(posts, today);
  if (c.daysSince === null) out.push({ tone: 'warn', icon: '📭', text: 'Ainda não há posts no histórico. Publique algo para o painel começar a comparar.' });
  else if (c.daysSince >= 5) out.push({ tone: 'warn', icon: '⏰', text: `Faz ${c.daysSince} dias sem post. Contas que postam 3× por semana costumam crescer mais rápido.` });
  else out.push({ tone: 'good', icon: '✅', text: c.daysSince === 0 ? 'Você postou hoje. Boa constância!' : `Último post há ${c.daysSince} ${c.daysSince === 1 ? 'dia' : 'dias'}. Ritmo de ${String(c.perWeek).replace('.', ',')} posts por semana.` });

  const formats = byFormat(posts).filter(item => item.count >= 2);
  if (formats.length >= 2 && formats[0].avgInteractions > 0) {
    const [best, second] = formats;
    const times = second.avgInteractions > 0 ? Math.round(best.avgInteractions / second.avgInteractions * 10) / 10 : null;
    out.push({ tone: 'info', icon: '🎬', text: `${best.label} é o formato que mais engaja${times && times >= 1.2 ? ` (${String(times).replace('.', ',')}× mais que ${second.label})` : ''}. Vale fazer mais.` });
  }
  const week = byWeekday(posts).filter(item => item.count >= 1 && item.avg != null).sort((a, b) => b.avg - a.avg);
  if (week.length >= 3) out.push({ tone: 'info', icon: '📅', text: `${WEEKDAYS[week[0].day]} é o dia em que seus posts têm mais interações.` });
  const bands = byHourBand(posts).filter(item => item.count >= 2).sort((a, b) => b.avg - a.avg);
  if (bands.length >= 2) out.push({ tone: 'info', icon: '🕒', text: `Posts de ${bands[0].label.split(' (')[0].toLowerCase()} rendem mais (${bands[0].label.match(/\((.*)\)/)[1]}).` });

  const gains = dailyGains(daily, today, 7).map(item => item.gain);
  if (gains.length >= 3) {
    const total = gains.reduce((a, b) => a + b, 0);
    if (total < 0) out.push({ tone: 'warn', icon: '📉', text: `Você perdeu ${Math.abs(total)} seguidores em 7 dias. Confira se algum post recente destoou do perfil.` });
    else if (total > 0) out.push({ tone: 'good', icon: '📈', text: `+${total} seguidores nos últimos 7 dias.` });
  }
  const top = [...posts].sort((a, b) => score(b) - score(a))[0];
  if (top && interactions(top) > 0) {
    const rate = engagementRate(top, followers);
    out.push({ tone: 'info', icon: '🏆', text: `Seu melhor post recente${top.caption ? ` ("${top.caption.length > 40 ? top.caption.slice(0, 39) + '…' : top.caption}")` : ''} teve ${interactions(top)} interações${rate != null ? ` (${String(rate).replace('.', ',')}% de engajamento)` : ''}. Que tal uma continuação?` });
  }
  return out.slice(0, 5);
}
