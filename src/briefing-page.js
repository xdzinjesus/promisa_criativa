import { BRIEFING_INTRO, BRIEFING_QUESTIONS, BRIEFING_LIMITS, validateAnswer } from './briefing-questions.js';

// Página pública do briefing: lê o código da URL, mostra o formulário e envia as respostas.
const $ = id => document.getElementById(id);
const token = (location.pathname.match(/^\/briefing\/([A-Za-z0-9_-]{22})\/?$/) || [])[1] || '';
const DRAFT_KEY = 'promisa-briefing-draft:' + token;
const states = ['loading', 'form', 'answered', 'unavailable', 'success'];
let startedAt = Date.now(), submitting = false;

function show(name) {
  for (const state of states) $('state-' + state).hidden = state !== name;
  if (name !== 'loading') {
    const heading = $('state-' + name).querySelector('h1');
    heading?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }
}
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
const storage = {
  read() { try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch { return null; } },
  write(value) { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(value)); } catch { /* rascunho é opcional */ } },
  clear() { try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignora */ } }
};

function buildQuestions() {
  const root = $('b-questions');
  BRIEFING_QUESTIONS.forEach((question, index) => {
    const box = el('fieldset', 'q');
    box.id = 'q-' + question.id;
    const legend = el('legend', 'q-label');
    legend.append(el('span', 'q-num', `Pergunta ${index + 1} de ${BRIEFING_QUESTIONS.length}`), document.createTextNode(question.label));
    if (question.required) { const star = el('span', 'q-req', ' *'); star.setAttribute('aria-hidden', 'true'); legend.append(star); }
    else legend.append(el('span', 'q-help-inline', ' (opcional)'));
    box.append(legend);
    const describedBy = [];
    if (question.help) { const help = el('p', 'q-help', question.help); help.id = `help-${question.id}`; describedBy.push(help.id); box.append(help); }
    const error = el('p', 'q-error'); error.id = `err-${question.id}`; error.setAttribute('role', 'alert'); describedBy.push(error.id);
    if (question.type === 'text') {
      const area = el('textarea'); area.name = question.id; area.rows = 4; area.maxLength = BRIEFING_LIMITS.text;
      area.setAttribute('aria-label', question.label); area.setAttribute('aria-describedby', describedBy.join(' '));
      if (question.required) area.required = true;
      box.append(area);
    } else {
      const list = el('div', 'opts');
      const type = question.type === 'radio' ? 'radio' : 'checkbox';
      for (const option of question.options) {
        const label = el('label', 'opt'), input = el('input'); input.type = type; input.name = question.id; input.value = option;
        label.append(input, el('span', '', option)); list.append(label);
      }
      if (question.other) {
        const label = el('label', 'opt'), input = el('input'); input.type = 'checkbox'; input.name = question.id + '-other-on';
        label.append(input, el('span', '', 'Outro'));
        const text = el('input'); text.type = 'text'; text.name = question.id + '-other'; text.maxLength = BRIEFING_LIMITS.other; text.hidden = true;
        text.className = 'other-text'; text.setAttribute('aria-label', 'Descreva o outro: ' + question.label); text.placeholder = 'Descreva aqui';
        input.addEventListener('change', () => { text.hidden = !input.checked; if (input.checked) text.focus(); });
        list.append(label, text);
      }
      box.append(list);
    }
    box.append(error);
    root.append(box);
  });
}

function collect() {
  const answers = {};
  for (const question of BRIEFING_QUESTIONS) {
    const box = $('q-' + question.id);
    if (question.type === 'text') answers[question.id] = box.querySelector('textarea').value;
    else {
      const selected = [...box.querySelectorAll(`input[name="${question.id}"]:checked`)].map(input => input.value);
      const other = box.querySelector(`input[name="${question.id}-other-on"]`)?.checked ? box.querySelector(`input[name="${question.id}-other"]`).value : '';
      answers[question.id] = { selected, other };
    }
  }
  return answers;
}

function restore(draft) {
  if (!draft || typeof draft !== 'object') return;
  for (const question of BRIEFING_QUESTIONS) {
    const value = draft[question.id], box = $('q-' + question.id);
    if (question.type === 'text') { if (typeof value === 'string') box.querySelector('textarea').value = value.slice(0, BRIEFING_LIMITS.text); continue; }
    if (!value || !Array.isArray(value.selected)) continue;
    for (const input of box.querySelectorAll(`input[name="${question.id}"]`)) input.checked = value.selected.includes(input.value);
    if (question.other && typeof value.other === 'string' && value.other) {
      const on = box.querySelector(`input[name="${question.id}-other-on"]`), text = box.querySelector(`input[name="${question.id}-other"]`);
      on.checked = true; text.hidden = false; text.value = value.other.slice(0, BRIEFING_LIMITS.other);
    }
  }
}

