import { validateEntry, validateState } from './data-validation.js';
import { uploadRecord } from './cloud-transfer.js';
import { planSync, persistKeysSafely, encodeValue, decodeValue, digest } from './cloud-core.js';
import { createKeyring, unlockKeyring, rewrapKeyring, seal, open, isEncryptedKey } from './vault.js';
import { saveKeys, loadKeys } from './vault-keys.js';
import { accessFor } from './partner-modules.js';

// Sócio: só sincroniza os dados dos módulos liberados (o servidor também confere). Dono: tudo.
let accessRule = null;
async function loadAccessRule() {
  if (accessRule) return accessRule;
  try {
    const r = await fetch('/api/access?action=session', { credentials: 'same-origin', cache: 'no-store' });
    const d = await r.json();
    if (r.ok) accessRule = d.role === 'partner' ? { partner: true, ...accessFor(d.modules) } : { partner: false, allowKey: () => true };
  } catch { /* tenta de novo na próxima sincronização */ }
  return accessRule || { partner: false, allowKey: () => true };
}
import { buildSiteEntries, canSplit, resolveSiteDownloads, withSitePairs, conflictLabels, batchOperations, siteFilesKey, legacyBaselineHints, deferSitePairs } from './site-split.js';

const adapter = window.promisaAdapter;
const collections = ['sales', 'exp', 'projects', 'bank', 'products'];
const defaults = { prospectNotes: '', siteHostingBaseUrl: '', demoMessage: '', plan: { meta: '', ticket: '', conv: '20', pacotes: '', publico: '', dif: '', obs: '' } };
let paused = false;
let busy = false, applying = false, generation = 0, timer, dirty = false, storageReady = false;
let workspace = '', baseline = {}, baselinePlain = {}, currentConflicts = [];
let keysNotSaved = false;
const downloadedPlain = new Map();
let completedOnce = false;
const uploaded = new Map();
// Cofre: keyring = chave embrulhada guardada online; keys = chaves deste aparelho (null = travado).
let keyring = null, keyringLoaded = false, keys = null;
const sealed = new Map();
const filesMemo = new Map(), legacyMemo = new Map();
const VAULT_ENABLE_UI = false;
const encryptButton = document.getElementById('cloud-encrypt');
const unlockButton = document.getElementById('cloud-unlock');
const status = document.getElementById('cloud-status');
const syncButton = document.getElementById('cloud-sync');
const conflictButton = document.getElementById('cloud-conflicts');

