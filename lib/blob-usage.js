import * as blob from '@vercel/blob';
import { readManifest } from './cloud-store.js';

// Monitor do armazenamento (Blob): quanto espaço cada parte do painel ocupa, contado direto nos arquivos.
// Só leitura. Cada página da listagem custa 1 "operação avançada" (até 1.000 arquivos por página).
const KIND_LABEL = {
  sales: 'Clientes', exp: 'Despesas', projects: 'Projetos', bank: 'Extratos bancários', products: 'Produtos (com fotos)',
  settings: 'Configurações', sites: 'Sites (cadastro)', sitefiles: 'Arquivos dos sites', attachments: 'Anexos dos projetos'
};
const AREAS = [
  ['promisa/v1/briefing', 'Formulários (briefing)'], ['promisa/v1/shares', 'Links de demonstração'], ['promisa/v1/featured', 'Destaques do site'],
  ['promisa/site-data/', 'Dados ao vivo dos sites'], ['promisa/auth/', 'Login e sessões'], ['promisa/client-access/', 'Acessos dos clientes'],
  ['promisa/diagnostics/', 'Diagnósticos'], ['promisa/discord/', 'Backups do Discord'], ['promisa/instagram/', 'Instagram'],
  ['promisa/partners/', 'Sócios'], ['promisa/publish/', 'Publicações'], ['promisa/v1/', 'Índice e chaves do painel']
];
export const MAX_PAGES = 25;

export function groupBlobs(blobs, manifest) {
  const byPath = new Map();
  for (const [key, rec] of Object.entries(manifest?.records || {})) if (rec?.path) byPath.set(rec.path, key.slice(0, key.indexOf(':')));
  const retired = new Set(Object.keys(manifest?.retired || {}));
  const groups = new Map(); let bytes = 0;
  const add = (label, size) => { const g = groups.get(label) || { label, count: 0, bytes: 0 }; g.count++; g.bytes += size; groups.set(label, g); };
  for (const b of blobs) {
    const path = String(b.pathname || ''), size = Number(b.size) || 0; bytes += size;
    if (path.startsWith('promisa/v1/objects/')) {
      const kind = byPath.get(path);
      add(kind ? (KIND_LABEL[kind] || 'Outros dados do painel') : retired.has(path) ? 'Versões antigas (limpeza automática)' : 'Arquivos soltos (sem uso)', size);
    } else add((AREAS.find(([p]) => path.startsWith(p)) || [, 'Outros'])[1], size);
  }
  return { count: blobs.length, bytes, groups: [...groups.values()].sort((a, b) => b.bytes - a.bytes) };
}

export async function blobUsage({ list = blob.list, manifest = readManifest, token = process.env.BLOB_READ_WRITE_TOKEN } = {}) {
  if (!token) return { configured: false };
  const blobs = []; let cursor, pages = 0, truncated = false;
  do {
    const page = await list({ token, limit: 1000, ...(cursor ? { cursor } : {}) });
    blobs.push(...(page.blobs || []).map(b => ({ pathname: b.pathname, size: b.size })));
    cursor = page.hasMore ? page.cursor : undefined; pages++;
    if (cursor && pages >= MAX_PAGES) { truncated = true; break; }
  } while (cursor);
  const m = await manifest().catch(() => null);
  return { configured: true, at: new Date().toISOString(), pages, truncated, ...groupBlobs(blobs, m?.manifest) };
}
