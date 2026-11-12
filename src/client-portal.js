import { mount } from './client-editor.js';

// Página pública "Meu site" (/meu-site/<token>): o cliente digita o código de 6 números e edita SÓ o site dele.
// O token fica só no endereço (nunca é enviado a outros sites: Referrer-Policy no-referrer). A sessão vale 2 h.
const token = (location.pathname.match(/^\/meu-site\/([A-Za-z0-9_-]{32})\/?$/) || [])[1] || '';
const $ = id => document.getElementById(id);
let session = '';

async function api(action, extra = {}) {
  const response = await fetch('/api/meu-site', { method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store', body: JSON.stringify({ action, token, ...extra }) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(body.error || 'Não foi possível concluir. Tente de novo.'), { code: body.code, status: response.status });
  return body;
}

function start() {
  if (!token) { $('mp-login').hidden = true; $('mp-invalid').hidden = false; return; }
  const form = $('mp-form'), input = $('mp-code'), error = $('mp-error'), button = $('mp-enter');
  input.addEventListener('input', () => { input.value = input.value.replace(/\D/g, '').slice(0, 6); error.textContent = ''; });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!/^\d{6}$/.test(input.value)) { error.textContent = 'Digite os 6 números do código.'; return; }
    button.disabled = true; button.textContent = 'Entrando…';
    try {
      const data = await api('login', { code: input.value });
      session = data.session;
      $('mp-login').hidden = true; $('mp-editor').hidden = false;
      mount($('mp-root'), { client: { draft: data.draft, siteName: data.siteName, allowNiche: Boolean(data.allowNiche), onSave } });
    } catch (e) { error.textContent = e.message; button.disabled = false; button.textContent = 'Entrar'; }
  });
  input.focus();
}

async function onSave(draft) {
  try { return await api('save', { session, draft }); }
  catch (error) {
    if (error.code === 'session') { $('mp-editor').hidden = true; $('mp-login').hidden = false; $('mp-error').textContent = error.message + ' (suas alterações continuam na tela depois de entrar)'; $('mp-enter').disabled = false; $('mp-enter').textContent = 'Entrar'; }
    throw error;
  }
}

start();
