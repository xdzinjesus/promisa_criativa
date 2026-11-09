import { waitUntil as vercelWaitUntil } from '@vercel/functions';
import { discord as defaultDiscord, COLORS, formatBrt, progressBar, gradeText, gradeDot, ICON_URL, FOOTER, DASH_MARK } from './discord.js';
import { createData, createdAtFromId } from './discord-data.js';
import { createShareStore, shareState, siteKeyFor } from './share-store.js';
import { createDiagnosticoStore } from './diagnostico-store.js';
import { createPublishStore } from './publish-store.js';

// Textos dos avisos e do resumo diário. Tudo em português, curto e sem dados pessoais:
// só nome da empresa, resumo do negócio e link do painel (nada de CPF, telefone ou respostas completas).
const DAY_MS = 24 * 60 * 60 * 1000;
export const STORAGE_LIMIT_BYTES = 1024 * 1024 * 1024; // 1 GB do plano Hobby do Blob

export const siteBase = (env = process.env) => {
  const value = String(env.SITE_URL || '').trim().replace(/\/+$/, '');
  return /^https:\/\/[a-z0-9.-]+$/i.test(value) ? value : 'https://www.promisa.online';
};
const oneLine = (value, max) => { const text = String(value ?? '').replace(/\s+/g, ' ').trim(); return text.length > max ? text.slice(0, max - 1) + '…' : text; };
const grade = score => (Number.isFinite(score) ? score : 0).toFixed(1).replace('.', ',');
const choice = answer => answer && typeof answer === 'object' ? [...(answer.selected || []), ...(answer.other ? [answer.other] : [])].join(', ') : '';
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// ---- resumo do dia (puro: recebe os dados já lidos) ----
// manifest: só chaves e datas (nenhum cadastro é aberto). Dados que não deram para ler aparecem como "indisponível".
export function buildSummary({ manifest, shares, diagnosticos, published, at }) {
  const since = at - DAY_MS, fields = [];
  if (manifest) {
    const sales = Object.entries(manifest.records || {}).filter(([key, record]) => key.startsWith('sales:') && record?.hash);
    const created = sales.filter(([key]) => createdAtFromId(decodeURIComponent(key.slice(6))) > since).length;
    const sites = Object.keys(manifest.records || {}).filter(key => key.startsWith('sites:') && manifest.records[key]?.hash).length;
    fields.push({ name: '👥 Clientes', value: `${plural(created, 'novo', 'novos')} nas últimas 24 h\n${sales.length} no total · ${plural(sites, 'site salvo', 'sites salvos')}`, inline: true });
  } else fields.push({ name: '👥 Clientes', value: 'indisponível agora', inline: true });
  if (shares) {
    const active = shares.filter(item => shareState(item, at) === 'active').length;
    const made = shares.filter(item => item.createdAt > since && !item.revokedAt).length;
    fields.push({ name: '🔗 Demonstrações', value: `${plural(made, 'criada', 'criadas')} nas últimas 24 h\n${plural(active, 'ativa', 'ativas')}`, inline: true });
  } else fields.push({ name: '🔗 Demonstrações', value: 'indisponível agora', inline: true });
  if (diagnosticos) {
    const fresh = diagnosticos.filter(item => item.createdAt > since);
    const average = fresh.length ? ` · nota média ${grade(fresh.reduce((sum, item) => sum + (Number(item.score) || 0), 0) / fresh.length)}` : '';
    fields.push({ name: '🩺 Diagnósticos', value: `${plural(fresh.length, 'novo', 'novos')} nas últimas 24 h${average}`, inline: true });
  } else fields.push({ name: '🩺 Diagnósticos', value: 'indisponível agora', inline: true });
  if (published) {
    const entries = Object.values(published);
    const fresh = entries.filter(item => item.lastPublishedAt > since).length;
    fields.push({ name: '🌐 Sites no ar', value: `${plural(fresh, 'publicado ou atualizado', 'publicados ou atualizados')} nas últimas 24 h\n${entries.length} no ar no total`, inline: true });
  } else fields.push({ name: '🌐 Sites no ar', value: 'indisponível agora', inline: true });
  return { title: `☀️ Bom dia! Resumo de ${formatBrt(at).split(',')[0].split(' ')[0]}`, description: 'Movimento das últimas 24 horas. Abra o painel para ver os detalhes.', fields, url: siteBase() + '/admin', color: COLORS.brand, thumbnail: ICON_URL, buttons: [{ label: 'Abrir painel', url: siteBase() + '/admin' }] };
}

