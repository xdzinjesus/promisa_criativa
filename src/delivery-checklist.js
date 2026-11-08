// Checklist de entregas por plano (clientes fechados). Dados em lead.entrega:
// { plano, feitos: { <idDoItem>: 'AAAA-MM-DD' }, obs }
export const DELIVERY_PLANS = { essencial: 'Essencial', profissional: 'Profissional', premium: 'Premium' };
const g = (id, label, items) => ({ id, label, items: items.map(([itemId, text]) => ({ id: itemId, label: text })) });
const FECHAMENTO = g('fechamento', 'Fechamento', [
  ['aceite', 'Orçamento aprovado pelo cliente'], ['entrada', 'Entrada (50%) ou 1ª parcela recebida'],
  ['briefing', 'Formulário de briefing respondido'], ['materiais', 'Logo, fotos e textos recebidos (ou dispensados)']]);
const DOMINIO = g('dominio', 'Domínio e hospedagem', [
  ['dominio-compra', 'Domínio registrado (registro.br)'], ['hospedagem', 'Hospedagem configurada'],
  ['dominio-aponta', 'Domínio apontado e com cadeado (HTTPS)']]);
const SITE = g('site', 'Site', [
  ['site-ia', 'Site gerado com a IA'], ['revisao-1', '1ª revisão com o cliente'], ['ajustes', 'Ajustes finais aplicados'],
  ['teste', 'Testado no celular e no computador (WhatsApp, links, Maps)'], ['publicado', 'Site publicado']]);
const PROFISSIONAL = g('profissional', 'Profissional', [
  ['catalogo', 'Catálogo preenchido'], ['form-orcamento', 'Formulário de orçamento testado'],
  ['textos', 'Textos aprovados pelo cliente'], ['search-console', 'Google Search Console + sitemap enviados']]);
const MARCA = g('marca', 'Marca', [
  ['logo', 'Logo e identidade aprovados'], ['manual', 'Manual da marca entregue'], ['cartao', 'Cartão digital + QR Code']]);
const GOOGLE = g('google', 'Google e redes', [
  ['artes', '15 artes do Instagram entregues'], ['insta-capa', 'Capa e destaques do Instagram'],
  ['google-perfil', 'Perfil da Empresa no Google criado'], ['whatsapp-auto', 'Mensagens automáticas do WhatsApp Business']]);
const PREMIUM = g('premium', 'Premium', [
  ['email', 'E-mail profissional configurado'], ['admin', 'Área administrativa configurada'],
  ['relatorio', 'Relatório de visitas ativado'], ['manutencao', '3 meses de manutenção iniciados (anotar data)']]);
const ENCERRAMENTO = g('encerramento', 'Encerramento', [
  ['pagamento-final', 'Pagamento final recebido'], ['entregue', 'Cliente avisado e acessos entregues'],
  ['avaliacao', 'Pedido de avaliação/depoimento']]);
const BY_PLAN = {
  essencial: [FECHAMENTO, DOMINIO, SITE, ENCERRAMENTO],
  profissional: [FECHAMENTO, DOMINIO, SITE, PROFISSIONAL, ENCERRAMENTO],
  premium: [FECHAMENTO, DOMINIO, SITE, PROFISSIONAL, MARCA, GOOGLE, PREMIUM, ENCERRAMENTO],
};
export function deliveryGroups(plano) { return Object.hasOwn(BY_PLAN, plano) ? BY_PLAN[plano] : []; }
export function deliveryItems(plano) { return deliveryGroups(plano).flatMap(group => group.items); }
export function deliveryProgress(entrega) {
  const items = deliveryItems(entrega?.plano);
  const feitos = entrega?.feitos && typeof entrega.feitos === 'object' ? entrega.feitos : {};
  const done = items.filter(item => Object.hasOwn(feitos, item.id)).length;
  return { done, total: items.length, pct: items.length ? Math.round(done / items.length * 100) : 0, complete: items.length > 0 && done === items.length };
}
