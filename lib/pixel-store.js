import * as blob from '@vercel/blob';
import { isBlobError } from './blob-utils.js';
import { validEnvelope } from '../src/agenda.js';

// Agenda do Pixel (Blob PRIVADO): promisa/pixel/v1/agenda.json — envelope já criptografado no navegador do dono.
// O servidor nunca vê o conteúdo. Para gastar o mínimo do Blob:
//  - só o painel grava, e só quando o conteúdo muda;
//  - a leitura fica na memória desta instância por 5 minutos (perguntas repetidas não leem o Blob de novo).
export const AGENDA_PATH = 'promisa/pixel/v1/agenda.json';
export const CACHE_MS = 5 * 60 * 1000;

export function createPixelStore({ get = blob.get, put = blob.put, token = () => process.env.BLOB_READ_WRITE_TOKEN, now = () => Date.now() } = {}) {
  let cache = null; // { at, envelope }
  return {
    async read() {
      if (cache && now() - cache.at < CACHE_MS) return cache.envelope;
      if (!token()) throw Object.assign(new Error('Armazenamento online não configurado.'), { status: 503 });
      let envelope = null;
      try {
        const result = await get(AGENDA_PATH, { token: token(), access: 'private', useCache: false });
        if (result?.stream) { const data = await new Response(result.stream).json().catch(() => null); envelope = validEnvelope(data) ? data : null; }
      } catch (error) { if (!isBlobError(error, 'BlobNotFoundError')) throw error; }
      cache = { at: now(), envelope };
      return envelope;
    },
    async write(envelope) {
      if (!validEnvelope(envelope)) throw Object.assign(new Error('Agenda inválida.'), { status: 400 });
      if (!token()) throw Object.assign(new Error('Armazenamento online não configurado.'), { status: 503 });
      await put(AGENDA_PATH, JSON.stringify(envelope), { token: token(), access: 'private', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 0 });
      cache = { at: now(), envelope };
      return { ok: true, updatedAt: envelope.updatedAt };
    },
    forget() { cache = null; },
  };
}
export const pixelStore = createPixelStore();