const link = (label, url) => /^https:\/\//.test(url || '') ? `[${oneLine(label, 60).replace(/[\[\]]/g, '')}](${url})` : oneLine(label, 60);
const publishedUrl = entry => entry?.domain ? 'https://' + entry.domain : entry?.url;
const publishedName = entry => oneLine(entry?.domain || entry?.project || entry?.url || 'site', 60);
// Nome (sem abrir cadastro) de cada site publicado, pela chave de demonstração.
export const publishedNames = published => Object.fromEntries(Object.entries(published || {}).map(([id, entry]) => [siteKeyFor(id), publishedName(entry)]));

// ---- dashboard (puro): só dados baratos já lidos. names: { 'sites:<id>': 'Nome' } ----
export function buildDashboard({ manifest, shares, diagnosticos, published, names = {}, at, base = siteBase() }) {
  const unavailable = 'indisponível agora';
  const kpi = [];
  if (manifest) {
    const sales = Object.entries(manifest.records || {}).filter(([key, record]) => key.startsWith('sales:') && record?.hash);
    const fresh = sales.filter(([key]) => createdAtFromId(decodeURIComponent(key.slice(6))) > at - 7 * DAY_MS).length;
    kpi.push({ name: '👥 Clientes', value: `**${sales.length}**`, inline: true }, { name: '🆕 Novos (7 dias)', value: `**${fresh}**`, inline: true });
  } else kpi.push({ name: '👥 Clientes', value: unavailable, inline: true }, { name: '🆕 Novos (7 dias)', value: unavailable, inline: true });
  kpi.push({ name: '🌐 Sites no ar', value: published ? `**${Object.keys(published).length}**` : unavailable, inline: true });
  kpi.push({ name: '👀 Demos ativas', value: shares ? `**${shares.filter(item => shareState(item, at) === 'active').length}**` : unavailable, inline: true });
  kpi.push({ name: '🩺 Diagnósticos (30 dias)', value: diagnosticos ? `**${diagnosticos.filter(item => item.createdAt > at - 30 * DAY_MS).length}**` : unavailable, inline: true });
  const empty = 'Nada por aqui ainda ✨';
  const sites = published ? Object.values(published).filter(entry => entry?.url || entry?.domain).sort((a, b) => (b.lastPublishedAt || 0) - (a.lastPublishedAt || 0)).slice(0, 5).map(entry => `• ${link(publishedName(entry), publishedUrl(entry))}`) : null;
  const reports = diagnosticos ? diagnosticos.slice(0, 5).map(item => `${gradeDot(item.score)} ${link(item.host || 'site', `${base}/diagnostico/${item.token}`)} · ${gradeText(item.score).slice(3)}`) : null;
  const expiring = shares ? shares.filter(item => shareState(item, at) === 'active' && item.expiresAt - at <= 7 * DAY_MS).sort((a, b) => a.expiresAt - b.expiresAt).slice(0, 5).map(item => {
    const days = Math.ceil((item.expiresAt - at) / DAY_MS);
    return `• **${oneLine(names[item.siteKey] || 'Site', 50)}** · ${days <= 1 ? 'vence hoje ou amanhã' : `faltam ${days} dias`}`;
  }) : null;
  const section = (lines) => lines === null ? unavailable : lines.length ? lines.join('\n') : empty;
  const unix = Math.floor(at / 1000);
  return {
    embeds: [
      { title: '📊 Painel da Promisa', description: `Visão geral do negócio · Atualizado <t:${unix}:R>`, fields: kpi, color: COLORS.brand, thumbnail: ICON_URL, url: base + '/admin' },
      { title: '📌 Em destaque', fields: [
        { name: '🚀 Últimos sites publicados', value: section(sites) },
        { name: '🩺 Últimos diagnósticos', value: section(reports) },
        { name: '⏳ Demos que vencem em breve', value: section(expiring) }
      ], color: COLORS.info, footer: `${FOOTER} · ${DASH_MARK}` }
    ],
    buttons: [{ label: 'Abrir painel', url: base + '/admin' }, { label: 'Abrir site da Promisa', url: base }]
  };
}

