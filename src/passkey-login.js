// Página de acesso: entrar com Face ID / digital (chave de acesso).
import { startAuthentication, browserSupportsWebAuthn } from '@simplewebauthn/browser';

const block = document.getElementById('passkey-block');
const button = document.getElementById('passkey-login');
const error = document.getElementById('access-error');
const NONE = 'Nenhuma chave de acesso neste aparelho. Entre com a senha e ative o Face ID no painel.';

async function post(action, body) {
  const response = await fetch(`/api/access?action=${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', cache: 'no-store', body: JSON.stringify(body || {}) });
  const result = await response.json().catch(() => ({}));
  return { response, result };
}

if (block && button && browserSupportsWebAuthn()) {
  block.hidden = false;
  button.addEventListener('click', async () => {
    error.textContent = '';
    button.disabled = true;
    try {
      // Espera a limpeza de sessão feita ao abrir a página, para ela não derrubar este login.
      await window.promisaAccess?.ready();
      const options = await post('passkey-auth-options');
      if (!options.response.ok) throw new Error(options.result.error || 'Não foi possível iniciar. Tente novamente.');
      let credential;
      try { credential = await startAuthentication({ optionsJSON: options.result }); }
      catch (cause) {
        if (cause?.name === 'NotAllowedError' || cause?.name === 'AbortError') return; // cancelou
        throw cause;
      }
      const verified = await post('passkey-auth-verify', { response: credential });
      if (verified.response.status === 401) throw new Error(NONE);
      if (!verified.response.ok) throw new Error(verified.result.error || 'Não foi possível entrar.');
      window.promisaAccess?.showChoice();
    } catch (cause) {
      error.textContent = cause instanceof TypeError ? 'Sem conexão. Verifique sua internet e tente novamente.' : (cause.message || 'Não foi possível entrar com a chave de acesso.');
    } finally { button.disabled = false; }
  });
}
