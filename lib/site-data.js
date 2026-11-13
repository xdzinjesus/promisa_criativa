import * as blob from '@vercel/blob';
import { detectAdmin } from './site-admin-detect.js';
import { randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto';
import { isBlobError, readWithEtag } from './blob-utils.js';

// "Dados ao vivo" para sites feitos à mão que têm área administrativa própria (que guarda no localStorage).
// O cliente abre o site com #promisa-admin, usa a área administrativa do site e toca em "Publicar para todos":
// as chaves do localStorage alteradas vão para o servidor (com a senha do site), ficam no Blob privado e o site
// é publicado de novo na Cloudflare com os dados embutidos no HTML. Visitantes recebem os dados junto com a página:
// nenhuma leitura extra na Vercel. Blob: promisa/site-data/v1/<siteId>.json (senha com scrypt + sal).
export const PREFIX = 'promisa/site-data/v1/';
export const MAX_DATA_BYTES = 3_000_000, MAX_KEYS = 500, MAX_SAVES_PER_DAY = 40, MAX_FAILS = 5, LOCK_MS = 15 * 60 * 1000;
const MAX_RECORD_BYTES = 4 * 1024 * 1024;
export const validSiteId = id => typeof id === 'string' && /^[\w:.-]{1,100}$/.test(id);
const pathFor = siteId => PREFIX + encodeURIComponent(siteId).replace(/%/g, '_') + '.json';
const conflict = error => isBlobError(error, 'BlobPreconditionFailedError') || /already exists|precondition/i.test(error?.message || '');
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const newPassword = () => Array.from({ length: 8 }, (_, i) => (i === 4 ? '-' : '') + ALPHABET[randomInt(ALPHABET.length)]).join('');
export const hashPassword = (password, salt) => scryptSync(String(password).trim().toUpperCase(), Buffer.from(salt, 'hex'), 32).toString('hex');
export const samePassword = (password, salt, hash) => { const a = Buffer.from(hashPassword(password, salt), 'hex'), b = Buffer.from(String(hash || ''), 'hex'); return a.length === b.length && a.length > 0 && timingSafeEqual(a, b); };

// Valida as alterações vindas do navegador: { chave: texto | null (apagar) }.
export function cleanChanges(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out = {};
  for (const [key, value] of Object.entries(raw).slice(0, MAX_KEYS)) {
    if (typeof key !== 'string' || !key || key.length > 200 || /^promisa_/i.test(key)) continue;
    if (value === null) out[key] = null;
    else if (typeof value === 'string') out[key] = value;
  }
  return out;
}
export function mergeKeys(current, changes) {
  const next = { ...(current || {}) };
  for (const [key, value] of Object.entries(changes)) { if (value === null) delete next[key]; else next[key] = value; }
  return next;
}
// Blocos de dados embutidos no HTML pelo próprio site: <script type="application/json" id="..."> (ex.: id="dados").
// Sites que "salvam" gerando um index.html novo para baixar: o script captura esse arquivo e manda só esses blocos.
export function cleanEmbedded(raw) {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out = {};
  for (const [id, text] of Object.entries(raw).slice(0, 5)) {
    if (!/^[\w-]{1,60}$/.test(id) || typeof text !== 'string') return null;
    try { out[id] = JSON.stringify(JSON.parse(text)); } catch { return null; }
  }
  return out;
}
export const dataSize = (keys, embedded) => Buffer.byteLength(JSON.stringify(keys || {})) + Buffer.byteLength(JSON.stringify(embedded || {}));

// ---- armazenamento (gravação com trava de versão) ----
export function createSiteDataStore({ get = blob.get, head = blob.head, put = blob.put, token = () => process.env.BLOB_READ_WRITE_TOKEN, memory = () => !token() && !process.env.VERCEL } = {}) {
  const options = () => ({ token: token() });
  const mem = new Map();
  return {
    async get(siteId) {
      if (!validSiteId(siteId)) return null;
      const path = pathFor(siteId);
      if (memory()) return mem.has(path) ? structuredClone(mem.get(path)) : null;
      if (!token()) return null;
      let result;
      try { result = await get(path, { ...options(), access: 'private', useCache: false }); }
      catch (error) { if (isBlobError(error, 'BlobNotFoundError')) return null; throw error; }
      if (!result?.stream || result.blob?.size > MAX_RECORD_BYTES) return null;
      return new Response(result.stream).json().catch(() => null);
    },
    async update(siteId, change) {
      if (!validSiteId(siteId)) throw new Error('site inválido');
      const path = pathFor(siteId);
      if (memory()) { const current = mem.has(path) ? structuredClone(mem.get(path)) : null; const next = change(current); if (!next) return { record: current, changed: false }; mem.set(path, structuredClone(next)); return { record: structuredClone(next), changed: true }; }
      if (!token()) throw Object.assign(new Error('Armazenamento online não configurado.'), { status: 503 });
      for (let attempt = 0; attempt < 6; attempt++) {
        let read;
        try { read = await readWithEtag(path, options(), { get, head }); }
        catch (error) { if (/mudou durante a leitura/.test(error?.message || '')) continue; throw error; }
        const current = read ? await new Response(read.result.stream).json().catch(() => null) : null;
        const next = change(current ? structuredClone(current) : null);
        if (!next) return { record: current, changed: false };
        try {
          await put(path, JSON.stringify(next), { ...options(), access: 'private', contentType: 'application/json', addRandomSuffix: false, ...(read ? { allowOverwrite: true, ifMatch: read.etag } : { allowOverwrite: false }), cacheControlMaxAge: 0 });
          return { record: next, changed: true };
        } catch (error) { if (!conflict(error)) throw error; }
      }
      throw Object.assign(new Error('Muitos pedidos ao mesmo tempo.'), { code: 'busy' });
    }
  };
}

// ---- injeção no site publicado ----
// Roda antes de qualquer script do site: coloca os dados publicados no localStorage. Com #promisa-admin, liga o
// modo edição: grava o que a área administrativa do site mudar e mostra a barra "Publicar para todos".
export const SHIM = String.raw`(function(){
var D=window.__PROMISA_DADOS__||{},K=D.keys||{},C=D.cfg||{},ss=window.sessionStorage,ls=window.localStorage;
var A=C.admin||'#admin';function match(){return /#promisa-admin\b|[?&]promisa-admin\b/.test(location.href)||(A.charAt(0)==='#'?location.hash.indexOf(A)===0:location.pathname===A)}
var admin=match();try{if(admin)ss.setItem('promisa_admin','1');admin=admin||ss.getItem('promisa_admin')==='1'}catch(e){}
var pend={},emb={};try{pend=JSON.parse(ss.getItem('promisa_pend')||'{}')||{}}catch(e){}
try{for(var k in K){if(admin&&Object.prototype.hasOwnProperty.call(pend,k))continue;ls.setItem(k,K[k])}}catch(e){}
var started=false;if(admin)on();else window.addEventListener('hashchange',function(){if(match())on()});
function on(){if(started)return;started=true;try{ss.setItem('promisa_admin','1')}catch(e){}
var P=Storage.prototype,set=P.setItem,rem=P.removeItem,clr=P.clear,bar,txt,btn,busy=false,caught={},quiet=0;
function save(){try{ss.setItem('promisa_pend',JSON.stringify(pend))}catch(e){}draw()}
P.setItem=function(k,v){set.apply(this,arguments);if(this===ls&&!/^promisa_/i.test(k)){pend[k]=String(v);save()}};
P.removeItem=function(k){rem.apply(this,arguments);if(this===ls&&!/^promisa_/i.test(k)){pend[k]=null;save()}};
P.clear=function(){if(this===ls){for(var i=0;i<ls.length;i++){var x=ls.key(i);if(!/^promisa_/i.test(x))pend[x]=null}save()}clr.apply(this,arguments)};
// Sites que "salvam" gerando um index.html novo para baixar: pega os blocos de dados e publica em vez de baixar.
var mk=URL.createObjectURL,click=HTMLAnchorElement.prototype.click,al=window.alert;
URL.createObjectURL=function(o){var u=mk.apply(this,arguments);try{if(o&&/text\/html/i.test(o.type||'')){caught[u]=1;quiet=Date.now();o.text().then(function(h){var doc=new DOMParser().parseFromString(h,'text/html'),list=doc.querySelectorAll('script[type="application/json"][id]'),n=0;for(var i=0;i<list.length;i++){emb[list[i].id]=list[i].textContent;n++}if(n){draw();publish()}})}}catch(e){}return u};
HTMLAnchorElement.prototype.click=function(){if(this.download&&caught[this.href])return;return click.apply(this,arguments)};
window.alert=function(m){if(Date.now()-quiet<4000&&/index\.html|hospedagem/i.test(String(m)))return;return al.apply(window,arguments)};
function n(){return Object.keys(pend).length+Object.keys(emb).length}
function draw(){if(!bar||busy)return;var c=n();txt.textContent=c?'✏️ Modo edição · '+c+' alteração(ões) ainda não publicadas':'✏️ Modo edição · use a área administrativa do site; ao salvar, publicamos para todos';btn.disabled=!c;btn.style.opacity=c?'1':'.5'}
function publish(){if(busy||!n())return;var pw='';try{pw=ss.getItem('promisa_pw')||''}catch(e){}if(!pw)pw=(prompt('Senha de publicação deste site (enviada pela Promisa):')||'').trim();if(!pw){draw();return}
busy=true;btn.disabled=true;btn.textContent='Publicando… (até 1 minuto)';txt.textContent='⏳ Publicando para todos…';
fetch(C.api,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'site-data-save',siteId:C.site,password:pw,changes:pend,embedded:emb})}).then(function(r){return r.json().then(function(b){return{ok:r.ok,b:b}})}).then(function(x){busy=false;btn.textContent='🚀 Publicar para todos';
if(x.ok){try{ss.setItem('promisa_pw',pw);ss.removeItem('promisa_pend')}catch(e){}pend={};emb={};txt.textContent='✅ Publicado! Em até 1 minuto aparece para todos.';btn.disabled=true;btn.style.opacity='.5'}
else{if(x.b&&x.b.code==='password'){try{ss.removeItem('promisa_pw')}catch(e){}}al.call(window,(x.b&&x.b.error)||'Não foi possível publicar agora.');draw()}
}).catch(function(){busy=false;btn.textContent='🚀 Publicar para todos';al.call(window,'Sem conexão. Tente de novo.');draw()})}
function ui(){bar=document.createElement('div');bar.setAttribute('role','status');bar.style.cssText='position:fixed;left:12px;right:12px;bottom:12px;z-index:2147483647;display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding:12px 14px;border-radius:14px;background:#0b1430;color:#e8eefc;font:600 14px system-ui,sans-serif;box-shadow:0 18px 50px rgba(0,0,0,.45);border:1px solid #2b4185';
txt=document.createElement('span');txt.style.cssText='flex:1;min-width:200px';
btn=document.createElement('button');btn.type='button';btn.textContent='🚀 Publicar para todos';btn.style.cssText='border:0;border-radius:10px;padding:10px 14px;background:#2563eb;color:#fff;font:700 14px system-ui,sans-serif;cursor:pointer';
var out=document.createElement('button');out.type='button';out.textContent='Sair';out.style.cssText='border:1px solid #2b4185;border-radius:10px;padding:10px 12px;background:transparent;color:#c6d4f5;font:600 13px system-ui,sans-serif;cursor:pointer';
out.onclick=function(){if(n()&&!confirm('Sair do modo edição? As alterações não publicadas ficam só neste aparelho.'))return;try{ss.removeItem('promisa_admin')}catch(e){}location.hash='';location.reload()};
btn.onclick=publish;bar.append(txt,btn,out);document.body.appendChild(bar);draw()}
if(document.body)ui();else document.addEventListener('DOMContentLoaded',ui);
}
})();`;

const LS = new RegExp('\\u2028', 'g'), PS = new RegExp('\\u2029', 'g');
const inlineJson = value => JSON.stringify(value).replace(/</g, '\\u003c').replace(LS, '\\u2028').replace(PS, '\\u2029');
const isHtml = path => /\.html?$/i.test(path || '');
const textOf = data => typeof data === 'string' && !data.startsWith('data:') ? data : null;

// Devolve uma cópia do site com o script e os dados nas páginas HTML (sem mexer no resto).
export function injectSiteData(site, { siteId, keys = {}, embedded = {}, api }) {
  if (!site || !Array.isArray(site.files)) return site;
  const admin = detectAdmin(site.files.map(file => ({ path: file?.path, data: textOf(file?.data) ?? '' }))).entry || '#admin';
  const slash = String(site.htmlPath || '').lastIndexOf('/');
  const root = slash === -1 ? '' : site.htmlPath.slice(0, slash + 1);
  const scriptPath = root + 'promisa-dados.js';
  const tag = `<script>window.__PROMISA_DADOS__=${inlineJson({ keys, cfg: { site: siteId, api, admin } })};</script><script src="/promisa-dados.js"></script>`;
  const files = site.files.filter(file => file?.path !== scriptPath).map(file => {
    const html = isHtml(file?.path) ? textOf(file.data) : null;
    if (html === null) return file;
    let clean = html.replace(/<script>window\.__PROMISA_DADOS__=[\s\S]*?<\/script><script src="\/promisa-dados\.js"><\/script>/g, '');
    // Troca o conteúdo dos blocos de dados do site pela versão publicada pelo cliente (só a 1ª ocorrência de cada id).
    for (const [id, json] of Object.entries(embedded || {})) {
      const safe = String(json).replace(/</g, '\\u003c');
      clean = clean.replace(new RegExp('(<script type="application/json" id="' + id + '">)[\\s\\S]*?(</script>)'), (_, a, b) => a + safe + b);
    }
    const withTag = /<head[^>]*>/i.test(clean) ? clean.replace(/<head[^>]*>/i, match => match + tag) : tag + clean;
    return { ...file, data: withTag };
  });
  files.push({ path: scriptPath, type: 'text/javascript', data: SHIM });
  return { ...site, files };
}

// Envolve o leitor de sites: se o site tem "dados ao vivo", entrega a versão com os dados embutidos.
export function withSiteData(readSiteInfo, store, { api }) {
  return async (siteKey, options) => {
    const info = await readSiteInfo(siteKey, options);
    if (!info?.site) return info;
    const siteId = String(siteKey).replace(/^sites:/, '');
    const record = await store.get(siteId).catch(() => null);
    if (!record || (!record.enabled && !Object.keys(record.keys || {}).length && !Object.keys(record.embedded || {}).length)) return info;
    return { ...info, site: injectSiteData(info.site, { siteId, keys: record.keys || {}, embedded: record.embedded || {}, api }) };
  };
}

// Ações: pública (site-data-save, chamada pelo próprio site do cliente) e do dono (admin-data-*).
export function createSiteDataActions({ store, publish, now = () => Date.now() }) {
  const dayOf = ms => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  const busy = error => error?.code === 'busy';
  async function publicSave(body) {
    const siteId = body.siteId, password = String(body.password || '');
    if (!validSiteId(siteId) || password.length < 6 || password.length > 40) return [404, { error: 'Site ou senha inválidos.' }];
    const changes = cleanChanges(body.changes || {}), embedded = cleanEmbedded(body.embedded);
    if (!changes || !embedded) return [400, { error: 'Dados inválidos.' }];
    if (!Object.keys(changes).length && !Object.keys(embedded).length) return [400, { error: 'Nada para publicar.' }];
    const at = now();
    let reserved;
    try {
      reserved = await store.update(siteId, r => {
        if (!r?.enabled || r.lockUntil > at) return null;
        const fails = (r.lockUntil && r.lockUntil <= at ? 0 : r.fails || 0) + 1;
        return { ...r, fails, lockUntil: fails >= MAX_FAILS ? at + LOCK_MS : 0 };
      });
    } catch (error) { if (busy(error)) return [429, { error: 'Muitos pedidos ao mesmo tempo. Tente de novo.' }]; throw error; }
    const record = reserved.record;
    if (!record?.enabled) return [404, { error: 'A edição deste site não está ligada. Fale com a Promisa.' }];
    if (!reserved.changed) return [429, { error: 'Muitas tentativas. Tente de novo em 15 minutos.' }];
    if (!samePassword(password, record.salt, record.hash)) return [401, { error: 'Senha incorreta.', code: 'password' }];
    const today = dayOf(at);
    let saved;
    try {
      saved = await store.update(siteId, r => {
        if (!r?.enabled) return null;
        const count = r.saves?.day === today ? r.saves.count : 0;
        if (count >= MAX_SAVES_PER_DAY) return null;
        const keys = mergeKeys(r.keys, changes), emb = { ...(r.embedded || {}), ...embedded };
        if (dataSize(keys, emb) > MAX_DATA_BYTES) return null;
        return { ...r, fails: 0, lockUntil: 0, keys, embedded: emb, updatedAt: at, saves: { day: today, count: count + 1 } };
      });
    } catch (error) { if (busy(error)) return [503, { error: 'Muitos pedidos ao mesmo tempo. Suas alterações continuam na tela: tente de novo.' }]; throw error; }
    if (!saved.changed) {
      const r = saved.record;
      if (!r?.enabled) return [404, { error: 'A edição deste site foi desligada.' }];
      if ((r.saves?.day === today ? r.saves.count : 0) >= MAX_SAVES_PER_DAY) return [429, { error: 'Limite de publicações de hoje atingido. Tente amanhã.' }];
      return [413, { error: 'Os dados ficaram grandes demais (fotos?). Use imagens menores.' }];
    }
    try { const out = await publish(siteId); return [200, { ok: true, published: Boolean(out?.published) }]; }
    catch { return [502, { error: 'Salvei suas alterações, mas não consegui publicar agora. Tente "Publicar para todos" de novo em alguns minutos.', saved: true }]; }
  }
  async function admin(action, body) {
    if (!validSiteId(body.siteId)) return [400, { error: 'Site inválido.' }];
    const siteId = body.siteId;
    if (action === 'admin-data-status') {
      const r = await store.get(siteId);
      return [200, { ok: true, exists: Boolean(r), enabled: Boolean(r?.enabled), updatedAt: r?.updatedAt || 0, keys: Object.keys(r?.keys || {}).length + Object.keys(r?.embedded || {}).length, size: dataSize(r?.keys, r?.embedded) }];
    }
    if (action === 'admin-data-enable') {
      const password = newPassword(), salt = randomBytes(16).toString('hex');
      await store.update(siteId, r => ({ version: 1, siteId, keys: r?.keys || {}, embedded: r?.embedded || {}, updatedAt: r?.updatedAt || 0, saves: r?.saves || { day: '', count: 0 }, enabled: true, salt, hash: hashPassword(password, salt), fails: 0, lockUntil: 0, createdAt: r?.createdAt || now() }));
      return [200, { ok: true, password }];
    }
    if (action === 'admin-data-disable') {
      await store.update(siteId, r => r ? { ...r, enabled: false } : null);
      return [200, { ok: true }];
    }
    return [400, { error: 'Ação desconhecida.' }];
  }
  return { publicSave, admin };
}
