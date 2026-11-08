// Páginas HTML do diagnóstico (relatório público e mensagens). Tudo o que vem do site analisado
// passa por esc() antes de entrar no HTML.
export const REPORT_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data: https:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
export const WHATSAPP = 'https://wa.me/5549933811600';
// Mesma regra de lib/share-store.js (código do link de demonstração).
const DEMO_TOKEN = /^[A-Za-z0-9_-]{22}$/;

export const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

// Aceita só o link de demonstração da Promisa. Devolve '' (sem demo), o caminho "/demo/<código>/" ou null (inválido).
export function normalizeDemoUrl(value) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string') return null;
  const match = /^(?:https:\/\/www\.promisa\.online)?\/demo\/([A-Za-z0-9_-]{22})\/?$/.exec(value.trim());
  return match && DEMO_TOKEN.test(match[1]) ? `/demo/${match[1]}/` : null;
}

const STYLE = `*{box-sizing:border-box}body{margin:0;background:#09080e;color:#f3f1f8;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;line-height:1.55;-webkit-text-size-adjust:100%}
main{max-width:640px;margin:0 auto;padding:28px 16px 48px}
.brand{font-size:.8rem;letter-spacing:.08em;text-transform:uppercase;color:#a78bfa;font-weight:700;margin:0 0 6px}
h1{font-size:1.45rem;line-height:1.25;margin:0 0 6px}.site{margin:0;color:#aaa3b9;overflow-wrap:anywhere}.site b{color:#f3f1f8}
.grade{margin:22px 0;padding:22px 18px;border:1px solid #ffffff1f;border-radius:20px;background:#131019;text-align:center}
.grade .n{font-size:3.4rem;font-weight:800;line-height:1}.grade .n small{font-size:1.2rem;color:#aaa3b9;font-weight:600}
.grade p{margin:10px 0 0;color:#cfc9dc}.g-bom .n{color:#4ade80}.g-atencao .n{color:#fbbf24}.g-ruim .n{color:#f87171}
.counts{display:flex;justify-content:center;gap:14px;flex-wrap:wrap;margin-top:12px;font-size:.92rem;color:#cfc9dc}
h2{font-size:1.1rem;margin:28px 0 12px}
.item{margin:0 0 10px;padding:14px 16px;border:1px solid #ffffff1f;border-left-width:5px;border-radius:14px;background:#131019}
.item.bom{border-left-color:#22c55e}.item.atencao{border-left-color:#f59e0b}.item.ruim{border-left-color:#ef4444}.item.desconhecido{border-left-color:#6b6580}
.item h3{margin:0 0 4px;font-size:1rem;display:flex;gap:8px;justify-content:space-between;align-items:baseline;flex-wrap:wrap}
.item h3 span{font-size:.82rem;font-weight:600;color:#cfc9dc;white-space:nowrap}
.item p{margin:0;color:#aaa3b9;font-size:.94rem;overflow-wrap:anywhere}
.promisa{margin-top:30px;padding:22px 18px;border-radius:20px;background:linear-gradient(160deg,#2a1457,#131019);border:1px solid #7c3aed66}
.promisa h2{margin-top:0}.promisa ul{margin:0 0 18px;padding-left:0;list-style:none;display:grid;gap:8px}.promisa li{color:#e8e3f3}
.btns{display:grid;gap:10px}.btn{display:block;text-align:center;padding:14px 18px;min-height:48px;border-radius:12px;background:#7c3aed;color:#fff;text-decoration:none;font-weight:700}
.btn.alt{background:transparent;border:1px solid #a78bfa;color:#e9ddff}.btn.wa{background:#16a34a}
footer{margin-top:26px;color:#8a8399;font-size:.82rem;text-align:center}`;

const shell = (title, body) => `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><title>${esc(title)}</title><style>${STYLE}</style></head><body>${body}</body></html>`;

