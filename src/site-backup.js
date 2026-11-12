// Backup automático dos sites do painel no Discord (canal 🗄️・backup-sites).
// Lê os sites do próprio navegador (IndexedDB) e envia o ZIP direto ao webhook do Discord:
// os arquivos não passam pela Vercel (limite de 4,5 MB por pedido) nem pelo Blob.
// Sem duplicar: cada site é identificado pelo conteúdo (SHA-256 dos arquivos). Antes de enviar, o painel confere
// a lista do que já está no canal (vale para todos os aparelhos, 1 leitura pequena) e marca cada envio nela.
// Entre abas do mesmo navegador, uma trava (Web Locks) impede dois envios ao mesmo tempo.
// Nada de dados de contato do cliente.

const SITE_DB = 'arquivo-sites-v1', SITE_STORE = 'sites';
const DONE_KEY = 'promisa_site_backup_v2';
export const PART_BYTES = 8 * 1024 * 1024; // abaixo do limite de 10 MB do Discord (servidor sem impulso)
const FIRST_CHECK_MS = 20_000, CHECK_EVERY_MS = 10 * 60_000;

// "Impressão digital" do conteúdo do site: muda só quando algum arquivo muda (nome do site não conta).
const toBytes = async data => data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : data instanceof ArrayBuffer ? new Uint8Array(data) : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : new TextEncoder().encode(String(data ?? ''));
export async function contentHash(site) {
  const encoder = new TextEncoder(), chunks = [];
  if (site?.sourceZip?.blob instanceof Blob) chunks.push(encoder.encode('zip\0'), await toBytes(site.sourceZip.blob));
  else for (const file of [...(site?.files || [])].sort((a, b) => String(a.path).localeCompare(String(b.path)))) chunks.push(encoder.encode(String(file.path) + '\0'), await toBytes(file.data), encoder.encode('\0'));
  const total = new Uint8Array(chunks.reduce((sum, c) => sum + c.byteLength, 0));
  let at = 0; for (const c of chunks) { total.set(c, at); at += c.byteLength; }
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', total));
  return [...digest.slice(0, 16)].map(b => b.toString(16).padStart(2, '0')).join('');
}
export const formatSize = bytes => bytes >= 1048576 ? (bytes / 1048576).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' MB' : Math.max(1, Math.round(bytes / 1024)) + ' KB';
export const safeName = text => String(text || 'site').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'site';
// Pedaços de no máximo PART_BYTES (juntar com 7-Zip abrindo a parte .001).
export function splitParts(size, partBytes = PART_BYTES) {
  if (size <= partBytes) return [{ start: 0, end: size }];
  const parts = [];
  for (let start = 0; start < size; start += partBytes) parts.push({ start, end: Math.min(size, start + partBytes) });
  return parts;
}
// Sites cujo conteúdo ainda não está no canal: compara com o que este aparelho já sabe e com a lista do Discord.
export function pendingSites(hashed, ...known) {
  return hashed.filter(({ site, hash }) => site?.id && !known.some(map => (map?.[site.id]?.h ?? map?.[site.id]) === hash));
}

function readDone() { try { return JSON.parse(localStorage.getItem(DONE_KEY) || '{}') || {}; } catch { return {}; } }
function writeDone(done) { try { localStorage.setItem(DONE_KEY, JSON.stringify(done)); } catch { /* sem armazenamento local */ } }

function allSites() {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(SITE_DB);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains(SITE_STORE)) { db.close(); resolve([]); return; }
      const request = db.transaction(SITE_STORE, 'readonly').objectStore(SITE_STORE).getAll();
      request.onsuccess = () => { db.close(); resolve(request.result || []); };
      request.onerror = () => { db.close(); reject(request.error); };
    };
  });
}

