import { upload } from '@vercel/blob/client';

// Cancela envios sem progresso, inclusive quando a autorização inicial não responde.
export async function uploadRecord(path, blob, onProgress, { uploadImpl = upload, idleMs = 60_000 } = {}) {
  const controller = new AbortController();
  let timer, lastLoaded = 0;
  const timeoutError = new Error('O envio ficou sem resposta. Verifique a conexão e clique em Sincronizar agora para tentar novamente.');
  let arm;
  const timeout = new Promise((_, reject) => {
    arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => { controller.abort(); reject(timeoutError); }, idleMs);
    };
    arm();
  });
  try {
    return await Promise.race([
      uploadImpl(path, blob, {
        access: 'private', contentType: 'application/json',
        handleUploadUrl: '/api/cloud?action=upload', multipart: blob.size > 4 * 1024 * 1024,
        abortSignal: controller.signal,
        onUploadProgress: progress => {
          if (progress.loaded > lastLoaded) { lastLoaded = progress.loaded; arm(); }
          onProgress(progress);
        }
      }),
      timeout
    ]);
  } finally { clearTimeout(timer); }
}
