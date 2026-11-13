// Aba "👥 Sócios" (só o dono): criar acesso com usuário e senha, escolher os módulos, trocar senha, pausar e apagar.
// O servidor guarda só o embaralhado da senha e corta as sessões abertas do sócio a cada mudança.
import { MODULES } from './partner-modules.js';

const el = (tag, text, props = {}) => Object.assign(document.createElement(tag), text == null ? {} : { textContent: text }, props);
const when = ms => ms ? new Date(ms).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }) : 'nunca entrou';
const label = id => MODULES.find(m => m.id === id)?.label || id;
const ui = { open: '', fresh: null };

async function api(action, body = {}) {
  const r = await fetch('/api/access?action=' + action, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', cache: 'no-store', body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Não foi possível concluir.');
  return d;
}
// Senha forte fácil de ditar: 3 grupos de letras/números sem os confusos (0/O, 1/l).
export function strongPassword() {
  const abc = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789', bytes = crypto.getRandomValues(new Uint8Array(12));
  const chars = [...bytes].map(b => abc[b % abc.length]).join('');
  return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8)}`;
}
function moduleChecks(selected = []) {
  const box = el('fieldset', null, { className: 'pt-mods' });
  box.append(el('legend', 'O que ele pode ver e usar'));
  const quick = el('div', null, { className: 'pt-quick' });
  for (const [t, on] of [['✅ Marcar todos', true], ['Desmarcar todos', false]]) { const b = el('button', t, { type: 'button', className: 'sec' }); b.addEventListener('click', () => box.querySelectorAll('input[type=checkbox]').forEach(i => { i.checked = on; })); quick.append(b); }
  box.append(quick);
  for (const m of MODULES) {
    const lab = el('label', null, { className: 'pt-check' });
    lab.append(el('input', null, { type: 'checkbox', value: m.id, checked: selected.includes(m.id) }), el('span', m.label));
    box.append(lab);
  }
  box.append(el('p', 'Ficam sempre só com você: Backup, Discord, criptografia, Face ID, uso da Vercel e esta tela de sócios.', { className: 'sub' }));
  return { box, read: () => [...box.querySelectorAll('input:checked')].map(i => i.value) };
}
function copy(text, button) {
  navigator.clipboard?.writeText(text).then(() => { const t = button.textContent; button.textContent = 'Copiado ✓'; setTimeout(() => { button.textContent = t; }, 1500); }).catch(() => prompt('Copie:', text));
}
function credentialsBox(name, user, password) {
  const box = el('div', null, { className: 'card pt-fresh' });
  const url = location.origin + '/acesso.html';
  box.append(el('b', `✅ Acesso de ${name} pronto. Anote a senha: ela aparece só agora.`));
  for (const [l, v] of [['Endereço', url], ['Usuário', user], ['Senha', password]]) {
    const row = el('div', null, { className: 'pt-row' });
    const b = el('button', 'Copiar', { type: 'button', className: 'sec' }); b.addEventListener('click', () => copy(v, b));
    row.append(el('small', l), el('input', null, { value: v, readOnly: true, ariaLabel: l }), b); box.append(row);
  }
  const text = `Olá, ${name}! Seu acesso ao painel da Promisa:\n\n1) Abra: ${url}\n2) Toque em "Sou sócio: entrar com usuário"\n3) Usuário: ${user}\n4) Senha: ${password}\n\nGuarde a senha em lugar seguro.`;
  box.append(el('a', '📲 Enviar no WhatsApp', { href: 'https://wa.me/?text=' + encodeURIComponent(text), target: '_blank', rel: 'noopener noreferrer', className: 'pt-wa' }));
  return box;
}

async function draw(root) {
  if (!root?.isConnected) return;
  let partners = [];
  try { partners = (await api('partner-list')).partners || []; }
  catch (error) { root.replaceChildren(el('div', '⚠️ ' + error.message, { className: 'card pub-warn' })); return; }
  root.replaceChildren();
  if (ui.fresh) root.append(credentialsBox(...ui.fresh));

  // Novo sócio
  const add = el('details', null, { className: 'card pt-new', open: !partners.length });
  add.append(el('summary', '➕ Criar acesso para um sócio'));
  const form = el('form', null, { className: 'pt-form' });
  const name = el('input', null, { placeholder: 'Nome (ex.: João)', required: true, maxLength: 60, ariaLabel: 'Nome do sócio' });
  const user = el('input', null, { placeholder: 'Usuário para entrar (ex.: joao)', required: true, maxLength: 30, autocapitalize: 'none', spellcheck: false, ariaLabel: 'Usuário' });
  name.addEventListener('input', () => { if (!user.dataset.touched) user.value = name.value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 30); });
  user.addEventListener('input', () => { user.dataset.touched = '1'; });
  const pass = el('input', null, { value: strongPassword(), required: true, minLength: 8, maxLength: 128, ariaLabel: 'Senha' });
  const regen = el('button', '🎲 Outra senha', { type: 'button', className: 'sec' }); regen.addEventListener('click', () => { pass.value = strongPassword(); });
  const passRow = el('div', null, { className: 'pt-pass' }); passRow.append(pass, regen);
  const mods = moduleChecks(['clients', 'mySites']);
  const send = el('button', '🔑 Criar acesso', { type: 'submit' });
  const lab = (t, input) => { const l = el('label'); l.append(el('small', t), input); return l; };
  form.append(lab('Nome', name), lab('Usuário', user), lab('Senha (pode trocar)', passRow), mods.box, send);
  form.addEventListener('submit', async e => {
    e.preventDefault(); send.disabled = true;
    try { const r = await api('partner-create', { name: name.value, user: user.value, password: pass.value, modules: mods.read() }); ui.fresh = [r.partner.name, r.partner.user, pass.value]; draw(root); }
    catch (error) { alert(error.message); send.disabled = false; }
  });
  add.append(form); root.append(add);

  // Lista
  if (!partners.length) { root.append(el('p', 'Nenhum sócio ainda.', { className: 'sub' })); return; }
  for (const p of partners) {
    const card = el('div', null, { className: 'card pt-card' + (p.active ? '' : ' is-paused') });
    const head = el('div', null, { className: 'pt-head' });
    const who = el('div'); who.append(el('b', `${p.active ? '🟢' : '⏸️'} ${p.name}`), el('br'), el('small', `usuário: ${p.user} · último acesso: ${when(p.lastLogin)}`, { className: 'sub' }));
    head.append(who); card.append(head);
    const chips = el('div', null, { className: 'pt-chips' });
    for (const id of p.modules) chips.append(el('span', label(id), { className: 'pt-chip' }));
    card.append(chips);
    const bar = el('div', null, { className: 'pt-actions' });
    const btn = (text, fn, cls = 'sec') => { const b = el('button', text, { type: 'button', className: cls }); b.addEventListener('click', async () => { b.disabled = true; try { await fn(); } catch (error) { alert(error.message); } b.disabled = false; }); bar.append(b); return b; };
    btn('✏️ Módulos', async () => { ui.open = ui.open === p.id ? '' : p.id; draw(root); });
    btn('🔑 Nova senha', async () => {
      const pw = strongPassword();
      if (!confirm(`Gerar nova senha para ${p.name}? A antiga para de funcionar e ele sai do painel agora.`)) return;
      await api('partner-update', { id: p.id, password: pw }); ui.fresh = [p.name, p.user, pw]; draw(root);
    });
    btn(p.active ? '⏸️ Pausar acesso' : '▶️ Reativar', async () => { await api('partner-update', { id: p.id, active: !p.active }); ui.fresh = null; draw(root); });
    btn('🗑️ Apagar', async () => { if (!confirm(`Apagar o acesso de ${p.name}? Ele sai do painel agora. Os dados do negócio não são apagados.`)) return; await api('partner-delete', { id: p.id }); ui.fresh = null; draw(root); });
    card.append(bar);
    if (ui.open === p.id) {
      const edit = moduleChecks(p.modules);
      const save = el('button', 'Salvar módulos', { type: 'button' });
      save.addEventListener('click', async () => { save.disabled = true; try { await api('partner-update', { id: p.id, modules: edit.read() }); ui.open = ''; ui.fresh = null; draw(root); } catch (error) { alert(error.message); save.disabled = false; } });
      const box = el('div', null, { className: 'pt-edit' }); box.append(edit.box, save, el('p', 'Ao salvar, ele sai do painel e entra de novo já com os módulos novos.', { className: 'sub' }));
      card.append(box);
    }
    root.append(card);
  }
}

export function mount(root) { if (root) draw(root); }
if (typeof window !== 'undefined') window.promisaPartners = { mount };
