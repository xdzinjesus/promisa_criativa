// Painel: ver se o Discord está ligado, criar os canais e enviar uma mensagem de teste.
// Fala só com /api/discord (sessão do painel). Sem innerHTML: tudo por createElement/textContent.
const openButton = document.getElementById('discord-open');
if (openButton) {
  let dialog;
  const el = (tag, text, props = {}) => Object.assign(document.createElement(tag), text == null ? {} : { textContent: text }, props);
  const api = async action => {
    const response = await fetch('/api/discord', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', cache: 'no-store', body: JSON.stringify({ action }) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Não foi possível concluir. Tente novamente.');
    return result;
  };
  const message = (text, bad) => { const node = dialog.querySelector('#discord-msg'); node.textContent = text; node.className = bad ? 'passkey-bad' : 'passkey-ok'; };
  const busy = (value) => dialog.querySelectorAll('button.passkey-btn').forEach(button => { button.disabled = value; });

  function build() {
    dialog = el('dialog', null, { className: 'sheet passkey-dialog' });
    dialog.setAttribute('aria-labelledby', 'discord-title');
    const head = el('div', null, { className: 'sheet-head' });
    head.append(el('h2', '💬 Discord', { id: 'discord-title' }), el('button', '✕', { type: 'button', className: 'sheet-x', ariaLabel: 'Fechar' }));
    head.lastChild.addEventListener('click', () => dialog.close());
    const body = el('div', null, { className: 'sheet-body' });
    const create = el('button', 'Criar canais', { type: 'button', className: 'passkey-btn', id: 'discord-setup' });
    const test = el('button', 'Enviar mensagem de teste', { type: 'button', className: 'passkey-btn sec', id: 'discord-test' });
    body.append(
      el('p', 'O Discord recebe avisos de novos briefings, demonstrações abertas, diagnósticos, sites publicados e alertas, e responde aos comandos / do dono.'),
      el('p', '', { id: 'discord-state', role: 'status' }),
      el('ul', null, { id: 'discord-channels', className: 'passkey-list' }),
      el('div', null, { className: 'sheet-grid' }),
      el('p', '', { id: 'discord-msg', role: 'status' })
    );
    body.querySelector('.sheet-grid').append(create, test);
    dialog.append(head, body);
    document.body.append(dialog);
    create.addEventListener('click', async () => {
      busy(true); message('');
      try {
        const result = await api('setup');
        const made = result.channels?.created?.length || 0;
        if (result.ok) message(made ? `Pronto! Criei ${made} canal(is) e atualizei os comandos.` : 'Tudo certo: os canais já existem. Comandos atualizados.');
        else {
          const ch = result.channels || {}, code = Number(ch.status) || 0;
          const why = ch.error === 'forbidden' ? 'O robô não tem permissão para criar canais. Dê a ele "Gerenciar canais" no servidor.'
            : code === 401 ? 'O token do robô está errado. Confira DISCORD_BOT_TOKEN na Vercel (sem espaços) e faça um novo deploy.'
            : code === 403 ? 'O robô não está no servidor ou não enxerga os canais. Adicione o robô ao servidor pelo link de convite.'
            : code === 404 ? 'O ID do servidor está errado. Confira DISCORD_GUILD_ID na Vercel.'
            : code === 0 ? 'Não consegui falar com o Discord. Confira o token na Vercel e tente de novo.'
            : 'Não consegui criar todos os canais (código ' + code + '). Tente de novo.';
          message(why, true);
        }
      } catch (cause) { message(cause.message === 'Failed to fetch' ? 'Sem conexão. Tente novamente.' : cause.message, true); }
      finally { busy(false); refresh(); }
    });
    test.addEventListener('click', async () => {
      busy(true); message('');
      try { const result = await api('test'); message(result.ok ? 'Mensagem enviada! Veja o canal #alertas.' : 'Não consegui enviar. Crie os canais e confira as chaves na Vercel.', !result.ok); }
      catch (cause) { message(cause.message === 'Failed to fetch' ? 'Sem conexão. Tente novamente.' : cause.message, true); }
      finally { busy(false); }
    });
  }

  async function refresh() {
    const state = dialog.querySelector('#discord-state'), list = dialog.querySelector('#discord-channels');
    state.textContent = 'Verificando…'; list.replaceChildren();
    try {
      const status = await api('status');
      if (!status.configured) { state.textContent = 'Ainda não configurado: faltam as chaves DISCORD_* na Vercel. Enquanto isso, nada é enviado.'; return; }
      state.textContent = `Ligado. Comandos: ${status.commandsRegistered ? 'registrados' : status.interactionsConfigured ? 'ainda não registrados (use "Criar canais")' : 'faltam DISCORD_APP_ID, DISCORD_PUBLIC_KEY ou DISCORD_OWNER_ID'}.`;
      for (const name of status.channelsFound || []) list.append(el('li', `✅ #${name}`));
      for (const name of status.channelsMissing || []) list.append(el('li', `⚠️ #${name} (falta criar)`));
    } catch (cause) { state.textContent = cause.message; }
  }

  openButton.addEventListener('click', () => {
    openButton.closest('details')?.removeAttribute('open');
    if (!dialog) build();
    message('');
    dialog.showModal();
    refresh();
  });
}
