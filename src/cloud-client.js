import { uploadRecord } from './cloud-transfer.js';
import { planSync, encodeValue, decodeValue, digest } from './cloud-core.js';

const adapter = window.promisaAdapter;
const collections = ['sales', 'exp', 'projects'];
const defaults = { prospectNotes: '', siteHostingBaseUrl: '', plan: { meta: '', ticket: '', conv: '20', pacotes: '', publico: '', dif: '', obs: '' } };
let busy = false, applying = false, generation = 0, timer, dirty = false, storageReady = false;
let workspace = '', baseline = {}, currentConflicts = [];
let completedOnce = false;
const uploaded = new Map();
const status = document.getElementById('cloud-status');
const syncButton = document.getElementById('cloud-sync');
const conflictButton = document.getElementById('cloud-conflicts');

function message(text, state = '') {
  if (status) { status.textContent = text; status.dataset.state = state; }
}
async function request(action, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  let response, data;
  try {
  response = await fetch('/api/cloud?action=' + action, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store', signal: controller.signal
  });
  data = await response.json();
  } finally { clearTimeout(timer); }
  if (!response.ok) {
    const error = new Error(data.error || 'Não foi possível sincronizar.');
    error.status = response.status; error.code = data.code;
    throw error;
  }
  return data;
}
function saveBaseline() {
  localStorage.setItem('promisa-cloud-baseline:' + workspace, JSON.stringify(baseline));
}
async function capture() {
  const values = {};
  const state = structuredClone(adapter.getState());
  for (const name of collections) for (const item of state[name] || []) {
    if (!item?.id) throw new Error('Há um registro antigo sem identificação. Exporte um backup antes de corrigir esse cadastro.');
    values[name + ':' + encodeURIComponent(item.id)] = item;
  }
  for (const [key, value] of Object.entries(state)) if (!collections.includes(key)) values['settings:' + encodeURIComponent(key)] = value;
  for (const item of await adapter.sites()) values['sites:' + encodeURIComponent(item.id)] = item;
  for (const item of await adapter.attachments()) values['attachments:' + encodeURIComponent(item.id)] = item;
  const entries = {};
  for (const [key, value] of Object.entries(values)) {
    const encoded = await encodeValue(value);
    const text = JSON.stringify({ version: 1, value: encoded });
    const setting = key.startsWith('settings:') ? decodeURIComponent(key.slice(9)) : null;
    entries[key] = { text, hash: await digest(text), isDefault: setting !== null && JSON.stringify(await encodeValue(defaults[setting])) === JSON.stringify(encoded) };
  }
  return entries;
}
async function readRecord(key, expectedHash) {
  const { presignedUrl, hash } = await request('read', { key });
  if (hash !== expectedHash) throw new Error('Os dados online mudaram durante a leitura. Clique em Sincronizar agora.');
  const response = await fetch(presignedUrl, { credentials: 'omit', cache: 'no-store' });
  if (!response.ok) throw new Error('Não foi possível baixar o arquivo online. Tente novamente.');
  const text = await response.text();
  if (await digest(text) !== hash) throw new Error('A verificação do arquivo falhou. O arquivo local foi preservado.');
  const data = JSON.parse(text);
  if (data.version !== 1 || !Object.hasOwn(data, 'value')) throw new Error('Formato de arquivo online incompatível.');
  return decodeValue(data.value);
}
async function applyRecords(changes) {
  if (!changes.size) return;
  const state = structuredClone(adapter.getState());
  const db = await adapter.database();
  applying = true;
  try {
    const tx = db.transaction(['sites', 'project-files'], 'readwrite');
    const complete = new Promise((resolve, reject) => {
      tx.addEventListener('complete', resolve);
      tx.addEventListener('error', () => reject(tx.error));
      tx.addEventListener('abort', () => reject(tx.error || new Error('Não foi possível atualizar a cópia deste aparelho.')));
    });
    for (const [key, value] of changes) {
      const split = key.indexOf(':'), kind = key.slice(0, split), id = decodeURIComponent(key.slice(split + 1));
      if (collections.includes(kind)) {
        state[kind] = (state[kind] || []).filter(item => String(item.id) !== id);
        if (value !== undefined) state[kind].push(value);
      } else if (kind === 'settings') {
        if (value === undefined) delete state[id]; else state[id] = value;
      } else if (kind === 'sites' || kind === 'attachments') {
        const store = tx.objectStore(kind === 'sites' ? 'sites' : 'project-files');
        if (value === undefined) store.delete(id); else store.put(value);
      }
    }
    // Atualiza S antes de aguardar o IndexedDB para não substituir uma edição posterior.
    adapter.setState(state);
    await complete;
    adapter.refresh();
  } finally { applying = false; }
}
function schedule() {
  clearTimeout(timer);
  timer = setTimeout(() => sync(), 1800);
}
function changed() {
  if (applying) return;
  generation++; dirty = true;
  message(storageReady ? 'Alterações neste aparelho. Aguardando envio…' : 'Alterações salvas neste aparelho. Verificando conexão online…', 'pending');
  schedule();
}
async function sync(force = false) {
  if (!adapter || busy) return;
  if (!navigator.onLine) { message('Sem internet. Alterações ficam neste aparelho até a conexão voltar.', 'pending'); return; }
  if (!force && document.activeElement?.matches('input,textarea,select,[contenteditable="true"]')) {
    if (dirty) message('Aguardando você concluir a edição para sincronizar…', 'pending');
    schedule(); return;
  }
  busy = true;
  if (syncButton) syncButton.disabled = true;
  const started = generation;
  try {
    message('Verificando dados online…', 'pending');
    const manifest = await request('manifest');
    storageReady = true;
    if (workspace !== manifest.workspace) {
      workspace = manifest.workspace;
      baseline = JSON.parse(localStorage.getItem('promisa-cloud-baseline:' + workspace) || '{}');
      completedOnce = false;
    }
    if (completedOnce && !dirty && Object.keys(manifest.records).every(key => Object.hasOwn(baseline, key) && baseline[key] === (manifest.records[key]?.hash ?? null)) && Object.keys(baseline).every(key => (baseline[key] ?? null) === (manifest.records[key]?.hash ?? null))) {
      message('Salvo online · ' + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }), 'saved');
      return;
    }
    const local = await capture();
    if (generation !== started) { schedule(); return; }
    const plan = planSync(local, baseline, manifest.records);
    if (plan.conflicts.length) {
      currentConflicts = plan.conflicts;
      if (conflictButton) conflictButton.hidden = false;
      message('Há versões diferentes neste aparelho e online. Resolva as diferenças para continuar.', 'error');
      return;
    }
    currentConflicts = [];
    if (conflictButton) conflictButton.hidden = true;
    const incoming = new Map();
    for (let i = 0; i < plan.downloads.length; i++) {
      const key = plan.downloads[i];
      message(`Baixando dados e arquivos: ${i + 1} de ${plan.downloads.length}…`, 'pending');
      incoming.set(key, manifest.records[key]?.hash ? await readRecord(key, manifest.records[key].hash) : undefined);
    }
    if (generation !== started) { schedule(); return; }
    for (let i = 0; i < plan.operations.length; i++) {
      const operation = plan.operations[i];
      if (!operation.hash) continue;
      const cached = uploaded.get(operation.hash);
      if (cached) { operation.path = cached; continue; }
      const blob = new Blob([local[operation.key].text], { type: 'application/json' });
      if (blob.size > 200 * 1024 * 1024) throw new Error('Este conjunto de arquivos ultrapassa 200 MB no envio online. Seus arquivos locais foram preservados.');
      const path = `promisa/v1/objects/${crypto.randomUUID()}.json`;
      const result = await uploadRecord(path, blob, progress => message(`Enviando ${i + 1} de ${plan.operations.length}: ${Math.round(progress.percentage)}%…`, 'pending'));
      operation.path = result.pathname;
      uploaded.set(operation.hash, operation.path);
    }
    if (plan.operations.length) {
      message('Confirmando salvamento online…', 'pending');
      for (let offset = 0; offset < plan.operations.length; offset += 20) {
        const batch = plan.operations.slice(offset, offset + 20);
        await request('commit', { operations: batch });
        for (const operation of batch) baseline[operation.key] = operation.hash;
        saveBaseline();
      }
    }
    // Se houve digitação durante o upload, conserva a edição e recebe o remoto no próximo ciclo.
    if (generation !== started) { schedule(); return; }
    await applyRecords(incoming);
    for (const key of [...plan.downloads, ...plan.matches]) baseline[key] = manifest.records[key]?.hash ?? null;
    saveBaseline();
    dirty = false;
    completedOnce = true;
    uploaded.clear();
    message('Salvo online · ' + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }), 'saved');
  } catch (error) {
    if (error.status === 401) { message('Sessão encerrada. Entre novamente para sincronizar.', 'error'); location.assign('/acesso.html'); }
    else if (error.code === 'STORAGE_NOT_CONFIGURED') {
      storageReady = false;
      message('Armazenamento online não configurado. Os dados continuam apenas neste aparelho.', 'error');
    } else message((error.message || 'Falha na sincronização.') + ' As alterações locais foram preservadas.', 'error');
  } finally {
    busy = false;
    if (syncButton) syncButton.disabled = false;
  }
}
async function downloadLocalCopy() {
  const entries = await capture();
  const file = { format: 'promisa-cloud-local-copy', version: 1, createdAt: new Date().toISOString(), entries: Object.fromEntries(Object.entries(entries).map(([key, entry]) => [key, JSON.parse(entry.text)])) };
  const url = URL.createObjectURL(new Blob([JSON.stringify(file)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = `promisa-copia-local-${Date.now()}.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
async function resolveConflicts(preference, dialog) {
  if (busy) return;
  busy = true;
  dialog.querySelectorAll('button').forEach(button => { button.disabled = true; });
  try {
    // Conserva os arquivos originais e os dados deste aparelho antes de substituir uma versão.
    await downloadLocalCopy();
    const manifest = await request('manifest');
    const changes = new Map();
    for (const key of currentConflicts) {
      if (preference === 'online') changes.set(key, manifest.records[key]?.hash ? await readRecord(key, manifest.records[key].hash) : undefined);
    }
    if (preference === 'online') await applyRecords(changes);
    for (const key of currentConflicts) baseline[key] = manifest.records[key]?.hash ?? null;
    saveBaseline();
    dialog.close();
    currentConflicts = [];
  } catch (error) { message(error.message, 'error'); }
  finally { busy = false; dialog.querySelectorAll('button').forEach(button => { button.disabled = false; }); schedule(); }
}
function showConflicts() {
  const dialog = document.createElement('dialog'); dialog.className = 'cloud-dialog';
  const title = document.createElement('h2'); title.textContent = 'Qual versão deseja conservar?';
  const text = document.createElement('p'); text.textContent = `${currentConflicts.length} registro(s) foram alterados de formas diferentes. Antes de aplicar sua escolha, será baixada uma cópia dos dados e arquivos deste aparelho.`;
  const list = document.createElement('ul');
  for (const key of currentConflicts) { const item = document.createElement('li'); item.textContent = key; list.append(item); }
  const local = document.createElement('button'); local.textContent = 'Conservar versão deste aparelho'; local.addEventListener('click', () => resolveConflicts('local', dialog));
  const online = document.createElement('button'); online.textContent = 'Carregar versão online'; online.addEventListener('click', () => resolveConflicts('online', dialog));
  const cancel = document.createElement('button'); cancel.textContent = 'Decidir depois'; cancel.addEventListener('click', () => dialog.close());
  dialog.append(title, text, list, local, online, cancel); document.body.append(dialog);
  dialog.addEventListener('close', () => dialog.remove()); dialog.showModal();
}
async function restoreLocalCopy(file) {
  if (!file || busy) return;
  try {
    const backup = JSON.parse(await file.text());
    if (backup.format !== 'promisa-cloud-local-copy' || backup.version !== 1 || !backup.entries || Object.keys(backup.entries).length > 5000) throw new Error('Cópia local inválida.');
    const changes = new Map();
    for (const [key, entry] of Object.entries(backup.entries)) {
      if (!/^(sales|exp|projects|settings|sites|attachments):[A-Za-z0-9%_.~-]{1,180}$/.test(key) || entry?.version !== 1) throw new Error('Cópia local inválida.');
      changes.set(key, decodeValue(entry.value));
    }
    if (!confirm('Restaurar os registros desta cópia no aparelho? Registros com o mesmo identificador serão substituídos.')) return;
    await downloadLocalCopy();
    await applyRecords(changes); changed();
  } catch (error) { message(error.message, 'error'); }
}
window.promisaCloud = { changed, sync, downloadLocalCopy, restoreLocalCopy };
syncButton?.addEventListener('click', () => sync(true));
conflictButton?.addEventListener('click', showConflicts);
document.getElementById('cloud-copy')?.addEventListener('click', () => downloadLocalCopy().catch(error => message(error.message, 'error')));
document.getElementById('cloud-restore')?.addEventListener('change', event => { restoreLocalCopy(event.target.files[0]); event.target.value = ''; });
window.addEventListener('online', () => sync());
window.addEventListener('focus', () => sync());
window.addEventListener('beforeunload', event => { if (dirty || busy) { event.preventDefault(); event.returnValue = ''; } });
setInterval(() => { if (!document.hidden) sync(); }, 20_000);
sync();
