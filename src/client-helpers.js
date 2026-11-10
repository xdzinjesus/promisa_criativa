// Funções puras do módulo "Clientes" do painel (sem DOM), testadas em tests/client-helpers.test.mjs.
// O painel recebe estas funções pela variável global window.promisaClients (src/client-helpers-panel.js).

export const CLOSED_STAGES = ['Fechado', 'Perdido'];
// Ações que contam como "precisa de ação" (o resto é só atalho, como "Ver site").
export const ACTION_KEYS = ['pay', 'attach', 'demo', 'phone', 'followup'];
export const FOLLOWUP_AFTER_MS = 2 * 24 * 60 * 60 * 1000;

const digitsOf = value => String(value ?? '').replace(/\D/g, '');

export function isActiveStage(stage) {
  return !CLOSED_STAGES.includes(stage);
}

// (49) 98824-0164 / (49) 3442-6343. Aceita com ou sem 55 na frente; outros formatos ficam como foram digitados.
export function formatPhoneBR(value) {
  let d = digitsOf(value);
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) d = d.slice(2);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return String(value ?? '').trim();
}

// Mesmo critério de contactLink() no painel: até 11 dígitos recebe o 55 do Brasil.
export function whatsappLink(contact, text = '') {
  const d = digitsOf(contact);
  if (!d) return '';
  const base = `https://wa.me/${d.length <= 11 ? '55' + d : d}`;
  return text ? `${base}?text=${encodeURIComponent(text)}` : base;
}

export function formatBRL(value) {
  return (+value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0, minimumFractionDigits: 0 });
}

export function followUpMessage(lead) {
  const nome = String(lead?.client || '').trim();
  const link = String(lead?.demoUrl || '').trim();
  return `Oi${nome ? ', ' + nome : ''}! Conseguiu ver a demonstração do seu site?${link ? ' ' + link : ''}`;
}

/**
 * Próximo passo sugerido para um cliente (um único botão no cartão).
 * ctx: { stage, siteId, demoReady, entrega: { total, complete } | null, now }
 * Retorna { key, label, click, args } ou { key, label, href } (links), ou null.
 */
export function nextClientAction(lead, ctx = {}) {
  if (!lead) return null;
  const id = lead.id;
  const stage = ctx.stage || lead.stage;
  const siteId = ctx.siteId || '';
  const hasPhone = digitsOf(lead.contact).length >= 8;
  if (stage === 'Perdido') return null;
  if (stage === 'Fechado' && !lead.paid) return { key: 'pay', label: '💰 Marcar como pago', click: 'pay', args: [id] };
  if (stage === 'Fechado' && ctx.entrega && ctx.entrega.total > 0 && !ctx.entrega.complete) return { key: 'entregas', label: '📦 Ver entregas', click: 'openEntregas', args: [id] };
  if (!siteId) return { key: 'attach', label: '＋ Anexar site', click: 'openClientSheet', args: [id, 'site'] };
  if (ctx.demoReady && !lead.demoSentAt) return { key: 'demo', label: '📤 Enviar demonstração', click: 'sendDemoOne', args: [id] };
  if (!hasPhone) return { key: 'phone', label: '📞 Adicionar telefone', click: 'openClientSheet', args: [id, 'dados'] };
  if (stage !== 'Fechado' && lead.demoSentAt) {
    const sent = Date.parse(lead.demoSentAt), now = ctx.now ?? Date.now();
    if (Number.isFinite(sent) && now - sent > FOLLOWUP_AFTER_MS) return { key: 'followup', label: '💬 Cobrar retorno', href: whatsappLink(lead.contact, followUpMessage(lead)) };
  }
  return { key: 'view', label: '👁 Ver site', click: 'openClientSite', args: [siteId] };
}

export function needsAction(action) {
  return !!action && ACTION_KEYS.includes(action.key);
}

/**
 * Totais da faixa de resumo. stageOf(lead) devolve a etapa normalizada; actionOf(lead) o próximo passo.
 */
export function clientSummary(leads, stageOf = l => l.stage, actionOf = () => null) {
  let negotiation = 0, receivable = 0, needAction = 0;
  for (const lead of Array.isArray(leads) ? leads : []) {
    const stage = stageOf(lead), value = +lead.value || 0;
    if (isActiveStage(stage)) negotiation += value;
    else if (stage === 'Fechado' && !lead.paid) receivable += value;
    if (needsAction(actionOf(lead))) needAction++;
  }
  return { negotiation, receivable, needAction };
}
