const form = document.getElementById('access-form');
const error = document.getElementById('access-error');
let gateReady;
function lockGate(clearPassword = true) {
  document.getElementById('choice-panel').hidden = true;
  document.getElementById('login-panel').hidden = false;
  if (clearPassword) document.getElementById('admin-password').value = '';
  const button = document.getElementById('access-submit');
  button.disabled = true;
  gateReady = fetch('/api/access?action=logout', { method: 'POST', credentials: 'same-origin', cache: 'no-store' })
    .then(async response => {
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error || 'Não foi possível preparar o acesso seguro. Tente novamente.');
      }
      error.textContent = '';
      return true;
    }).catch(cause => {
      error.textContent = cause.message === 'Failed to fetch' ? 'Sem conexão. Verifique sua internet e clique em Entrar para tentar novamente.' : cause.message;
      return false;
    }).finally(() => { button.disabled = false; });
  return gateReady;
}
function showChoice() {
  document.getElementById('login-panel').hidden = true;
  document.getElementById('choice-panel').hidden = false;
  document.getElementById('choice-title').focus();
}
window.promisaAccess = { showChoice, ready: () => gateReady };
document.getElementById('toggle-password').addEventListener('click', event => {
  const input = document.getElementById('admin-password');
  const visible = input.type === 'password';
  input.type = visible ? 'text' : 'password';
  event.currentTarget.textContent = visible ? 'Ocultar' : 'Mostrar';
  event.currentTarget.setAttribute('aria-label', visible ? 'Ocultar senha' : 'Mostrar senha');
  event.currentTarget.setAttribute('aria-pressed', String(visible));
});
// "Sou sócio": mostra o campo de usuário (o dono entra só com a senha, como sempre).
const partnerBox = document.getElementById('partner-user'), partnerInput = document.getElementById('partner-login'), partnerToggle = document.getElementById('partner-toggle');
partnerToggle?.addEventListener('click', () => {
  const show = partnerBox.hidden; partnerBox.hidden = !show; partnerToggle.setAttribute('aria-expanded', String(show));
  partnerToggle.textContent = show ? 'Sou o dono: entrar só com a senha' : 'Sou sócio: entrar com usuário';
  partnerInput.required = show; (show ? partnerInput : document.getElementById('admin-password')).focus();
});
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (!await gateReady && !await lockGate(false)) return;
  const button = document.getElementById('access-submit');
  const input = document.getElementById('admin-password');
  error.textContent = '';
  button.disabled = true;
  button.textContent = 'Verificando…';
  try {
    const partnerUser = partnerBox.hidden ? '' : partnerInput.value.trim();
    const response = await fetch('/api/access?action=login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(partnerUser ? { user: partnerUser, password: input.value } : { password: input.value }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Não foi possível entrar.');
    const password = input.value;
    input.value = '';
    // Sócio: vai direto para a gestão (só com os módulos liberados pelo dono).
    if (partnerUser) { location.replace('/admin'); return; }
    // Destrava os dados protegidos com a mesma senha; nunca impede nem atrasa o login por mais de 15 s.
    try { await Promise.race([Promise.resolve(window.promisaVault?.afterLogin(password)).catch(() => {}), new Promise(resolve => setTimeout(resolve, 15_000))]); } catch {}
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
