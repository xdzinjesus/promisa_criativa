import * as blob from '@vercel/blob';

// As classes de erro do @vercel/blob não definem `name` (vale "Error"); compare pela classe.
export function isBlobError(error, className) {
  if (!error) return false;
  const Class = blob[className];
  return (typeof Class === 'function' && error instanceof Class) || error.constructor?.name === className || error.name === className;
}

// Lê um blob privado junto com a ETag aceita por `ifMatch`.
// A ETag de get() vem do cabeçalho da CDN e não é comparável com a da API de escrita;
// a de head() é. O conteúdo é lido entre duas consultas a head() para garantir que
// corresponde à ETag devolvida (se mudar no meio, lê de novo).
export async function readWithEtag(pathname, options, { get = blob.get, head = blob.head, attempts = 3 } = {}) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    let before;
    try { before = await head(pathname, options); }
    catch (error) { if (isBlobError(error, 'BlobNotFoundError')) return null; throw error; }
    const result = await get(pathname, { ...options, access: 'private', useCache: false });
    if (!result) return null;
    let after;
    try { after = await head(pathname, options); }
    catch (error) { await result.stream?.cancel?.().catch?.(() => {}); if (isBlobError(error, 'BlobNotFoundError')) return null; throw error; }
    if (before.etag === after.etag) return { result, etag: after.etag };
    await result.stream?.cancel?.().catch?.(() => {});
  }
  throw new Error('O arquivo mudou durante a leitura. Tente novamente.');
}
