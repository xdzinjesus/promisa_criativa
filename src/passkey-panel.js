// Painel: ativar e gerenciar Face ID / digital (chaves de acesso).
import { startRegistration, browserSupportsWebAuthn } from '@simplewebauthn/browser';

const openButton = document.getElementById('passkey-open');
if (openButton && browserSupportsWebAuthn()) {
  openButton.hidden = false;
  let dialog;
  const guessName = () => {
    const ua = navigator.userAgent || '';
    if (/iPhone|iPad|iPod/.test(ua)) return 'iPhone';
    if (/Android/.test(ua)) return 'Android';
    return 'Computador';
  };
  const api = async (action, body) => {
    const response = await fetch(`/api/access?action=${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', cache: 'no-store', body: JSON.stringify(body || {}) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Não foi possível concluir. Tente novamente.');
    return result;
  };
  const el = (tag, text, props = {}) => Object.assign(document.createElement(tag), text == null ? {} : { textContent: text }, props);
  const fmt = value => value ? new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : 'nunca';

  function build() {
    dialog = el('dialog', null, { className: 'sheet passkey-dialog' });
    dialog.setAttribute('aria-labelledby', 'passkey-title');
    const head = el('div', null, { className: 'sheet-head' });
    head.append(el('h2', 'Face ID / chaves de acesso', { id: 'passkey-title' }), el('button', '✕', { type: 'button', className: 'sheet-x', ariaLabel: 'Fechar' }));
    head.lastChild.addEventListener('click', () => dialog.close());
    const body = el('div', null, { className: 'sheet-body' });
    body.append(
      el('p', 'Com uma chave de acesso você entra na área administrativa só encostando o dedo ou olhando para o celular, sem digitar a senha. A senha continua funcionando normalmente.'),
      el('p', 'Toque em “Ativar neste aparelho” e confirme com Face ID, digital ou o desbloqueio do aparelho. Faça isso em cada aparelho que você usa.'),
      el('button', 'Ativar neste aparelho', { type: 'button', id: 'passkey-add', className: 'passkey-btn' }),
      el('p', '', { id: 'passkey-msg', role: 'status' }),
      el('h3', 'Aparelhos ativados'),
      el('ul', null, { id: 'passkey-list', className: 'passkey-list' })
    );
    dialog.append(head, body);
    document.body.append(dialog);
    body.querySelector('#passkey-add').addEventListener('click', register);
  }
  const message = (text, bad) => { const node = dialog.querySelector('#passkey-msg'); node.textContent = text; node.className = bad ? 'passkey-bad' : 'passkey-ok'; };

  async function refresh() {
    const list = dialog.querySelector('#passkey-list');
    try {
      const { items } = await api('passkey-list');
      list.replaceChildren();
      if (!items.length) list.append(el('li', 'Nenhum aparelho ativado ainda.'));
      for (const item of items) {
        const row = el('li');
        const info = el('div');
        info.append(el('strong', item.name), el('small', `Ativado em ${fmt(item.createdAt)} · Último uso: ${fmt(item.lastUsedAt)}`));
        const remove = el('button', 'Remover', { type: 'button', className: 'passkey-btn sec danger' });
        remove.addEventListener('click', async () => {
          if (!confirm(`Remover "${item.name}"? Esse aparelho deixará de entrar com Face ID.`)) return;
          remove.disabled = true;
          try { await api('passkey-delete', { id: item.id }); message('Chave removida.'); } catch (cause) { message(cause.message, true); }
          refresh();
        });
        row.append(info, remove);
        list.append(row);
      }
    } catch (cause) { list.replaceChildren(el('li', cause.message)); }
  }

  async function register() {
    const add = dialog.querySelector('#passkey-add');
    const name = (prompt('Dê um nome para este aparelho:', guessName()) || '').trim().slice(0, 40);
    if (!name) return;
    add.disabled = true;
    message('');
    try {
      const options = await api('passkey-register-options');
      let credential;
      try { credential = await startRegistration({ optionsJSON: options }); }
      catch (cause) {
        if (cause?.name === 'NotAllowedError' || cause?.name === 'AbortError') return;
        if (cause?.name === 'InvalidStateError') throw new Error('Este aparelho já está ativado.');
        throw new Error('Não foi possível ativar neste aparelho.');
      }
      await api('passkey-register-verify', { response: credential, name });
      message('Pronto! Da próxima vez, toque em "Entrar com Face ID" na tela de acesso.');
      await refresh();
    } catch (cause) { message(cause.message === 'Failed to fetch' ? 'Sem conexão. Tente novamente.' : cause.message, true); }
    finally { add.disabled = false; }
  }

  openButton.addEventListener('click', () => {
    openButton.closest('details')?.removeAttribute('open');
    if (!dialog) build();
    message('');
    dialog.showModal();
    refresh();
  });
}
