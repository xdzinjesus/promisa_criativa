import { randomBytes } from 'node:crypto';
import * as blob from '@vercel/blob';
import { isBlobError } from './blob-utils.js';

// Projetos em destaque da página inicial. A lista fica no Blob privado; só a API
// autenticada grava. O público vê apenas um código aleatório por projeto (sem o
// identificador interno do site nem dados de clientes).
export const FEATURED = 'promisa/v1/featured.json';
export const MAX_FEATURED = 6;
export const newFeaturedId = () => randomBytes(16).toString('base64url');

// Valida os itens enviados pelo painel. Devolve a lista limpa ou lança erro com mensagem em português.
export function cleanFeaturedItems(items, validId) {
  if (!Array.isArray(items) || items.length > MAX_FEATURED) throw new FeaturedError('Escolha no máximo ' + MAX_FEATURED + ' projetos em destaque.');
  const seen = new Set();
  return items.map(item => {
    if (!item || typeof item !== 'object' || !validId(item.siteId) || seen.has(String(item.siteId))) throw new FeaturedError('Site inválido na lista de destaques.');
    seen.add(String(item.siteId));
    const title = typeof item.title === 'string' ? item.title.trim() : '', category = typeof item.category === 'string' ? item.category.trim() : '';
    if (!title || title.length > 60 || category.length > 60) throw new FeaturedError('Título e categoria devem ter até 60 caracteres (título obrigatório).');
    if (!Number.isInteger(item.order) || item.order < 1 || item.order > MAX_FEATURED) throw new FeaturedError('A posição deve ser de 1 a ' + MAX_FEATURED + '.');
    if (item.demo !== undefined && typeof item.demo !== 'boolean') throw new FeaturedError('Campo inválido: demonstrativo.');
    return { siteId: String(item.siteId), title, category, order: item.order, demo: item.demo === true };
  });
}
// Visão pública: nunca expõe o identificador interno do site.
export const publicItems = list => list.map(({ id, title, category, demo }) => ({ id, title, category, demo: Boolean(demo) }));
export class FeaturedError extends Error { status = 400; }

export function createFeaturedStore({ get = blob.get, put = blob.put, token = () => process.env.BLOB_READ_WRITE_TOKEN, now = () => Date.now(), newId = newFeaturedId } = {}) {
  const options = () => ({ token: token() });

  async function read() {
    let result;
    try { result = await get(FEATURED, { ...options(), access: 'private', useCache: false }); }
    catch (error) { if (isBlobError(error, 'BlobNotFoundError')) return { version: 1, items: [], updatedAt: null }; throw error; }
    if (!result?.stream) return { version: 1, items: [], updatedAt: null };
    if (result.blob?.size > 256 * 1024) { await result.stream.cancel?.().catch?.(() => {}); throw new Error('Lista de destaques inválida.'); }
    const data = await new Response(result.stream).json();
    if (data?.version !== 1 || !Array.isArray(data.items)) throw new Error('Lista de destaques inválida.');
    return data;
  }

  return {
    async list() { return (await read()).items; },
    // Um único administrador grava; o código de um site já publicado é mantido para a CDN continuar válida.
    async publish(items) {
      if (!Array.isArray(items) || items.length > MAX_FEATURED) throw new Error('Informe de 0 a ' + MAX_FEATURED + ' destaques.');
      const previous = new Map((await read()).items.map(item => [item.siteKey, item.id]));
      const list = items.map(item => ({
        id: previous.get(item.siteKey) || newId(),
        siteKey: item.siteKey, title: item.title, category: item.category, order: item.order, demo: Boolean(item.demo)
      })).sort((a, b) => a.order - b.order);
      const data = { version: 1, items: list, updatedAt: new Date(now()).toISOString() };
      await put(FEATURED, JSON.stringify(data), { ...options(), access: 'private', allowOverwrite: true, addRandomSuffix: false, contentType: 'application/json', cacheControlMaxAge: 60 });
      return list;
    }
  };
}