export function messagePage(title, text) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#09080e;color:#f3f1f8;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;padding:24px}main{max-width:440px;text-align:center;border:1px solid #ffffff1f;border-radius:20px;padding:36px 28px;background:#131019}h1{font-size:1.4rem;margin:0 0 10px}p{color:#aaa3b9;line-height:1.6;margin:0 0 22px}a{display:inline-block;padding:12px 20px;border-radius:12px;background:#7c3aed;color:#fff;text-decoration:none;font-weight:600}</style></head><body><main><h1>${esc(title)}</h1><p>${esc(text)}</p><a href="${WHATSAPP}" rel="noopener noreferrer">Falar com a Promisa</a></main></body></html>`;
}

const STATUS = { bom: '🟢 Bom', atencao: '🟡 Pode melhorar', ruim: '🔴 Precisa de atenção', desconhecido: '⚪ Não medido' };
const formatScore = score => (Number.isFinite(score) ? score : 0).toFixed(1).replace('.', ',');
const longDate = ms => new Date(ms).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' });

export function renderReport(report) {
  const items = Array.isArray(report.items) ? report.items : [];
  const count = status => items.filter(item => item.status === status).length;
  const score = Number(report.score) || 0;
  const level = score >= 8 ? 'bom' : score >= 5 ? 'atencao' : 'ruim';
  const bad = count('ruim') + count('atencao');
  const verdict = level === 'bom' ? 'O site está bem. Ainda há detalhes que podem melhorar.' : level === 'atencao' ? 'O site funciona, mas está deixando de ganhar clientes por alguns motivos.' : 'O site precisa de atenção: hoje ele pode estar afastando clientes.';
  const demo = normalizeDemoUrl(report.demoUrl);
  const message = `Olá! Vi o diagnóstico do site ${report.host || ''} e quero saber como melhorar.`;
  const itemHtml = items.map(item => {
    const status = Object.hasOwn(STATUS, item.status) ? item.status : 'desconhecido';
    return `<article class="item ${status}"><h3>${esc(item.label)}<span>${STATUS[status]}</span></h3><p>${esc(item.text)}</p></article>`;
  }).join('');
  const body = `<main>
<p class="brand">Promisa Criativa</p>
<h1>Diagnóstico gratuito do site</h1>
<p class="site"><b>${esc(report.host)}</b> · ${esc(longDate(report.createdAt))}</p>
<section class="grade g-${level}" aria-label="Nota geral"><div class="n">${formatScore(score)}<small> / 10</small></div><p>${esc(verdict)}</p>
<div class="counts"><span>🟢 ${count('bom')} ${count('bom') === 1 ? 'bom' : 'bons'}</span><span>🟡 ${count('atencao')} a melhorar</span><span>🔴 ${count('ruim')} com problema</span></div></section>
<h2>O que encontramos${bad ? ` (${bad} ponto${bad > 1 ? 's' : ''} para melhorar)` : ''}</h2>
${itemHtml}
<section class="promisa"><h2>Como ficaria com a Promisa</h2>
<ul><li>⚡ Site rápido, que abre sem demora no celular</li><li>🔒 Cadeado de segurança em todas as páginas</li><li>💬 Botão do WhatsApp sempre à vista</li><li>🔎 Pronto para aparecer no Google</li><li>📍 Mapa e endereço fáceis de achar</li></ul>
<div class="btns">${demo ? `<a class="btn" href="${esc(demo)}" rel="noopener noreferrer">Ver demonstração do novo site</a>` : ''}<a class="btn wa" href="${WHATSAPP}?text=${encodeURIComponent(message)}" rel="noopener noreferrer">Falar com a Promisa no WhatsApp</a></div></section>
<footer>Análise automática feita em ${esc(longDate(report.createdAt))}. Resultados podem variar. Recursos que aparecem só depois de a página carregar podem não ser detectados.</footer>
</main>`;
  return shell(`Diagnóstico do site ${report.host || ''}`, body);
}
