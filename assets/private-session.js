async function verifySession() {
  try {
    const response = await fetch('/api/access?action=session', { cache: 'no-store' });
    if (response.status === 401 || response.status === 503) location.replace('/acesso.html');
    else if (response.ok) document.body.style.visibility = '';
  } catch { /* Uma falha de rede não apaga os dados locais nem interrompe edições. */ }
}
window.addEventListener('pagehide', () => { document.body.style.visibility = 'hidden'; });
window.addEventListener('pageshow', verifySession);
window.addEventListener('focus', verifySession);
setInterval(verifySession, 60_000);
document.querySelectorAll('[data-logout]').forEach(button => button.addEventListener('click', async () => {
  button.disabled = true;
  try {
    const response = await fetch('/api/access?action=logout', { method: 'POST' });
    if (!response.ok) throw new Error();
    location.replace('/acesso.html');
  } catch { alert('Não foi possível sair. Verifique sua conexão e tente novamente.'); button.disabled = false; }
}));