let target = null;
async function webhook() {
  if (target) return target;
  const response = await fetch('/api/discord', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', cache: 'no-store', body: JSON.stringify({ action: 'backup-target' }) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.url) throw Object.assign(new Error(body.error || 'Discord indisponível.'), { reason: body.reason || body.code || 'error' });
  target = body.url;
  return target;
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function send(content, blob, filename) {
  const url = await webhook();
  for (let attempt = 0; attempt < 4; attempt++) {
    const form = new FormData();
    form.append('payload_json', JSON.stringify({ content, allowed_mentions: { parse: [] }, username: 'Promisa Backup' }));
    form.append('files[0]', blob, filename);
    const response = await fetch(url + '?wait=true', { method: 'POST', body: form });
    if (response.ok) return;
    if (response.status === 429) { const body = await response.json().catch(() => ({})); await sleep(Math.min(30_000, Math.ceil((Number(body.retry_after) || 2) * 1000))); continue; }
    if (response.status === 404 || response.status === 401) target = null; // webhook apagado: pede de novo
    if (response.status === 413) throw Object.assign(new Error('Arquivo grande demais para o Discord.'), { reason: 'too-large' });
    throw Object.assign(new Error('O Discord recusou o envio (' + response.status + ').'), { reason: 'discord' });
  }
  throw Object.assign(new Error('O Discord pediu para esperar. Tento de novo mais tarde.'), { reason: 'rate' });
}

async function backupSite(site) {
  const makeZip = window.promisaSiteZip;
  const zip = site.sourceZip?.blob instanceof Blob ? site.sourceZip.blob : typeof makeZip === 'function' ? await makeZip(site) : null;
  if (!(zip instanceof Blob)) throw new Error('Não consegui montar o ZIP.');
  const when = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });
  const base = `${safeName(site.slug || site.name)}-${new Date().toISOString().slice(0, 10)}.zip`;
  const kind = site.siteType === 'pessoal' ? 'site pessoal' : 'site de cliente';
  const parts = splitParts(zip.size);
  for (const [index, part] of parts.entries()) {
    const label = parts.length > 1 ? ` · parte ${index + 1} de ${parts.length}` : '';
    const content = `🗄️ **${String(site.name || 'Site').slice(0, 80)}** (${kind})${label}\n📅 ${when} · 📦 ${formatSize(zip.size)}${parts.length > 1 ? ' no total — baixe todas as partes e abra a .001 no 7-Zip' : ''}`;
    await send(content, zip.slice(part.start, part.end), parts.length > 1 ? `${base}.${String(index + 1).padStart(3, '0')}` : base);
  }
}

