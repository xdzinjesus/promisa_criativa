// Bloco "⚡ Dados ao vivo" na janela de publicação (sites feitos à mão com área administrativa própria).
// Descobre sozinho se o site tem área administrativa e, se for compatível, já liga na primeira vez.
import { detectAdmin, editEntry } from '../lib/site-admin-detect.js';

const el = (tag, text, props = {}) => Object.assign(document.createElement(tag), text == null ? {} : { textContent: text }, props);
const when = ms => ms ? new Date(ms).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }) : 'ainda não';

async function api(action, extra = {}) {
  const response = await fetch('/api/meu-site', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', cache: 'no-store', body: JSON.stringify({ action, ...extra }) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Não foi possível concluir.');
  return body;
}
async function copy(text, button) {
  try { await navigator.clipboard.writeText(text); const old = button.textContent; button.textContent = 'Copiado ✓'; setTimeout(() => { button.textContent = old; }, 1500); } catch { prompt('Copie:', text); }
}

// Frase simples com o que o sistema encontrou no site.
export function describe(d) {
  if (!d) return { tone: 'demo-help', text: '' };
  const where = d.entry ? ` (abre em ${d.entry})` : '';
  const how = d.saves.includes('download') ? 'gerando um index.html novo para baixar' : 'no navegador';
  if (d.external) return { tone: 'demo-help', text: `ℹ️ A área administrativa deste site já salva num servidor próprio (Firebase/Supabase). Não precisa ligar nada.` };
  if (d.ok) return { tone: 'pub-ok', text: `🔎 Área administrativa encontrada${where}. Ela salva ${how}: compatível ✅` };
  if (d.hasAdmin && d.unsupported) return { tone: 'pub-warn', text: `⚠️ Área administrativa encontrada${where}, mas ela guarda em IndexedDB, que ainda não dá para capturar. Me chame para adaptar.` };
  if (d.hasAdmin) return { tone: 'pub-warn', text: `⚠️ Área administrativa encontrada${where}, mas não descobrimos onde ela salva. Você pode ligar mesmo assim e testar.` };
  return { tone: 'demo-help', text: 'Este site não tem área administrativa: não precisa ligar nada.' };
}

export function mount(root, siteId, getUrl = () => '', files = []) {
  if (!root || !siteId) return;
  root.className = 'pub-data';
  const found = Array.isArray(files) && files.length ? detectAdmin(files) : null;
  const entry = editEntry(found);
  let tried = false;
  const draw = async (fresh = null, auto = false) => {
    root.replaceChildren(el('h3', '⚡ Dados ao vivo (área administrativa do site)'), el('p', 'Carregando…', { className: 'demo-help' }));
    let s;
    try { s = await api('admin-data-status', { siteId }); } catch (error) { root.append(el('p', '⚠️ ' + error.message, { className: 'pub-warn' })); return; }
    // Automático: na primeira vez que o site compatível é aberto aqui, liga sozinho (se você desligar, fica desligado).
    if (!fresh && !tried && found?.ok && !s.exists) {
      tried = true;
      try { return draw((await api('admin-data-enable', { siteId })).password, true); } catch { /* segue mostrando o botão */ }
    }
    root.replaceChildren(el('h3', '⚡ Dados ao vivo (área administrativa do site)'));
    const info = describe(found);
    if (info.text) root.append(el('p', info.text, { className: info.tone }));
    root.append(el('p', 'Ligado, o que o cliente mudar na área administrativa do site vale para todos que abrirem o site, sem você mexer no código.', { className: 'demo-help' }));
    if (fresh) {
      const url = getUrl();
      const editUrl = url ? url.replace(/\/$/, '') + (entry.startsWith('#') ? '/' + entry : entry) : '';
      const box = el('div', null, { className: 'pub-steps' });
      box.append(el('p', auto ? '✅ Liguei sozinho, porque o site é compatível. Anote a senha: ela aparece só agora.' : '✅ Ligado. Anote a senha: ela aparece só agora.'));
      const row = (label, value) => { const r = el('div', null, { className: 'demo-link-row' }); const input = el('input', null, { value, readOnly: true, ariaLabel: label }); const b = el('button', 'Copiar', { type: 'button', className: 'sec' }); b.addEventListener('click', () => copy(value, b)); r.append(input, b); return r; };
      box.append(row('Senha de publicação', fresh));
      if (editUrl) box.append(row('Endereço de edição', editUrl));
      const text = `Olá! Para atualizar o seu site sozinho:\n\n1) Abra: ${editUrl || '(o endereço do seu site) ' + entry}\n2) Use a área administrativa do site normalmente e salve como sempre\n3) Se aparecer "🚀 Publicar para todos", toque nele. Quando pedir, digite a senha: ${fresh}\n\nEm até 1 minuto aparece para todo mundo.`;
      box.append(el('a', '📲 Enviar instruções no WhatsApp', { href: 'https://wa.me/?text=' + encodeURIComponent(text), target: '_blank', rel: 'noopener noreferrer' }));
      box.append(el('p', url ? 'Importante: toque em "Atualizar site" acima uma vez, para o modo edição entrar no ar.' : 'Importante: publique o site acima. O modo edição entra junto.', { className: 'demo-help' }));
      root.append(box);
    }
    const bar = el('div', null, { className: 'demo-link-actions' });
    if (s.enabled) {
      root.append(el('p', `🟢 Ligado · última publicação do cliente: ${when(s.updatedAt)} · ${s.keys} dado(s) guardado(s)`, { className: 'pub-ok' }));
      const renew = el('button', '🔄 Gerar nova senha', { type: 'button', className: 'sec' });
      renew.addEventListener('click', async () => { if (!confirm('Gerar nova senha? A antiga para de funcionar.')) return; renew.disabled = true; try { draw((await api('admin-data-enable', { siteId })).password); } catch (error) { alert(error.message); renew.disabled = false; } });
      const off = el('button', '⛔ Desligar', { type: 'button', className: 'sec' });
      off.addEventListener('click', async () => { if (!confirm('Desligar a edição pelo cliente? Os dados já publicados continuam no site.')) return; off.disabled = true; try { await api('admin-data-disable', { siteId }); draw(); } catch (error) { alert(error.message); off.disabled = false; } });
      bar.append(renew, off);
    } else {
      const on = el('button', '⚡ Ligar dados ao vivo', { type: 'button', className: found && !found.hasAdmin ? 'sec' : '' });
      on.addEventListener('click', async () => { on.disabled = true; try { draw((await api('admin-data-enable', { siteId })).password); } catch (error) { alert(error.message); on.disabled = false; } });
      bar.append(on);
    }
    root.append(bar);
  };
  draw();
}

if (typeof window !== 'undefined') window.promisaSiteData = { mount, detect: detectAdmin };
