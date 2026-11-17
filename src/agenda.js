// Agenda de entregas: a mesma regra para o painel (Início, cartões, Entregas) e para o Pixel.
// Módulo puro (sem DOM, sem armazenamento). "Hoje" é sempre a data em America/Sao_Paulo.
//
// Regra (documentada para o Pixel recalcular quando a agenda for de outro dia):
//  - Cliente entra se: não está na lixeira, etapa diferente de "Perdido", tem prazo (AAAA-MM-DD)
//    e, se a etapa é "Fechado" com plano de entrega escolhido, o checklist ainda não está completo.
//  - Projeto pessoal entra se: tem dueDate e o status não é "Concluído" nem "Pausado".
//  - Situação: prazo < hoje → "atrasada"; = hoje → "vence-hoje"; até hoje + 7 dias → "proximos"; depois disso não entra.
//  - "sem-prazo" é só uma contagem: clientes Fechados com entrega incompleta e sem prazo.
export const TIMEZONE = 'America/Sao_Paulo';
export const AHEAD_DAYS = 7, MAX_MISSING = 5, AGENDA_VERSION = 1;
export const STATUS_ORDER = ['atrasada', 'vence-hoje', 'proximos'];
const DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
export const validDay = d => typeof d === 'string' && DAY.test(d) && !Number.isNaN(Date.parse(d + 'T12:00:00Z'));
export const todayIn = (now = new Date(), tz = TIMEZONE) => now.toLocaleDateString('en-CA', { timeZone: tz });
export const daysBetween = (from, to) => Math.round((Date.parse(to + 'T12:00:00Z') - Date.parse(from + 'T12:00:00Z')) / 864e5);

// Situação de um prazo em relação a hoje (ou null quando fica fora da agenda).
export function dueStatus(due, today) {
  if (!validDay(due) || !validDay(today)) return null;
  const diff = daysBetween(today, due);
  if (diff < 0) return 'atrasada';
  if (diff === 0) return 'vence-hoje';
  return diff <= AHEAD_DAYS ? 'proximos' : null;
}
// Texto curto para cartões: "Atrasada há 2 dias", "Vence hoje", "Vence amanhã", "Vence em 5 dias", "Prazo 30/11".
export function dueLabel(due, today) {
  if (!validDay(due)) return '';
  const diff = daysBetween(today, due);
  if (diff < 0) return diff === -1 ? 'Atrasada há 1 dia' : `Atrasada há ${-diff} dias`;
  if (diff === 0) return 'Vence hoje';
  if (diff === 1) return 'Vence amanhã';
  if (diff <= AHEAD_DAYS) return `Vence em ${diff} dias`;
  return `Prazo ${due.slice(8, 10)}/${due.slice(5, 7)}`;
}