function message(text, state = '') {
  if (status) { status.textContent = text; status.dataset.state = state; }
}
async function request(action, body) {
  if (paused) throw new Error('Sincronização pausada durante a saída.');
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
const savedMessage = () => 'Salvo online · ' + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) + (keys ? ' · 🔒 protegido' : '') + (keys && keysNotSaved ? ' · aviso: a chave não foi guardada neste aparelho; digite a senha de novo ao reabrir' : '');
function vaultButtons() {
  // Ativação liberada só depois das correções de migração (revisão: H1/H2).
  if (encryptButton) encryptButton.hidden = !(VAULT_ENABLE_UI && storageReady && keyringLoaded && !keyring);
  if (unlockButton) unlockButton.hidden = !(keyringLoaded && keyring && !keys);
}
async function loadVault(reload = false) {
  if (keyringLoaded && !reload) return;
  const result = await request('vault');
  keyring = result.keyring || null;
  keys = null;
  if (keyring) {
    try { const stored = await loadKeys(); if (stored?.id === keyring.id) keys = stored; } catch { /* sem chaves guardadas: fica travado */ }
  }
  keyringLoaded = true;
  vaultButtons();
}
function saveBaseline() {
  localStorage.setItem('promisa-cloud-baseline:' + workspace, JSON.stringify(baseline));
  localStorage.setItem('promisa-cloud-baselineplain:' + workspace, JSON.stringify(baselinePlain));
}
function showLocked() {
  currentConflicts = [];
  if (conflictButton) conflictButton.hidden = true;
  vaultButtons();
  message('Seus dados online estão protegidos. Toque em "Destravar" e digite a senha do painel.', 'error');
}
// full = cópia local: sites inteiros, como ficam no aparelho. Sem full, cada site vira dois registros online.
async function capture({ plain = false, full = false } = {}) {
  const values = {};
  const state = structuredClone(adapter.getState());
  for (const name of collections) for (const item of state[name] || []) {
    if (!item?.id) throw new Error('Há um registro antigo sem identificação. Exporte um backup antes de corrigir esse cadastro.');
    values[name + ':' + encodeURIComponent(item.id)] = item;
  }
  for (const [key, value] of Object.entries(state)) if (!collections.includes(key)) values['settings:' + encodeURIComponent(key)] = value;
  const splitEntries = {}, seenSites = new Set();
  for (const item of await adapter.sites()) {
    if (full || !canSplit(item)) { values['sites:' + encodeURIComponent(item.id)] = item; continue; }
    const pair = await buildSiteEntries(item, filesMemo);
    splitEntries[pair.files.key] = pair.files; splitEntries[pair.meta.key] = pair.meta; seenSites.add(String(item.id));
  }
  for (const id of [...filesMemo.keys()]) if (!seenSites.has(id)) filesMemo.delete(id);
  for (const item of await adapter.attachments()) values['attachments:' + encodeURIComponent(item.id)] = item;
  const entries = { ...splitEntries };
  for (const [key, value] of Object.entries(values)) {
    const encoded = await encodeValue(value);
    const text = JSON.stringify({ version: 1, value: encoded });
    const plainHash = await digest(text);
    const setting = key.startsWith('settings:') ? decodeURIComponent(key.slice(9)) : null;
    const isDefault = setting !== null && JSON.stringify(await encodeValue(defaults[setting])) === JSON.stringify(encoded);
    if (!plain && keys && isEncryptedKey(key)) {
      // A cifragem é determinística: o mesmo conteúdo sempre gera o mesmo texto e o mesmo hash.
      // Guarda só os hashes; o texto cifrado é refeito apenas se o registro for enviado.
      const current = keys, memo = sealed.get(key);
      let hash = memo?.keysId === current.id && memo.plainHash === plainHash ? memo.hash : null;
      if (!hash) { hash = await digest(await seal(current, key, text)); sealed.set(key, { keysId: current.id, plainHash, hash }); }
      entries[key] = { text, hash, plainHash, isDefault, seal: () => seal(current, key, text) };
    } else entries[key] = { text, hash: plainHash, plainHash, isDefault };
  }
  const rule = await loadAccessRule();
  if (rule.partner) for (const key of Object.keys(entries)) if (!rule.allowKey(key)) delete entries[key];
  return entries;
}
async function readRecord(key, expectedHash) {
  const { presignedUrl, hash } = await request('read', { key });
  if (hash !== expectedHash) throw new Error('Os dados online mudaram durante a leitura. Clique em Sincronizar agora.');
  const response = await fetch(presignedUrl, { credentials: 'omit', cache: 'no-store' });
  if (!response.ok) throw new Error('Não foi possível baixar o arquivo online. Tente novamente.');
  const text = await response.text();
  if (await digest(text) !== hash) throw new Error('A verificação do arquivo falhou. O arquivo local foi preservado.');
  let data = JSON.parse(text);
  if (data.version === 2) {
    if (!keys && isEncryptedKey(key)) await loadVault(true);
    if (!keys || !isEncryptedKey(key)) {
      const locked = new Error('Os dados online estão protegidos. Toque em "Destravar dados" e digite a senha do painel.');
      if (keyring && !keys) locked.code = 'LOCKED';
      throw locked;
    }
    const inner = await open(keys, key, text);
    downloadedPlain.set(key, await digest(inner));
    data = JSON.parse(inner);
  } else downloadedPlain.set(key, hash);
  if (data.version !== 1 || !Object.hasOwn(data, 'value')) throw new Error('Formato de arquivo online incompatível.');
  return validateEntry(key, decodeValue(data.value));
}
// Junta dados e arquivos baixados (novo formato) em sites completos; registros antigos completos seguem funcionando.
async function resolveIncoming(incoming, records, local) {
  return resolveSiteDownloads(incoming, records,
    id => { const entry = local[siteFilesKey(id)]; return entry?.site ? { site: entry.site, filesHash: entry.hash } : null; },
    (key, hash) => readRecord(key, hash));
}
async function applyRecords(changes) {
  if (!changes.size) return;
  for (const [key, value] of changes) changes.set(key, validateEntry(key, value));
  const previous = structuredClone(adapter.getState());
  const state = structuredClone(previous);
  const db = await adapter.database();
  let tx, complete, persisted = false;
  const container = document.getElementById('app') || document.getElementById('catalog-grid');
  if (container) container.inert = true;
  applying = true;
  try {
    tx = db.transaction(['sites', 'project-files'], 'readwrite');
    complete = new Promise((resolve, reject) => {
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
    validateState(state);
    adapter.setState(state); persisted = true;
    await complete;
    adapter.refresh();
  } catch (error) {
    try { tx?.abort(); } catch {}
    await complete?.catch(() => {});
    if (persisted) adapter.setState(previous);
    throw error;
  } finally { applying = false; if (container) container.inert = false; }
}
function schedule() {
  clearTimeout(timer);
  timer = setTimeout(() => sync(), 6000); // junta várias edições num envio só (economiza operações)
}
function changed() {
  if (applying) return;
  generation++; dirty = true;
  message(storageReady ? 'Alterações neste aparelho. Aguardando envio…' : 'Alterações salvas neste aparelho. Verificando conexão online…', 'pending');
  schedule();
}
async function sync(force = false) {
  if (!adapter || busy || paused) return;
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
    await loadAccessRule();
    const manifest = await request('manifest');
    storageReady = true;
    if (workspace !== manifest.workspace) {
      workspace = manifest.workspace;
      baseline = JSON.parse(localStorage.getItem('promisa-cloud-baseline:' + workspace) || '{}');
      try { baselinePlain = JSON.parse(localStorage.getItem('promisa-cloud-baselineplain:' + workspace) || '{}'); } catch { baselinePlain = {}; }
      completedOnce = false;
    }
    await loadVault();
    if (keyring && !keys) {
      showLocked();
      return;
    }
    vaultButtons();
    if (completedOnce && !dirty && Object.keys(manifest.records).every(key => Object.hasOwn(baseline, key) && baseline[key] === (manifest.records[key]?.hash ?? null)) && Object.keys(baseline).every(key => (baseline[key] ?? null) === (manifest.records[key]?.hash ?? null))) {
      message(savedMessage(), 'saved');
      return;
    }
    const local = await capture();
    if (generation !== started) { schedule(); return; }
    const hints = await legacyBaselineHints(local, baseline, baselinePlain, manifest.records, legacyMemo);
    if (generation !== started) { schedule(); return; }
    const plan = deferSitePairs(planSync(local, hints.baseline, manifest.records, hints.baselinePlain));
    if (plan.conflicts.length) {
      currentConflicts = withSitePairs(plan.conflicts);
      if (conflictButton) conflictButton.hidden = false;
      message('Há versões diferentes neste aparelho e online. Resolva as diferenças para continuar.', 'error');
      return;
    }
    // Outro aparelho pode ter ativado a proteção desde o início desta página: nunca envia texto legível nesse caso.
    // O mesmo vale para downloads: uma página aberta antes da ativação não tem a chave.
    if (!keyring && (plan.operations.length || plan.downloads.length)) {
      await loadVault(true);
      if (keyring) { completedOnce = false; if (keys) schedule(); else showLocked(); return; }
    }
    currentConflicts = [];
    if (conflictButton) conflictButton.hidden = true;
    const incoming = new Map();
    for (let i = 0; i < plan.downloads.length; i++) {
      const key = plan.downloads[i];
      message(`Baixando dados e arquivos: ${i + 1} de ${plan.downloads.length}…`, 'pending');
      incoming.set(key, manifest.records[key]?.hash ? await readRecord(key, manifest.records[key].hash) : undefined);
    }
    const resolved = await resolveIncoming(incoming, manifest.records, local);
    if (generation !== started) { schedule(); return; }
    for (let i = 0; i < plan.operations.length; i++) {
      const operation = plan.operations[i];
      if (!operation.hash) continue;
      const cached = uploaded.get(operation.hash);
      if (cached) { operation.path = cached; continue; }
      const entry = local[operation.key];
      const blob = new Blob([entry.seal ? await entry.seal() : entry.load ? await entry.load() : entry.text], { type: 'application/json' });
      if (blob.size > 200 * 1024 * 1024) throw new Error('Este conjunto de arquivos ultrapassa 200 MB no envio online. Seus arquivos locais foram preservados.');
      const path = `promisa/v1/objects/${crypto.randomUUID()}.json`;
      const result = await uploadRecord(path, blob, progress => message(`Enviando ${i + 1} de ${plan.operations.length}: ${Math.round(progress.percentage)}%…`, 'pending'));
      operation.path = result.pathname;
      uploaded.set(operation.hash, operation.path);
    }
    if (paused) return;
    if (plan.operations.length) {
      message('Confirmando salvamento online…', 'pending');
      for (const batch of batchOperations(plan.operations)) {
        await request('commit', { operations: batch });
        for (const operation of batch) { baseline[operation.key] = operation.hash; baselinePlain[operation.key] = local[operation.key]?.plainHash ?? null; }
        saveBaseline();
      }
    }
    // Se houve digitação durante o upload, conserva a edição e recebe o remoto no próximo ciclo.
    if (generation !== started) { schedule(); return; }
    await applyRecords(resolved);
    for (const key of [...plan.downloads, ...plan.matches]) {
      baseline[key] = manifest.records[key]?.hash ?? null;
      const plain = plan.downloads.includes(key) ? downloadedPlain.get(key) : local[key]?.plainHash;
      if (plain) baselinePlain[key] = plain; else delete baselinePlain[key];
    }
    downloadedPlain.clear();
    saveBaseline();
    completedOnce = true;
    uploaded.clear();
    // Registro de site adiado (o irmão acabou de ser baixado): envia no próximo ciclo.
    if (plan.deferred) { dirty = true; schedule(); return; }
    dirty = false;
    message(savedMessage(), 'saved');
  } catch (error) {
    if (error.code === 'LOCKED') showLocked();
    else if (error.status === 401) { message('Sessão encerrada. Entre novamente para sincronizar.', 'error'); location.assign('/acesso.html'); }
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
  const entries = await capture({ plain: true, full: true });
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
    if (preference === 'online') await applyRecords(await resolveIncoming(changes, manifest.records, {}));
    for (const key of currentConflicts) {
      baseline[key] = manifest.records[key]?.hash ?? null;
      const plain = preference === 'online' ? downloadedPlain.get(key) : null;
      if (plain) baselinePlain[key] = plain; else delete baselinePlain[key];
    }
    downloadedPlain.clear();
    saveBaseline();
    dialog.close();
    currentConflicts = [];
  } catch (error) { message(error.message, 'error'); }
  finally { busy = false; dialog.querySelectorAll('button').forEach(button => { button.disabled = false; }); schedule(); }
}
function showConflicts() {
  const dialog = document.createElement('dialog'); dialog.className = 'cloud-dialog';
  const title = document.createElement('h2'); title.textContent = 'Qual versão deseja conservar?';
  const text = document.createElement('p'); text.textContent = `${conflictLabels(currentConflicts).length} registro(s) foram alterados de formas diferentes. Antes de aplicar sua escolha, será baixada uma cópia dos dados e arquivos deste aparelho.`;
  const list = document.createElement('ul');
  for (const label of conflictLabels(currentConflicts)) { const item = document.createElement('li'); item.textContent = label; list.append(item); }
  const local = document.createElement('button'); local.textContent = 'Conservar versão deste aparelho'; local.addEventListener('click', () => resolveConflicts('local', dialog));
  const online = document.createElement('button'); online.textContent = 'Carregar versão online'; online.addEventListener('click', () => resolveConflicts('online', dialog));
  const cancel = document.createElement('button'); cancel.textContent = 'Decidir depois'; cancel.addEventListener('click', () => dialog.close());
  dialog.append(title, text, list, local, online, cancel); document.body.append(dialog);
  dialog.addEventListener('close', () => dialog.remove()); dialog.showModal();
}
async function restoreLocalCopy(file) {
  if (!file || busy) return;
  try {
    if (file.size > 256 * 1024 * 1024) throw new Error('A cópia ultrapassa 256 MB.');
    const backup = JSON.parse(await file.text());
    if (backup.format !== 'promisa-cloud-local-copy' || backup.version !== 1 || !backup.entries || Object.keys(backup.entries).length > 5000) throw new Error('Cópia local inválida.');
    const changes = new Map();
    for (const [key, entry] of Object.entries(backup.entries)) {
      if (!/^(sales|exp|projects|bank|products|settings|sites|attachments):[A-Za-z0-9%_.~-]{1,180}$/.test(key) || entry?.version !== 1) throw new Error('Cópia local inválida.');
      changes.set(key, validateEntry(key, decodeValue(entry.value)));
    }
    if (!confirm('Restaurar os registros desta cópia no aparelho? Registros com o mesmo identificador serão substituídos.')) return;
    await downloadLocalCopy();
    await applyRecords(changes); changed();
  } catch (error) { message(error.message, 'error'); }
}
// Caixa de diálogo simples com campos de senha. `run` recebe os valores e pode lançar um erro para exibi-lo.
function passwordDialog({ title, paragraphs, fields, confirm, cancel = 'Cancelar', run }) {
  const dialog = document.createElement('dialog'); dialog.className = 'cloud-dialog';
  const form = document.createElement('form'); form.method = 'dialog';
  const heading = document.createElement('h2'); heading.textContent = title;
  form.append(heading);
  for (const text of paragraphs) { const p = document.createElement('p'); p.textContent = text; form.append(p); }
  const inputs = {}, wrappers = {};
  for (const field of fields) {
    const label = document.createElement('label'); label.textContent = field.label; label.style.display = 'block';
    const input = document.createElement('input'); input.type = 'password'; input.name = field.name; input.autocomplete = field.autocomplete || 'current-password'; input.maxLength = 256; input.required = true; input.style.cssText = 'display:block;width:100%;margin:6px 0 12px';
    label.append(input); label.hidden = Boolean(field.hidden); input.disabled = Boolean(field.hidden);
    inputs[field.name] = input; wrappers[field.name] = label; form.append(label);
  }
  const error = document.createElement('p'); error.setAttribute('role', 'alert'); error.style.color = '#ffb4b4';
  const progress = document.createElement('p'); progress.setAttribute('role', 'status');
  const ok = document.createElement('button'); ok.type = 'submit'; ok.textContent = confirm;
  const no = document.createElement('button'); no.type = 'button'; no.textContent = cancel;
  form.append(error, progress, ok, no); dialog.append(form); document.body.append(dialog);
  let working = false;
  const ui = {
    progress: text => { progress.textContent = text; },
    showField: name => { wrappers[name].hidden = false; inputs[name].disabled = false; inputs[name].focus(); },
    close: () => dialog.close()
  };
  no.addEventListener('click', () => { if (!working) dialog.close(); });
  dialog.addEventListener('cancel', event => { if (working) event.preventDefault(); });
  dialog.addEventListener('close', () => dialog.remove());
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (working) return;
    working = true; error.textContent = ''; ok.disabled = true; no.disabled = true;
    const values = Object.fromEntries(Object.entries(inputs).map(([name, input]) => [name, input.disabled ? '' : input.value]));
    try { await run(values, ui); progress.textContent = ''; dialog.close(); }
    catch (cause) { error.textContent = cause.message || 'Não foi possível concluir.'; progress.textContent = ''; }
    finally { working = false; ok.disabled = false; no.disabled = false; }
  });
  dialog.showModal(); Object.values(inputs)[0]?.focus();
}
// Mantém o sincronizador parado enquanto a chave é criada ou trocada.
async function withVaultLock(task) {
  if (busy) throw new Error('Aguarde a sincronização terminar e tente de novo.');
  busy = true;
  if (syncButton) syncButton.disabled = true;
  try { return await task(); }
  finally { busy = false; if (syncButton) syncButton.disabled = false; }
}
function activateKeys(next, nextKeyring) {
  keyring = nextKeyring; keys = next; keyringLoaded = true; sealed.clear(); uploaded.clear();
  // Força nova comparação: os hashes mudam quando a proteção é ativada ou destravada.
  completedOnce = false; vaultButtons();
}
function showEncrypt() {
  passwordDialog({
    title: 'Proteger os dados online com senha',
    paragraphs: [
      'Vamos embaralhar os dados que ficam online, para que só quem sabe a senha do painel consiga lê-los. Serão protegidos: leads, despesas, projetos, anotações e anexos. Os sites dos clientes não são protegidos, por causa dos links de demonstração.',
      'Atenção: se você esquecer a senha do painel, os dados online protegidos não poderão ser recuperados. A cópia deste aparelho continua normal.',
      'As versões antigas sem criptografia são apagadas do armazenamento em até 7 dias.',
      'Antes de ativar, será baixada uma cópia de segurança. Digite a senha do painel para continuar.'
    ],
    fields: [{ name: 'password', label: 'Senha do painel', autocomplete: 'current-password' }],
    confirm: 'Baixar cópia e ativar',
    run: async ({ password }, ui) => {
      let conflict = false;
      await withVaultLock(async () => {
        ui.progress('Baixando a cópia de segurança…');
        await downloadLocalCopy();
        ui.progress('Conferindo a senha…');
        await request('vault-verify', { password });
        ui.progress('Criando a proteção…');
        const created = await createKeyring(password);
        try { await request('vault-create', { password, keyring: created.keyring }); }
        catch (error) { if (error.status === 409) { conflict = true; return; } throw error; }
        keysNotSaved = !(await persistKeysSafely(saveKeys, created.keys));
        activateKeys(created.keys, created.keyring);
        if (keysNotSaved) message('Proteção ativada, mas a chave não pôde ser guardada neste aparelho. Ela vale só enquanto esta página estiver aberta.', 'error');
      });
      if (conflict) {
        await loadVault(true);
        throw new Error('A proteção já foi ativada em outro aparelho. Use "Destravar dados" e digite a senha do painel.');
      }
      ui.progress('Protegendo os dados online…');
      message('Protegendo os dados online…', 'pending');
      sync(true);
    }
  });
}
function showUnlock() {
  passwordDialog({
    title: 'Destravar os dados online',
    paragraphs: ['Digite a senha do painel para ler os dados protegidos neste aparelho.'],
    fields: [
      { name: 'password', label: 'Senha do painel', autocomplete: 'current-password' },
      { name: 'old', label: 'Senha antiga do painel', autocomplete: 'off', hidden: true }
    ],
    confirm: 'Destravar',
    run: async ({ password, old }, ui) => {
      await withVaultLock(async () => {
        await request('vault-verify', { password });
        let unlocked;
        try { unlocked = { keys: await unlockKeyring(keyring, password), keyring }; }
        catch (error) {
          if (error.code !== 'WRONG_KEY') throw error;
          // O servidor aceitou a senha, mas ela não abre a chave: a senha do painel foi trocada.
          if (!old) { ui.showField('old'); throw new Error('A senha do painel foi trocada. Digite também a senha antiga do painel, uma única vez.'); }
          try { await unlockKeyring(keyring, old); } catch (cause) { throw cause.code === 'WRONG_KEY' ? new Error('A senha antiga não está correta.') : cause; }
          const next = await rewrapKeyring(keyring, old, password);
          try { await request('vault-replace', { password, previous: keyring, keyring: next.keyring }); }
          catch (cause) { if (cause.status === 409) await loadVault(true).catch(() => {}); throw cause; }
          unlocked = { keys: next.keys, keyring: next.keyring };
        }
        keysNotSaved = !(await persistKeysSafely(saveKeys, unlocked.keys));
        activateKeys(unlocked.keys, unlocked.keyring);
      });
      message('Dados desbloqueados. Sincronizando…', 'pending');
      sync(true);
    }
  });
}
window.promisaCloud = { changed, sync, downloadLocalCopy, restoreLocalCopy, hasPending: () => dirty || busy, pause() { paused = true; clearTimeout(timer); generation++; }, resume() { paused = false; schedule(); } };
syncButton?.addEventListener('click', () => sync(true));
conflictButton?.addEventListener('click', showConflicts);
encryptButton?.addEventListener('click', showEncrypt);
unlockButton?.addEventListener('click', showUnlock);
document.getElementById('cloud-copy')?.addEventListener('click', () => downloadLocalCopy().catch(error => message(error.message, 'error')));
document.getElementById('cloud-restore')?.addEventListener('change', event => { restoreLocalCopy(event.target.files[0]); event.target.value = ''; });
window.addEventListener('online', () => sync());
let lastFocusSync = 0;
window.addEventListener('focus', () => { if (Date.now() - lastFocusSync < 120_000) return; lastFocusSync = Date.now(); sync(); });
// Ao sair da aba/fechar com alterações pendentes, envia na hora (não espera o agrupamento).
document.addEventListener('visibilitychange', () => { if (document.hidden && dirty) { clearTimeout(timer); sync(true); } });
window.addEventListener('beforeunload', event => { if (dirty || busy) { event.preventDefault(); event.returnValue = ''; } });
// Economia da cota do Blob (plano grátis: 10 mil leituras/mês): confere a nuvem a cada 5 min e para depois de 5 min sem uso;
// volta a conferir assim que a pessoa mexe no painel. Alterações locais são enviadas na hora.
const IDLE_MS = 5 * 60_000;
let lastActivity = Date.now(), idle = false;
const wake = () => { lastActivity = Date.now(); if (idle) { idle = false; sync(); } };
['pointerdown', 'keydown', 'touchstart', 'wheel'].forEach(type => window.addEventListener(type, wake, { passive: true }));
document.addEventListener('visibilitychange', () => { if (!document.hidden) wake(); });
setInterval(() => {
  if (document.hidden) return;
  if (!dirty && Date.now() - lastActivity > IDLE_MS) { idle = true; return; }
  sync();
}, 300_000);
sync();
