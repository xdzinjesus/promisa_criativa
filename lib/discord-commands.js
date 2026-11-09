import { validId } from '../src/data-validation.js';
import { AnalyzeError } from './diagnostico-analyze.js';
import { DiagnosticoError } from './diagnostico-store.js';
import { CloudflareError } from './cloudflare-pages.js';
import { PublishStoreError } from './publish-store.js';
import { NotSyncedError, NOT_CONFIGURED } from './publish-handler.js';
import { ShareError, siteKeyFor, shareState } from './share-store.js';
import { buildEmbed, COLORS, formatBrt } from './discord.js';
import { normalize } from './discord-data.js';

// Comandos de barra do Discord (somente o dono). Cada comando devolve { content?, embeds? }.
// `plan(interaction)` decide se responde na hora (quick) ou depois (work), porque o Discord exige o "recebi" em 3 s.
const DAY_MS = 24 * 60 * 60 * 1000;
const GENERIC = '❌ Não consegui concluir agora. Tente de novo em instantes.';
const VAULT = '🔐 Os cadastros dos clientes estão protegidos por criptografia e só abrem no painel; o robô não consegue lê-los. Procurei apenas pelo nome dos sites.';
export const HELP = [
  '**Comandos da Promisa** 💜',
  '`/diagnostico url:` analisa o site de uma empresa e gera o link do relatório',
  '`/cliente nome:` mostra etapa, plano, site, demonstração e publicação',
  '`/demo nome: dias:` cria um link de demonstração (1 a 30 dias, padrão 7)',
  '`/publicar nome:` publica ou atualiza o site do cliente na internet',
  '`/resumo` mostra o resumo do dia agora',
  '`/configurar` cria os canais que faltam e atualiza os comandos',
  '`/ajuda` mostra esta lista'
].join('\n');

const oneLine = (value, max) => { const text = String(value ?? '').replace(/\s+/g, ' ').trim(); return text.length > max ? text.slice(0, max - 1) + '…' : text; };
const day = ms => formatBrt(ms).split(',')[0].split(' ')[0];
const grade = score => (Number.isFinite(score) ? score : 0).toFixed(1).replace('.', ',');
const PLANS = { essencial: 'Essencial', profissional: 'Profissional', premium: 'Premium' };

