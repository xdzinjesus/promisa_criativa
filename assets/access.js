const form = document.getElementById('access-form');
const error = document.getElementById('access-error');
let gateReady;
function lockGate() {
  document.getElementById('choice-panel').hidden = true;
  document.getElementById('login-panel').hidden = false;
  document.getElementById('admin-password').value = '';
  const button = document.getElementById('access-submit');
  button.disabled = true;
  gateReady = fetch('/api/access?action=logout', { method: 'POST', credentials: 'same-origin', cache: 'no-store' })
    .then(response => {
      if (!response.ok) throw new Error();
      error.textContent = '';
      return true;
    }).catch(() => {
      error.textContent = 'Não foi possível preparar o acesso seguro. Recarregue a página para tentar novamente.';
      return false;
    }).finally(() => { button.disabled = false; });
}
function showChoice() {
  document.getElementById('login-panel').hidden = true;
  document.getElementById('choice-panel').hidden = false;
  document.getElementById('choice-title').focus();
}
document.getElementById('toggle-password').addEventListener('click', event => {
  const input = document.getElementById('admin-password');
  const visible = input.type === 'password';
  input.type = visible ? 'text' : 'password';
  event.currentTarget.textContent = visible ? 'Ocultar' : 'Mostrar';
  event.currentTarget.setAttribute('aria-label', visible ? 'Ocultar senha' : 'Mostrar senha');
  event.currentTarget.setAttribute('aria-pressed', String(visible));
});
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (!await gateReady) return;
  const button = document.getElementById('access-submit');
  const input = document.getElementById('admin-password');
  error.textContent = '';
  button.disabled = true;
  button.textContent = 'Verificando…';
  try {
    const response = await fetch('/api/access?action=login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ password: input.value }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Não foi possível entrar.');
    input.value = '';
    showChoice();
  } catch (cause) {
    error.textContent = cause.message === 'Failed to fetch' ? 'Sem conexão. Verifique sua internet e tente novamente.' : cause.message;
    input.focus();
  } finally { button.disabled = false; button.textContent = 'Entrar →'; }
});
document.querySelector('[data-logout]').addEventListener('click', async () => {
  try {
    const response = await fetch('/api/access?action=logout', { method: 'POST', credentials: 'same-origin' });
    if (!response.ok) throw new Error();
    location.replace('/');
  } catch { alert('Não foi possível sair. Verifique a conexão e tente novamente.'); }
});
// Abrir a entrada administrativa sempre exige digitar a senha novamente.
lockGate();
window.addEventListener('pageshow', event => { if (event.persisted) lockGate(); });