export function createEvents({ discord = defaultDiscord, data = createData(), shares = createShareStore(), diagnosticos = createDiagnosticoStore(), publishedStore = createPublishStore(), now = () => Date.now(), base = siteBase, waitUntil = vercelWaitUntil } = {}) {
  const panel = () => base() + '/admin';
  const safe = fn => async (...args) => { try { return await fn(...args); } catch { return false; } };
  const viewed = new Map(); // token -> hora do último aviso (30 min por instância)

  // Lê UMA vez o que o resumo e o dashboard precisam (cada parte falha sozinha).
  // Custo no Blob: 4 leituras (manifesto, links de demonstração, diagnósticos, sites publicados).
  async function readData() {
    const [manifest, shareList, diagnosticoList, publishedList] = await Promise.allSettled([data.manifest(), shares.all(), diagnosticos.list(), publishedStore.list()]);
    const value = result => result.status === 'fulfilled' ? result.value : null;
    return { manifest: value(manifest), shares: value(shareList), diagnosticos: value(diagnosticoList), published: value(publishedList) };
  }
  async function summary(shared) {
    return buildSummary({ ...(shared || await readData()), at: now() });
  }

  // Dashboard: edita a mensagem do canal. Custo: 4 leituras + até 3 nomes de site = no máximo 7 leituras (cron: reaproveita `shared`, só os nomes extras).
  let refreshing = false;
  async function refreshDashboard({ shared } = {}) {
    if (refreshing || !discord.configured()) return false;
    refreshing = true;
    try {
      const list = shared || await readData();
      const names = publishedNames(list.published);
      const missing = [...new Set((list.shares || []).filter(item => shareState(item, now()) === 'active' && item.expiresAt - now() <= 7 * DAY_MS && !names[item.siteKey]).sort((a, b) => a.expiresAt - b.expiresAt).slice(0, 5).map(item => item.siteKey))].slice(0, 3);
      for (const key of missing) { const name = oneLine(await data.siteName(key), 50); if (name) names[key] = name; }
      const result = await discord.upsertDashboard(buildDashboard({ ...list, names, at: now(), base: base() }));
      return Boolean(result?.ok);
    } catch { return false; } finally { refreshing = false; }
  }
  // Atualização por evento: no máximo 1 a cada 60 min e 6 por dia (UTC) nesta instância, em segundo plano.
  const EVENT_GAP_MS = 60 * 60_000, EVENT_PER_DAY = 6;
  let lastEvent = 0, eventDay = '', eventCount = 0;
  function dashboardSoon() {
    try {
      if (!discord.configured()) return false;
      const at = now(), day = new Date(at).toISOString().slice(0, 10);
      if (day !== eventDay) { eventDay = day; eventCount = 0; }
      if (at - lastEvent < EVENT_GAP_MS || eventCount >= EVENT_PER_DAY) return false;
      lastEvent = at; eventCount++;
      const job = refreshDashboard().catch(() => false);
      try { waitUntil(job); } catch { /* fora da Vercel segue sozinho */ }
      return true;
    } catch { return false; }
  }

  return {
    summary, readData, refreshDashboard, dashboardSoon,
    briefingSubmitted: safe(async answers => {
      const company = oneLine(String(answers?.q1 || '').split('\n')[0], 70) || 'Um cliente';
      const fields = [
        { name: 'Empresa e segmento', value: oneLine(answers?.q1, 220) || '—' },
        { name: 'Objetivo do site', value: oneLine(choice(answers?.q5), 220) || '—', inline: true },
        { name: 'Estilo visual', value: oneLine(choice(answers?.q7), 120) || '—', inline: true }
      ];
      return discord.notify('novos-clientes', { title: `🆕 ${company} respondeu o briefing`, description: 'Veja as respostas completas no painel.', fields, url: panel(), color: COLORS.ok, buttons: [{ label: 'Abrir painel', url: panel() }] });
    }),
    demoViewed: safe(async ({ token, share, site, visitor }) => {
      const at = now();
      if (!discord.configured()) return false;
      const key = visitor?.bot ? token + ':bot' : token;
      if ((viewed.get(key) || 0) > at - 30 * 60_000) return false;
      if (viewed.size > 500) viewed.clear();
      viewed.set(key, at);
      const name = oneLine(site?.name, 80) || oneLine(await data.siteName(share?.siteKey), 80) || 'um cliente';
      const fields = [];
      if (visitor?.device) fields.push({ name: 'Aparelho', value: oneLine(visitor.device + (visitor.browser ? ' · ' + visitor.browser : ''), 100), inline: true });
      if (visitor?.place) fields.push({ name: 'Cidade aproximada', value: '📍 ' + oneLine(visitor.place, 80), inline: true });
      const title = visitor?.bot ? `🔗 Prévia do link da demonstração de ${name} gerada` : `👀 Alguém abriu a demonstração de ${name}`;
      const hint = visitor?.bot ? 'Um app (como o WhatsApp) leu o link para montar a prévia. Isso não significa que o cliente abriu.' : '';
      return discord.notify('demonstracoes', { title, description: `${hint ? hint + '\n' : ''}🕐 <t:${Math.floor(at / 1000)}:F>`, fields, color: COLORS.info, buttons: [{ label: 'Abrir demonstração', url: `${base()}/demo/${token}` }] }, { dedupe: false });
    }),
    diagnosticoCreated: safe(async report => {
      const host = oneLine(report?.host, 80) || 'site';
      const fields = [{ name: 'Nota', value: gradeText(report.score), inline: true }, { name: 'Site', value: host, inline: true }];
      if (report?.leadName) fields.push({ name: 'Cliente', value: oneLine(report.leadName, 100), inline: true });
      const url = `${base()}/diagnostico/${report.token}`;
      const buttons = [{ label: 'Ver diagnóstico', url }];
      if (/^https:\/\//.test(report?.siteUrl || '')) buttons.push({ label: 'Abrir site', url: report.siteUrl });
      const sent = await discord.notify('diagnosticos', { title: `🩺 Diagnóstico de ${host}`, description: 'Um novo relatório está pronto para enviar ao cliente.', fields, url, color: report.score >= 8 ? COLORS.ok : report.score >= 5 ? COLORS.warn : COLORS.bad, buttons });
      dashboardSoon();
      return sent;
    }),
    sitePublished: safe(async ({ action, name, url, domain }) => {
      const title = action === 'set-domain' ? `🔗 Domínio ligado: ${oneLine(domain, 100)}` : `🌐 ${oneLine(name, 80) || 'Site'} publicado`;
      const fields = [{ name: 'Domínio próprio', value: domain ? `${oneLine(domain, 100)} (pode levar um tempo para propagar)` : 'ainda não ligado', inline: true }];
      const open = domain ? 'https://' + domain : url;
      const sent = await discord.notify('sites-no-ar', { title, description: url ? `Endereço: ${oneLine(url, 200)}` : undefined, fields, url: /^https:\/\//.test(url || '') ? url : undefined, color: COLORS.ok, buttons: [{ label: 'Abrir site', url: open }] }, { dedupe: false });
      dashboardSoon();
      return sent;
    }),
    publishFailed: safe(async ({ action, code, status }) => discord.notify('alertas', {
      title: action === 'set-domain' ? '⚠️ Não consegui ligar o domínio' : '⚠️ Não consegui publicar o site',
      description: `Tente de novo pelo painel. Se repetir, confira a chave da Cloudflare na Vercel.${code || status ? `\nCódigo: ${oneLine(code || status, 60)}` : ''}`, color: COLORS.bad
    })),
    maintenanceDone: safe(async result => {
      const used = Number(result?.objectBytes) || 0, pct = used / STORAGE_LIMIT_BYTES;
      const removed = Number(result?.removed) || 0;
      if (pct < 0.7 && !removed) return false;
      const mb = bytes => (bytes / (1024 * 1024)).toFixed(bytes >= 100 * 1024 * 1024 ? 0 : 1).replace('.', ',');
      const parts = [];
      if (pct >= 0.7) parts.push(`📦 Armazenamento: ${mb(used)} MB de 1.024 MB (${Math.round(pct * 100)}%).${result?.objectBytesComplete === false ? ' (medida parcial)' : ''}`);
      if (removed) parts.push(`🧹 Arquivos antigos removidos: ${removed}.`);
      return discord.notify('alertas', {
        title: pct >= 0.9 ? '🚨 Armazenamento quase cheio' : pct >= 0.7 ? '⚠️ Armazenamento passando de 70%' : '🧹 Manutenção do armazenamento',
        description: (pct >= 0.7 ? `${progressBar(pct * 100)}\n` : '') + parts.join('\n') + (pct >= 0.7 ? '\nApague sites ou anexos que não usa mais, ou aumente o plano do Blob.' : ''),
        color: pct >= 0.9 ? COLORS.bad : pct >= 0.7 ? COLORS.warn : COLORS.ok, buttons: [{ label: 'Abrir painel', url: panel() }]
      });
    }),
    cronFailed: safe(async name => discord.notify('alertas', { title: `🚨 Falha na rotina automática: ${oneLine(name, 40)}`, description: 'A rotina não terminou. Ela tenta de novo no próximo horário; se continuar, veja os registros na Vercel.', color: COLORS.bad })),
    alert: safe(async (title, description, color = COLORS.warn) => discord.notify('alertas', { title: oneLine(title, 200), description: oneLine(description, 500), color }))
  };
}

export const events = createEvents();
