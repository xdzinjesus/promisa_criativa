// Roda na página de acesso: depois do login, tenta destravar o cofre com a mesma senha.
// Qualquer falha é ignorada; o painel pede a senha de novo se for preciso.
import { unlockKeyring } from './vault.js';
import { saveKeys } from './vault-keys.js';

async function afterLogin(password) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch('/api/cloud?action=vault', { credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
    if (!response.ok) return;
    const { keyring } = await response.json();
    if (!keyring) return;
    await saveKeys(await unlockKeyring(keyring, password));
  } catch { /* o painel pede a senha se necessário */ }
  finally { clearTimeout(timer); }
}
window.promisaVault = { afterLogin };