export function createCommands({ discord, data, events, shares, diagnosticos, publishedStore, analyze, cloudflare, readSiteInfo, publishSite, now = () => Date.now(), base = () => 'https://www.promisa.online', log = console }) {
  const embed = message => buildEmbed(message, now());
  const reply = message => ({ embeds: [embed(message)] });

  // Traduz erros conhecidos em frases amigáveis (nunca expõe detalhes técnicos).
  function friendly(name, error) {
    if (error instanceof AnalyzeError || error instanceof DiagnosticoError || error instanceof PublishStoreError || error instanceof ShareError || error instanceof CloudflareError) return `❌ ${error.message}`;
    if (error instanceof NotSyncedError) return '❌ Esse site ainda não está salvo online. Abra o painel, sincronize e tente de novo.';
    try { log.error?.('[discord]', 'comando', name, error?.name || error?.constructor?.name || 'erro'); } catch { /* sem log */ }
    return GENERIC;
  }

  // Resolve "nome" para UM cliente/site. Devolve { error } ou { lead, site, label }.
  async function resolveOne(query, { needSite = true } = {}) {
    const found = await data.findTargets(query);
    if (found.empty) return { error: '📭 Ainda não há dados salvos online. Abra o painel e sincronize.' };
    let { matches } = found;
    if (matches.length > 1) {
      const exact = matches.filter(match => normalize(match.lead?.client ?? match.sites[0]?.name) === normalize(query));
      if (exact.length === 1) matches = exact;
    }
    if (!matches.length) return { error: `${found.sealed ? VAULT + '\n' : ''}🔎 Não encontrei ninguém com "${oneLine(query, 60)}".${found.truncated ? ' (A busca olhou só os primeiros registros.)' : ''}` };
    if (matches.length > 1) return { error: `🔎 Achei ${matches.length} resultados: ${matches.slice(0, 8).map(match => oneLine(match.lead?.client ?? match.sites[0]?.name, 40)).join(', ')}. Escreva o nome completo.` };
    const [match] = matches;
    const label = oneLine(match.lead?.client ?? match.sites[0]?.name, 80);
    if (!needSite) return { lead: match.lead, sites: match.sites, label };
    const site = match.sites[0];
    if (!site || !validId(site.id) || ['__proto__', 'constructor', 'prototype'].includes(String(site.id))) return { error: `🌐 ${label} ainda não tem um site anexado no painel.` };
    return { lead: match.lead, site, label, extraSites: match.sites.length - 1 };
  }

  const commands = {
    ajuda: () => ({ quick: { content: HELP } }),

    configurar: () => ({
      work: async () => {
        const setup = await discord.setupChannels();
        const registered = await discord.registerCommands();
        const lines = [];
        if (setup.ok) lines.push(setup.created.length ? `✅ Criei ${setup.created.length === 1 ? 'o canal' : 'os canais'}: ${setup.created.map(name => '#' + name).join(', ')}` : '✅ Todos os canais já existem.');
        else if (setup.error === 'forbidden') lines.push('❌ O robô não tem permissão para criar canais. No servidor, dê a ele a permissão "Gerenciar canais" e tente de novo.');
        else lines.push(`⚠️ Não consegui criar todos os canais${setup.created?.length ? ` (criei: ${setup.created.map(name => '#' + name).join(', ')})` : ''}. Tente de novo.`);
        lines.push(registered.ok ? `✅ Comandos atualizados (${registered.count}).` : '⚠️ Não consegui atualizar a lista de comandos.');
        return { content: lines.join('\n') };
      }
    }),

    resumo: () => ({ work: async () => reply(await events.summary()) }),

    diagnostico: options => ({
      work: async () => {
        const url = oneLine(options.url, 300);
        if (!url) return { content: '❌ Informe o endereço do site, por exemplo: www.empresa.com.br' };
        const result = await analyze(url);
        const report = await diagnosticos.create({ ...result, leadId: '', leadName: '', demoUrl: '' });
        await events.diagnosticoCreated(report);
        const link = `${base()}/diagnostico/${report.token}`;
        return reply({
          title: `🩺 Diagnóstico de ${oneLine(report.host, 80)}: nota ${grade(report.score)}/10`,
          description: `Link para enviar ao cliente:\n${link}\n\nVale até ${day(report.expiresAt)}.`,
          url: link, color: report.score >= 8 ? COLORS.ok : report.score >= 5 ? COLORS.warn : COLORS.bad
        });
      }
    }),

    cliente: options => ({
      work: async () => {
        const found = await data.findTargets(options.nome);
        if (found.empty) return { content: '📭 Ainda não há dados salvos online. Abra o painel e sincronize.' };
        if (!found.matches.length) return { content: `${found.sealed ? VAULT + '\n' : ''}🔎 Não encontrei ninguém com "${oneLine(options.nome, 60)}".` };
        if (found.matches.length > 5) return { content: `🔎 Achei ${found.matches.length} resultados (${found.matches.slice(0, 8).map(match => oneLine(match.lead?.client ?? match.sites[0]?.name, 30)).join(', ')}…). Escreva mais do nome.` };
        const at = now();
        const [shareList, published, reports] = await Promise.all([
          shares.all().catch(() => []), publishedStore.list().catch(() => ({})), diagnosticos.list().catch(() => [])
        ]);
        const fields = found.matches.map(({ lead, sites }) => {
          const lines = [];
          if (lead) {
            lines.push(`Etapa: **${oneLine(lead.stage, 30) || '—'}**${lead.paid ? ' · 💰 pago' : ''}`);
            lines.push(`Plano: ${PLANS[lead.entrega?.plano] || 'ainda não definido'}`);
          }
          if (!sites.length) lines.push('🌐 Sem site anexado');
          for (const site of sites.slice(0, 3)) {
            lines.push(`🌐 **${oneLine(site.name, 60)}**${site.status ? ` · ${oneLine(site.status, 30)}` : ''}`);
            const demos = shareList.filter(item => item.siteKey === siteKeyFor(site.id) && shareState(item, at) === 'active');
            lines.push(demos.length ? demos.slice(0, 2).map(item => `🔗 ${base()}/demo/${item.token} (até ${day(item.expiresAt)})`).join('\n') : '🔗 Sem demonstração ativa');
            const entry = Object.hasOwn(published, String(site.id)) ? published[String(site.id)] : null;
            lines.push(entry?.url ? `🚀 No ar: ${entry.domain ? 'https://' + entry.domain : entry.url}` : '🚀 Ainda não publicado');
          }
          const mine = lead ? reports.filter(report => report.leadId === String(lead.id)).slice(0, 2) : [];
          if (mine.length) lines.push(mine.map(report => `🩺 ${oneLine(report.host, 40)}: nota ${grade(report.score)} · ${base()}/diagnostico/${report.token}`).join('\n'));
          return { name: `👤 ${oneLine(lead?.client ?? sites[0]?.name, 80)}`, value: lines.join('\n') };
        });
        return reply({ title: found.matches.length === 1 ? 'Situação do cliente' : `${found.matches.length} clientes encontrados`, description: found.sealed ? VAULT : undefined, fields: fields.slice(0, 5), url: base() + '/admin', color: COLORS.brand });
      }
    }),

    demo: options => ({
      work: async () => {
        const found = await resolveOne(options.nome);
        if (found.error) return { content: found.error };
        const manifest = await data.manifest();
        if (!manifest?.records?.[siteKeyFor(found.site.id)]?.hash) return { content: '❌ Este site ainda não está salvo online. Aguarde o indicador "Salvo online" no painel e tente de novo.' };
        const days = Number.isInteger(options.dias) ? Math.min(30, Math.max(1, options.dias)) : 7;
        const share = await shares.create(String(found.site.id), now() + days * DAY_MS);
        return reply({
          title: `🔗 Demonstração de ${found.label}`,
          description: `${base()}/demo/${share.token}\n\nVale por ${days} ${days === 1 ? 'dia' : 'dias'} (até ${day(share.expiresAt)}).${found.extraSites > 0 ? `\nSite usado: ${oneLine(found.site.name, 60)} (o mais recente).` : ''}`,
          url: `${base()}/demo/${share.token}`, color: COLORS.ok
        });
      }
    }),

    publicar: options => ({
      work: async () => {
        const found = await resolveOne(options.nome);
        if (found.error) return { content: found.error };
        const client = cloudflare();
        if (!client) return { content: `❌ ${NOT_CONFIGURED}` };
        let out;
        try {
          const entry = await publishedStore.get(String(found.site.id));
          out = await publishSite({ store: publishedStore, client, readSiteInfo, now }, String(found.site.id), null, entry);
        } catch (error) {
          if (!(error instanceof NotSyncedError)) await events.publishFailed({ action: 'publish', code: error?.code || '', status: error?.status || 0 });
          throw error;
        }
        await events.sitePublished({ action: 'publish', name: out.siteName || found.site.name || found.label, url: out.url, domain: out.domain });
        return reply({ title: `🌐 ${found.label} publicado`, description: `${out.domain ? 'https://' + out.domain : out.url}\n\nArquivos enviados: ${out.uploaded ?? 0} de ${out.total ?? 0}.`, url: out.url, color: COLORS.ok });
      }
    })
  };

  // Devolve { quick } ou { work }. Erros no trabalho viram mensagem amigável.
  return {
    names: Object.keys(commands),
    plan(interaction) {
      const name = String(interaction?.data?.name || '');
      if (!Object.hasOwn(commands, name)) return { quick: { content: '🤔 Não conheço esse comando. Use `/ajuda`.' } };
      const options = Object.fromEntries((Array.isArray(interaction.data.options) ? interaction.data.options : []).filter(item => item && typeof item.name === 'string').map(item => [item.name, item.value]));
      const planned = commands[name](options);
      if (planned.quick) return planned;
      return { work: async () => { try { return await planned.work(); } catch (error) { return { content: friendly(name, error) }; } } };
    }
  };
}
