import * as blob from '@vercel/blob';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { isBlobError, readWithEtag } from './blob-utils.js';
import { cleanModules } from '../src/partner-modules.js';

// Sócios com acesso ao painel (Blob PRIVADO): promisa/partners/v1/index.json
// { version, partners: [{ id, name, user, salt, hash, modules, active, createdAt, updatedAt, lastLogin, sessions }] }
// A senha nunca é guardada: só scrypt + sal. `sessions` guarda as últimas entradas, para cortar o acesso na hora.
export const INDEX_PATH = 'promisa/partners/v1/index.json';
export const MAX_PARTNERS = 10, MAX_SESSIONS = 20;
const conflict = error => isBlobError(error, 'BlobPreconditionFailedError') || /already exists|precondition/i.test(error?.message || '');
export const cleanUser = raw => String(raw ?? '').trim().toLowerCase();
export const validUser = user => /^[a-z0-9._-]{3,30}$/.test(user);
export const validPassword = password => typeof password === 'string' && password.length >= 8 && password.length <= 128;
const hashOf = (password, salt) => scryptSync(String(password), Buffer.from(salt, 'hex'), 32).toString('hex');
export function passwordOk(partner, password) {
  if (!partner?.salt || !partner?.hash || typeof password !== 'string' || password.length > 256) return false;
  const a = Buffer.from(hashOf(password, partner.salt), 'hex'), b = Buffer.from(partner.hash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
export const hashPassword = password => { const salt = randomBytes(16).toString('hex'); return { salt, hash: hashOf(password, salt) }; };
// O que o painel do dono pode ver (nunca sal, hash ou sessões).
export const publicView = p => ({ id: p.id, name: p.name, user: p.user, modules: p.modules, active: p.active, createdAt: p.createdAt, updatedAt: p.updatedAt, lastLogin: p.lastLogin || 0 });

export function createPartnerStore({
  get = blob.get, head = blob.head, put = blob.put,
  token = () => process.env.BLOB_READ_WRITE_TOKEN,
  memory = () => !token() && !process.env.VERCEL
} = {}) {
  const options = () => ({ token: token() });
  let mem = { version: 1, partners: [] };
  const empty = () => ({ version: 1, partners: [] });
  const ensure = () => { if (!memory() && !token()) throw Object.assign(new Error('Armazenamento online não configurado.'), { status: 503 }); };
  const shape = data => data && Array.isArray(data.partners) ? data : empty();
  return {
    async read() {
      ensure();
      if (memory()) return structuredClone(mem);
      let result;
      try { result = await get(INDEX_PATH, { ...options(), access: 'private', useCache: false }); }
      catch (error) { if (isBlobError(error, 'BlobNotFoundError')) return empty(); throw error; }
      if (!result?.stream) return empty();
      return shape(await new Response(result.stream).json().catch(() => null));
    },
    // Lê, aplica `change` e grava com ifMatch (dois salvamentos ao mesmo tempo não se apagam). `change` pode lançar erro.
    async update(change) {
      ensure();
      if (memory()) { const next = change(structuredClone(mem)); if (next) mem = structuredClone(next); return structuredClone(mem); }
      for (let attempt = 0; attempt < 5; attempt++) {
        let read;
        try { read = await readWithEtag(INDEX_PATH, options(), { get, head }); }
        catch (error) { if (/mudou durante a leitura/.test(error?.message || '')) continue; throw error; }
        const current = shape(read ? await new Response(read.result.stream).json().catch(() => null) : null);
        const next = change(structuredClone(current));
        if (!next) return current;
        try {
          await put(INDEX_PATH, JSON.stringify(next), { ...options(), access: 'private', contentType: 'application/json', addRandomSuffix: false, ...(read ? { allowOverwrite: true, ifMatch: read.etag } : { allowOverwrite: false }), cacheControlMaxAge: 0 });
          return next;
        } catch (error) { if (!conflict(error)) throw error; }
      }
      throw Object.assign(new Error('Outra gravação estava em andamento. Tente de novo.'), { status: 409 });
    },
  };
}

// Ações do dono (criar, mudar módulos, trocar senha, pausar, apagar). `revoke(nonce)` corta as sessões abertas do sócio.
export function createPartnerActions({ store, revoke = async () => {}, now = () => Date.now(), newId = () => 'u' + randomBytes(6).toString('hex') }) {
  const fail = (status, error) => { throw Object.assign(new Error(error), { status }); };
  // Lista da equipe guardada 60 s nesta instância (o painel pede a cada abertura; economiza leituras do Blob).
  let cache = null;
  const cachedRead = async () => { if (cache && cache.until > now()) return cache.data; const data = await store.read(); cache = { data, until: now() + 60_000 }; return data; };
  const forget = () => { cache = null; };
  const cut = async partner => { for (const nonce of partner?.sessions || []) await revoke(nonce).catch(() => {}); };
  return {
    async list() { return (await store.read()).partners.map(publicView); },
    async ownerName() { return (await store.read()).ownerName || ''; },
    // Equipe para o campo "Responsável" dos clientes: o dono + os sócios (só id e nome).
    async team() { const d = await cachedRead(); return [{ id: 'owner', name: d.ownerName || 'Dono' }, ...d.partners.map(p => ({ id: p.id, name: p.name, active: p.active }))]; },
    async setOwnerName(name) { const n = String(name ?? '').trim().slice(0, 40); if (!n) fail(400, 'Digite o seu nome.'); await (forget(), store.update)(d => { d.ownerName = n; return d; }); return { ownerName: n }; },
    async create({ name, user, password, modules }) {
      const u = cleanUser(user), n = String(name ?? '').trim().slice(0, 60);
      if (!n) fail(400, 'Informe o nome do sócio.');
      if (!validUser(u)) fail(400, 'Usuário: de 3 a 30 letras minúsculas, números, ponto, traço ou _ (sem espaço).');
      if (!validPassword(password)) fail(400, 'A senha precisa ter pelo menos 8 caracteres.');
      const mods = cleanModules(modules);
      if (!mods.length) fail(400, 'Escolha pelo menos 1 módulo.');
      const id = newId(), at = now();
      const data = await (forget(), store.update)(d => {
        if (d.partners.length >= MAX_PARTNERS) fail(400, `Limite de ${MAX_PARTNERS} sócios.`);
        if (d.partners.some(p => p.user === u)) fail(409, 'Já existe um sócio com esse usuário.');
        d.partners.push({ id, name: n, user: u, ...hashPassword(password), modules: mods, active: true, createdAt: at, updatedAt: at, lastLogin: 0, sessions: [] });
        return d;
      });
      return publicView(data.partners.find(p => p.id === id));
    },
    // patch: { name?, modules?, active?, password? }. Qualquer mudança corta as sessões abertas (vale na hora).
    async update(id, patch = {}) {
      let before = null;
      const data = await (forget(), store.update)(d => {
        const p = d.partners.find(x => x.id === id);
        if (!p) fail(404, 'Sócio não encontrado.');
        before = structuredClone(p);
        if (patch.name !== undefined) { const n = String(patch.name).trim().slice(0, 60); if (!n) fail(400, 'Informe o nome do sócio.'); p.name = n; }
        if (patch.modules !== undefined) { const m = cleanModules(patch.modules); if (!m.length) fail(400, 'Escolha pelo menos 1 módulo.'); p.modules = m; }
        if (patch.active !== undefined) p.active = Boolean(patch.active);
        if (patch.password !== undefined) { if (!validPassword(patch.password)) fail(400, 'A senha precisa ter pelo menos 8 caracteres.'); Object.assign(p, hashPassword(patch.password)); }
        p.sessions = []; p.updatedAt = now();
        return d;
      });
      await cut(before);
      return publicView(data.partners.find(p => p.id === id));
    },
    async remove(id) {
      let gone = null;
      await (forget(), store.update)(d => { gone = d.partners.find(p => p.id === id); if (!gone) fail(404, 'Sócio não encontrado.'); d.partners = d.partners.filter(p => p.id !== id); return d; });
      await cut(gone);
      return { ok: true };
    },
    // Login do sócio: devolve o sócio (sem segredos) ou null. Registra a sessão para poder cortá-la depois.
    async login(user, password, nonce) {
      const u = cleanUser(user);
      if (!validUser(u)) return null;
      const p = (await store.read()).partners.find(x => x.user === u);
      if (!p || !p.active || !passwordOk(p, password)) return null;
      await (forget(), store.update)(d => { const x = d.partners.find(y => y.id === p.id); if (!x) return null; x.lastLogin = now(); x.sessions = [...(x.sessions || []), nonce].slice(-MAX_SESSIONS); return d; });
      return publicView(p);
    },
  };
}