function answered(question, value) {
  const result = validateAnswer({ ...question, required: true }, 0, value);
  return result.ok;
}
function updateProgress() {
  const answers = collect();
  const count = BRIEFING_QUESTIONS.filter(question => answered(question, answers[question.id])).length;
  const total = BRIEFING_QUESTIONS.length;
  $('b-progress-label').textContent = `${count} de ${total} respondidas`;
  const bar = $('b-progress').querySelector('[role=progressbar]');
  bar.setAttribute('aria-valuenow', String(count));
  $('b-bar-fill').style.width = (count / total * 100) + '%';
  return answers;
}

let saveTimer = 0;
function onChange(event) {
  const box = event.target.closest?.('.q');
  if (box) { box.classList.remove('has-error'); $(`err-${box.id.slice(2)}`).textContent = ''; }
  $('b-submit-error').textContent = '';
  const answers = updateProgress();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => storage.write(answers), 400);
}

async function submit(event) {
  event.preventDefault();
  if (submitting) return;
  const answers = collect();
  let first = null;
  BRIEFING_QUESTIONS.forEach((question, index) => {
    const result = validateAnswer(question, index, answers[question.id]);
    const box = $('q-' + question.id);
    box.classList.toggle('has-error', !result.ok);
    $('err-' + question.id).textContent = result.ok ? '' : result.error;
    if (!result.ok && !first) first = box;
  });
  if (first) {
    first.scrollIntoView({ behavior: 'smooth', block: 'center' });
    (first.querySelector('textarea, input:not([type=text]), input'))?.focus({ preventScroll: true });
    $('b-submit-error').textContent = 'Confira as perguntas marcadas em vermelho.';
    return;
  }
  submitting = true;
  const button = $('b-submit'); button.disabled = true;
  $('b-submit-error').textContent = '';
  try {
    const response = await fetch('/api/briefing', {
      method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin', referrerPolicy: 'no-referrer',
      body: JSON.stringify({ token, answers, website: $('b-website').value, startedAt })
    });
    const data = await response.json().catch(() => ({}));
    if (response.ok && data.ok) { clearTimeout(saveTimer); storage.clear(); show('success'); return; }
    if (response.status === 409) { storage.clear(); show('answered'); return; }
    if (response.status === 404) { show('unavailable'); return; }
    $('b-submit-error').textContent = data.error || 'Não foi possível enviar agora. Tente novamente.';
    if (data.field && $('q-' + data.field)) { $('q-' + data.field).classList.add('has-error'); $('err-' + data.field).textContent = data.error; }
    if (response.status === 400 && /segundos/.test(data.error || '')) startedAt -= 4000;
  } catch {
    $('b-submit-error').textContent = 'Sem conexão. Verifique a internet e tente de novo; suas respostas continuam aqui.';
  } finally {
    submitting = false; button.disabled = false;
  }
}

async function start() {
  if (!token) return show('unavailable');
  let info;
  try {
    const response = await fetch('/api/briefing?token=' + encodeURIComponent(token), { credentials: 'same-origin', referrerPolicy: 'no-referrer', cache: 'no-store' });
    if (!response.ok) throw new Error('status');
    info = await response.json();
  } catch {
    $('state-loading').querySelector('.b-status').textContent = 'Não foi possível carregar o formulário. Verifique a internet e recarregue a página.';
    return;
  }
  if (info.state === 'answered') return show('answered');
  if (info.state !== 'open') return show('unavailable');
  // Usa o relógio do servidor para o tempo mínimo de preenchimento (evita erro por relógio errado).
  startedAt = Number.isFinite(info.serverTime) ? info.serverTime : Date.now();
  $('b-intro').textContent = BRIEFING_INTRO;
  buildQuestions();
  restore(storage.read());
  $('b-progress').hidden = false;
  updateProgress();
  const form = $('b-form');
  form.addEventListener('input', onChange);
  form.addEventListener('change', onChange);
  form.addEventListener('submit', submit);
  show('form');
}
start();