async function panelApi(action, extra = {}) {
  const response = await fetch('/api/discord', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', cache: 'no-store', body: JSON.stringify({ action, ...extra }) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(body.error || 'Discord indisponível.'), { reason: body.code || body.reason || 'error' });
  return body;
}
// Uma aba por vez (se o navegador não tiver Web Locks, segue sem a trava).
const exclusive = fn => navigator.locks?.request ? navigator.locks.request('promisa-site-backup', { ifAvailable: true }, lock => lock ? fn() : undefined) : fn();

const state = { running: false, last: null, error: '', pending: 0, sent: 0, listeners: new Set() };
const emit = () => state.listeners.forEach(fn => { try { fn(); } catch { /* ok */ } });

// Envia os sites novos ou alterados, um por vez, sem repetir o que já está no canal.
export async function runBackup({ manual = false, recheck = false } = {}) {
  if (state.running || !navigator.onLine || (state.blocked && !manual)) return;
  state.running = true; state.error = ''; state.sent = 0; emit();
  try {
    await exclusive(async () => {
      const sites = await allSites();
      const hashed = [];
      for (const site of sites) if (site?.id) hashed.push({ site, hash: await contentHash(site) });
      const local = readDone();
      for (const id of Object.keys(local)) if (!sites.some(site => site.id === id)) delete local[id];
      let todo = pendingSites(hashed, recheck ? {} : local);
      if (todo.length) {
        // Confere a lista do canal (todos os aparelhos) antes de enviar qualquer coisa.
        const remote = (await panelApi('backup-index')).sites || {};
        for (const { site, hash } of todo) if (remote[site.id]?.h === hash) local[site.id] = hash;
        writeDone(local);
        todo = pendingSites(todo, remote);
      }
      state.pending = todo.length; emit();
      for (const { site, hash } of todo) {
        await backupSite(site);
        local[site.id] = hash; writeDone(local);
        await panelApi('backup-mark', { items: [{ id: site.id, h: hash }] }).catch(() => {}); // se falhar, o aviso local já evita repetir aqui
        state.sent++; state.pending--; emit();
      }
      writeDone(local);
      state.last = Date.now();
    });
  } catch (error) {
    state.blocked = Boolean(HELP[error.reason]); // configuração faltando: não tenta sozinho de novo até reabrir o painel
    state.error = HELP[error.reason] ? error.reason : (error.message || 'Falha no backup.');
  } finally { state.running = false; emit(); }
}

// ---- cartão na aba Backup ----
const el = (tag, text, props = {}) => Object.assign(document.createElement(tag), text == null ? {} : { textContent: text }, props);
const HELP = {
  'no-channel': 'Falta o canal 🗄️・backup-sites. No painel, abra 💬 Discord e toque em "Criar canais".',
  permission: 'O robô do Discord não tem a permissão "Gerenciar webhooks". Veja o passo a passo abaixo.',
  'not-configured': 'O Discord ainda não está ligado ao painel.',
  'discord-not-configured': 'O Discord ainda não está ligado ao painel.'
};
function mount(root) {
  if (!root) return;
  const draw = () => {
    if (!root.isConnected) { state.listeners.delete(draw); return; }
    root.replaceChildren();
    root.append(el('h2', '🗄️ Backup automático no Discord', { style: 'margin-top:0' }), el('p', 'Sempre que um site é anexado ou alterado, o painel guarda uma cópia em ZIP no canal 🗄️・backup-sites do Discord. Cada versão vai uma vez só, mesmo usando vários aparelhos.'));
    const status = el('p', null, { className: 'site-count', role: 'status' });
    if (state.running) status.textContent = `Enviando… ${state.sent} enviado(s), ${state.pending} na fila.`;
    else if (state.error) { status.textContent = '⚠️ ' + (HELP[state.error] || state.error); status.style.color = 'var(--amb)'; }
    else if (state.last) status.textContent = `✅ Tudo em dia. Última conferência: ${new Date(state.last).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })}${state.sent ? ` · ${state.sent} site(s) enviado(s)` : ''}.`;
    else status.textContent = 'O primeiro envio começa alguns segundos depois de abrir o painel.';
    const bar = el('div', null, { className: 'site-toolbar' });
    const now = el('button', 'Enviar alterados agora', { type: 'button', id: 'siteBackupNow', disabled: state.running });
    const all = el('button', 'Conferir todos', { type: 'button', className: 'sec', id: 'siteBackupAll', disabled: state.running, title: 'Confere todos os sites com o canal e envia só os que estiverem faltando' });
    now.addEventListener('click', () => runBackup({ manual: true }));
    all.addEventListener('click', () => runBackup({ manual: true, recheck: true }));
    bar.append(now, all);
    root.append(status, bar);
    if (state.error === 'permission') {
      const steps = el('ol');
      for (const text of ['No Discord, abra o canal 🗄️・backup-sites → ⚙️ Editar canal → Integrações → Webhooks → Novo webhook.', 'Toque em "Copiar URL do webhook". Não cole no chat.', 'Na Vercel, crie a variável DISCORD_BACKUP_WEBHOOK_URL com esse endereço e faça um Redeploy.']) steps.append(el('li', text));
      root.append(steps);
    }
  };
  state.listeners.add(draw);
  draw();
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  window.promisaSiteBackup = { mount, run: runBackup };
  // Automático: confere alguns segundos depois de abrir e a cada 10 min (só com o painel visível).
  setTimeout(() => { if (!document.hidden) runBackup(); }, FIRST_CHECK_MS);
  setInterval(() => { if (!document.hidden) runBackup(); }, CHECK_EVERY_MS);
}
