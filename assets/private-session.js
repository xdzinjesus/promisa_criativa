async function verifySession() {
  try {
    const response = await fetch('/api/access?action=session', { cache: 'no-store' });
    if (response.status === 401 || response.status === 503) location.replace('/acesso.html');
    else if (response.ok) document.body.style.visibility = '';
  } catch { /* Uma falha de rede não apaga os dados locais nem interrompe edições. */ }
}
window.addEventListener('storage', async event => {
  if (event.key !== 'promisa-session-logout') return;
  document.body.style.visibility = 'hidden';
  window.promisaCloud?.pause();
  if (window.promisaAdapter) (await window.promisaAdapter.database()).close();
  location.replace('/acesso.html');
});
window.addEventListener('pagehide', () => { document.body.style.visibility = 'hidden'; });
window.addEventListener('pageshow', verifySession);
window.addEventListener('focus', verifySession);
setInterval(verifySession, 60_000);
document.querySelectorAll('[data-logout]').forEach(button => button.addEventListener('click', async () => {
  const clear = button.hasAttribute('data-clear-local');
  const pending = window.promisaCloud?.hasPending();
  if (pending && !confirm('Há alterações sem confirmação online. Deseja baixar uma cópia de segurança deste aparelho e depois sair? Confira o arquivo baixado antes de apagar qualquer outra cópia.')) return;
  if (clear && !confirm('Apagar os dados e anexos deste navegador após sair? A cópia online será mantida. Verifique seu backup antes de continuar.')) return;
  button.disabled = true;
  window.promisaCloud?.pause();
  let signedOut = false;
  try {
    if (pending) await window.promisaCloud.downloadLocalCopy();
    const response = await fetch('/api/access?action=logout', { method: 'POST' });
    if (!response.ok) throw new Error();
    signedOut = true;
    try { localStorage.setItem('promisa-session-logout', String(Date.now())); } catch {}
    if (clear) {
      // Close this tab's connection. Other tabs must be closed before removal can finish.
      if (window.promisaAdapter) (await window.promisaAdapter.database()).close();
      await new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase('arquivo-sites-v1');
        request.onsuccess = resolve;
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error('Feche as outras abas do painel e tente apagar os dados novamente.'));
      });
      await new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase('promisa-vault');
        request.onsuccess = resolve;
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error('Feche as outras abas do painel e tente apagar os dados novamente.'));
      });
      localStorage.removeItem('painel_v1');
      for (const key of Object.keys(localStorage)) if (key.startsWith('promisa-cloud-baseline:')) localStorage.removeItem(key);
    }
    location.replace('/acesso.html');
  } catch (error) {
    alert(signedOut ? 'A sessão foi encerrada, mas a limpeza local não terminou. Feche as outras abas e tente novamente. Seus dados locais ainda precisam ser removidos.' : 'Não foi possível sair. Verifique sua conexão e tente novamente.');
    button.disabled = false;
    if (!signedOut) window.promisaCloud?.resume();
  }
}));
