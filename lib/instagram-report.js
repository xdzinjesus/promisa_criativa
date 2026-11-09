import { COLORS, progressBar } from './discord.js';
import { dayKey, monthKey, weekdayOf, followersDelta, projectFollowers, projectionText, clientsProgress, STATUS_LABEL, formatInt, formatSigned, formatDayShort, formatDayLong, DAY_MS } from '../src/instagram-math.js';

// Textos do Instagram no Discord (dashboard, resumo do dia, semana). Puros: recebem o histórico já lido.
// Sem dados pessoais e sem token. Retornam null quando não há dados (Instagram não conectado).
const TYPE_LABEL = { REELS: 'Reels', CAROUSEL: 'Carrossel', VIDEO: 'Vídeo', IMAGE: 'Post' };
const oneLine = (value, max) => { const text = String(value ?? '').replace(/\s+/g, ' ').trim(); return text.length > max ? text.slice(0, max - 1) + '…' : text; };
const hasData = history => Boolean(history && history.daily?.length && history.account);
const profileUrl = history => history.account?.username ? `https://www.instagram.com/${encodeURIComponent(history.account.username)}/` : undefined;
const reach = post => post.views ?? post.reach ?? 0;
const score = post => post.views ?? post.reach ?? ((post.likes || 0) + (post.comments || 0));

const delta = (history, at, days) => followersDelta(history.daily, dayKey(at), days);
const deltaText = (d, label) => d ? `${formatSigned(d.value)} ${d.partial ? `em ${d.days} ${d.days === 1 ? 'dia' : 'dias'}` : label}` : 'sem comparação ainda';

export function goalLines(history, at) {
  const lines = [];
  const p = projectFollowers({ daily: history.daily, goal: history.goals?.followers, today: dayKey(at) });
  if (p.status !== 'none') lines.push(`${progressBar(p.percent)}\n${formatInt(p.current)} de ${formatInt(p.target)} até ${formatDayShort(p.deadline)} · ${STATUS_LABEL[p.status]}`);
  return { followers: p, lines };
}

export function clientsLine(history, at) {
  const month = monthKey(at), counts = history.clientsByMonth?.[month], goal = history.goals?.clientsPerMonth;
  if (!counts && !goal?.target) return null;
  const progress = clientsProgress({ goal, counts });
  const detail = `${formatInt(progress.leads)} ${progress.leads === 1 ? 'contato' : 'contatos'} → ${formatInt(progress.clients)} ${progress.clients === 1 ? 'cliente' : 'clientes'}`;
  return goal?.target ? `${progressBar(progress.percent)}\n${formatInt(progress.clients)} de ${formatInt(goal.target)} no mês${progress.status === 'achieved' ? ' · 🎉 meta batida' : ''}\n${detail}` : detail;
}

// Embed "📈 Instagram" do dashboard.
export function buildInstagramEmbed(history, at) {
  if (!hasData(history)) return null;
  const fields = [];
  const week = delta(history, at, 7), month = delta(history, at, 30);
  fields.push({ name: '👥 Seguidores', value: `**${formatInt(history.account.followers)}**\n7 dias: ${deltaText(week, 'em 7 dias')}${month && !month.partial ? `\n30 dias: ${deltaText(month, 'em 30 dias')}` : ''}`, inline: true });
  const goal = goalLines(history, at);
  if (goal.lines.length) fields.push({ name: '🎯 Meta de seguidores', value: goal.lines[0], inline: true });
  const clients = clientsLine(history, at);
  if (clients) fields.push({ name: '🤝 Clientes do Instagram (mês)', value: clients, inline: true });
  const last = history.posts?.[0];
  if (last) {
    const label = `${TYPE_LABEL[last.type] || 'Post'} de ${formatDayShort(dayKey(Date.parse(last.timestamp)))}`;
    const link = last.permalink ? `[${label}](${last.permalink})` : label;
    const metrics = [`❤️ ${formatInt(last.likes)}`, `💬 ${formatInt(last.comments)}`, ...(reach(last) ? [`👁 ${formatInt(reach(last))}`] : [])].join(' · ');
    fields.push({ name: '📸 Último post', value: `${link}\n${metrics}` });
  }
  const stale = history.lastError ? `\n⚠️ A última atualização falhou (${oneLine(history.lastError.message, 80)})` : '';
  return { title: '📈 Instagram', description: `@${oneLine(history.account.username, 40)}${stale}`, fields, color: COLORS.info, url: profileUrl(history) };
}

// Linha do resumo do dia: variação de seguidores e situação da meta.
export function buildInstagramSummaryField(history, at) {
  if (!hasData(history)) return null;
  const day = delta(history, at, 1);
  const p = projectFollowers({ daily: history.daily, goal: history.goals?.followers, today: dayKey(at) });
  const lines = [`**${formatInt(history.account.followers)}** seguidores${day ? ` (${formatSigned(day.value)} desde ontem)` : ''}`];
  if (p.status !== 'none') lines.push(`Meta ${formatInt(p.target)}: ${STATUS_LABEL[p.status]}`);
  return { name: '📈 Instagram', value: lines.join('\n'), inline: true };
}

// Segunda-feira no BRT.
export const isMonday = at => weekdayOf(at) === 1;

// "📈 Semana no Instagram": ganho de seguidores, melhor post da semana e situação da meta.
export function buildWeeklyEmbed(history, at) {
  if (!hasData(history)) return null;
  const week = delta(history, at, 7);
  const since = at - 7 * DAY_MS;
  const recent = (history.posts || []).filter(post => Date.parse(post.timestamp) >= since);
  const best = [...recent].sort((a, b) => score(b) - score(a))[0];
  const fields = [{ name: '👥 Seguidores', value: `**${formatInt(history.account.followers)}**\n${week ? `${formatSigned(week.value)} ${week.partial ? `em ${week.days} ${week.days === 1 ? 'dia' : 'dias'}` : 'na semana'}` : 'ainda sem comparação'}`, inline: true }];
  fields.push({ name: '📝 Posts na semana', value: `**${recent.length}**`, inline: true });
  if (best) {
    const label = `${TYPE_LABEL[best.type] || 'Post'} de ${formatDayShort(dayKey(Date.parse(best.timestamp)))}`;
    const link = best.permalink ? `[${label}](${best.permalink})` : label;
    const metric = best.views != null ? `👁 ${formatInt(best.views)} visualizações` : best.reach != null ? `👁 ${formatInt(best.reach)} de alcance` : `❤️ ${formatInt(best.likes)} · 💬 ${formatInt(best.comments)}`;
    fields.push({ name: '🏆 Melhor post', value: `${link}\n${metric}` });
  }
  const goal = goalLines(history, at);
  if (goal.lines.length) fields.push({ name: '🎯 Meta de seguidores', value: `${goal.lines[0]}\n${projectionText(goal.followers)}` });
  const clients = clientsLine(history, at);
  if (clients) fields.push({ name: '🤝 Clientes do Instagram (mês)', value: clients });
  return { title: '📈 Semana no Instagram', description: `@${oneLine(history.account.username, 40)} · semana até ${formatDayLong(dayKey(at))}`, fields, color: COLORS.brand, url: profileUrl(history) };
}