const stageOf = s => String(s || '').trim();
// Lista de tudo que tem prazo e ainda não foi entregue, SEM depender do dia de hoje.
// É isto que vai para o Pixel: muda só quando um prazo ou uma entrega muda (mínimo de gravações no Blob).
// `progress(lead.entrega)` e `missing(lead.entrega)` vêm do checklist de entregas (src/delivery-checklist.js).
export function agendaSource({ leads = [], projects = [], base = 'https://promisa.online', progress, missing } = {}) {
  const items = []; let semPrazo = 0;
  for (const lead of leads) {
    if (!lead || lead.trashedAt || stageOf(lead.stage) === 'Perdido') continue;
    const closed = stageOf(lead.stage) === 'Fechado', p = closed && lead.entrega?.plano && progress ? progress(lead.entrega) : null;
    if (p?.complete) continue;
    if (!validDay(lead.prazo)) { if (closed) semPrazo++; continue; }
    items.push({
      type: 'entrega', id: String(lead.id), title: String(lead.client || 'Cliente').slice(0, 80), stage: stageOf(lead.stage),
      plan: lead.entrega?.plano || '', done: p?.done ?? 0, total: p?.total ?? 0, pct: p?.pct ?? 0,
      missing: p && missing ? missing(lead.entrega).slice(0, MAX_MISSING) : [],
      due: lead.prazo, url: `${base}/admin?tab=clients&cliente=${encodeURIComponent(lead.id)}&aba=entregas`
    });
  }
  for (const project of projects) {
    if (!project || ['Concluído', 'Pausado'].includes(project.status) || !validDay(project.dueDate)) continue;
    items.push({ type: 'projeto', id: String(project.id), title: String(project.title || 'Projeto').slice(0, 80), stage: String(project.status || ''), plan: '', done: 0, total: 0, pct: 0, missing: [], due: project.dueDate, url: `${base}/admin?tab=projects` });
  }
  items.sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0) || a.title.localeCompare(b.title, 'pt-BR') || (a.id < b.id ? -1 : 1));
  return { version: AGENDA_VERSION, timezone: TIMEZONE, items, semPrazo };
}
// Aplica o dia de hoje: situação de cada item e contagens (o painel usa isto; o Pixel faz a mesma conta).
export function applyToday(source, today) {
  const items = (source?.items || []).map(item => ({ ...item, status: dueStatus(item.due, today) })).filter(item => item.status);
  items.sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || (a.due < b.due ? -1 : a.due > b.due ? 1 : 0) || a.title.localeCompare(b.title, 'pt-BR'));
  const counts = { atrasada: 0, 'vence-hoje': 0, proximos: 0, 'sem-prazo': source?.semPrazo || 0 };
  for (const item of items) counts[item.status]++;
  return { version: AGENDA_VERSION, timezone: TIMEZONE, today, items, counts };
}
export const buildAgenda = ({ today, ...rest } = {}) => applyToday(agendaSource(rest), today);
// Impressão digital do conteúdo (para só gravar quando algo mudou).
export async function agendaHash(source) {
  const bytes = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(source))));
  return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
}

// ---------- Envelope criptografado para o Pixel (AES-GCM 256, Web Crypto: navegador e Node) ----------
export const PIXEL_AAD = 'promisa-pixel-v1';
const enc = new TextEncoder(), dec = new TextDecoder();
const b64 = bytes => { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); };
const unb64 = text => Uint8Array.from(atob(text), c => c.charCodeAt(0));
export const newPixelKey = () => b64(globalThis.crypto.getRandomValues(new Uint8Array(32)));
export const validPixelKey = k => typeof k === 'string' && /^[A-Za-z0-9+/]{43}=$/.test(k);
const importKey = key => globalThis.crypto.subtle.importKey('raw', unb64(key), 'AES-GCM', false, ['encrypt', 'decrypt']);
export async function sealAgenda(agenda, key, updatedAt = new Date().toISOString()) {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await globalThis.crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(PIXEL_AAD) }, await importKey(key), enc.encode(JSON.stringify({ ...agenda, updatedAt }))));
  return { v: 1, alg: 'A256GCM', aad: PIXEL_AAD, iv: b64(iv), ct: b64(ct), updatedAt };
}
export async function openAgenda(envelope, key) {
  const plain = await globalThis.crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(envelope.iv), additionalData: enc.encode(PIXEL_AAD) }, await importKey(key), unb64(envelope.ct));
  return JSON.parse(dec.decode(plain));
}
export const validEnvelope = e => Boolean(e) && typeof e === 'object' && e.v === 1 && e.alg === 'A256GCM' && e.aad === PIXEL_AAD
  && typeof e.iv === 'string' && /^[A-Za-z0-9+/]{16}$/.test(e.iv) && typeof e.ct === 'string' && e.ct.length <= 400_000 && /^[A-Za-z0-9+/]+={0,2}$/.test(e.ct)
  && typeof e.updatedAt === 'string' && !Number.isNaN(Date.parse(e.updatedAt)) && Object.keys(e).length === 6;
