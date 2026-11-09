import { discord as defaultDiscord, COLORS, formatBrt } from './discord.js';
import { createData, createdAtFromId } from './discord-data.js';
import { createShareStore, shareState } from './share-store.js';
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
  return { title: `☀️ Bom dia! Resumo de ${formatBrt(at).split(',')[0].split(' ')[0]}`, description: 'Movimento das últimas 24 horas. Abra o painel para ver os detalhes.', fields, url: siteBase() + '/admin', color: COLORS.brand };
}

export function createEvents({ discord = defaultDiscord, data = createData(), shares = createShareStore(), diagnosticos = createDiagnosticoStore(), publishedStore = createPublishStore(), now = () => Date.now(), base = siteBase } = {}) {
  const panel = () => base() + '/admin';
  const safe = fn => async (...args) => { try { return await fn(...args); } catch { return false; } };
  const viewed = new Map(); // token -> hora do último aviso (30 min por instância)

  // Lê o necessário para o resumo (cada parte falha sozinha). Custo: ~8 leituras do Blob por resumo.
  async function summary() {
    const [manifest, shareList, diagnosticoList, publishedList] = await Promise.allSettled([data.manifest(), shares.all(), diagnosticos.list(), publishedStore.list()]);
    const value = result => result.status === 'fulfilled' ? result.value : null;
    return buildSummary({ manifest: value(manifest), shares: value(shareList), diagnosticos: value(diagnosticoList), published: value(publishedList), at: now() });
  }

  return {
    summary,
    briefingSubmitted: safe(async answers => {
      const company = oneLine(String(answers?.q1 || '').split('\n')[0], 70) || 'Um cliente';
      const fields = [
        { name: 'Empresa e segmento', value: oneLine(answers?.q1, 220) || '—' },
        { name: 'Objetivo do site', value: oneLine(choice(answers?.q5), 220) || '—', inline: true },
        { name: 'Estilo visual', value: oneLine(choice(answers?.q7), 120) || '—', inline: true }
      ];
      return discord.notify('novos-clientes', { title: `📝 ${company} respondeu o briefing`, description: 'Veja as respostas completas no painel.', fields, url: panel(), color: COLORS.ok });
    }),
    demoViewed: safe(async ({ token, share, site }) => {
      const at = now();
      if (!discord.configured()) return false;
      if ((viewed.get(token) || 0) > at - 30 * 60_000) return false;
      if (viewed.size > 500) viewed.clear();
      viewed.set(token, at);
      const name = oneLine(site?.name, 80) || oneLine(await data.siteName(share?.siteKey), 80) || 'um cliente';
      return discord.notify('demonstracoes', { title: `👀 Alguém abriu a demonstração de ${name}`, description: `Hora: ${formatBrt(at)} (Brasília)`, color: COLORS.brand }, { dedupe: false });
    }),
    diagnosticoCreated: safe(async report => {
      const host = oneLine(report?.host, 80) || 'site';
      const fields = report?.leadName ? [{ name: 'Cliente', value: oneLine(report.leadName, 100), inline: true }] : [];
      const url = `${base()}/diagnostico/${report.token}`;
      return discord.notify('diagnosticos', { title: `🩺 Diagnóstico de ${host}: nota ${grade(report.score)}/10`, description: `Link do relatório:\n${url}`, fields, url, color: report.score >= 8 ? COLORS.ok : report.score >= 5 ? COLORS.warn : COLORS.bad });
    }),
    sitePublished: safe(async ({ action, name, url, domain }) => {
      const title = action === 'set-domain' ? `🔗 Domínio ligado: ${oneLine(domain, 100)}` : `🌐 ${oneLine(name, 80) || 'Site'} publicado`;
      const fields = [{ name: 'Domínio próprio', value: domain ? `${oneLine(domain, 100)} (pode levar um tempo para propagar)` : 'ainda não ligado', inline: true }];
      return discord.notify('sites-no-ar', { title, description: url ? `Endereço: ${oneLine(url, 200)}` : undefined, fields, url: /^https:\/\//.test(url || '') ? url : undefined, color: COLORS.ok }, { dedupe: false });
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
        description: parts.join('\n') + (pct >= 0.7 ? '\nApague sites ou anexos que não usa mais, ou aumente o plano do Blob.' : ''),
        color: pct >= 0.9 ? COLORS.bad : pct >= 0.7 ? COLORS.warn : COLORS.ok
      });
    }),
    cronFailed: safe(async name => discord.notify('alertas', { title: `🚨 Falha na rotina automática: ${oneLine(name, 40)}`, description: 'A rotina não terminou. Ela tenta de novo no próximo horário; se continuar, veja os registros na Vercel.', color: COLORS.bad })),
    alert: safe(async (title, description, color = COLORS.warn) => discord.notify('alertas', { title: oneLine(title, 200), description: oneLine(description, 500), color }))
  };
}

export const events = createEvents();
