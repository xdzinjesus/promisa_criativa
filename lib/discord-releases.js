// Histórico de atualizações (canal #historico do Discord). Módulo puro, sem rede.
// PARA ACRESCENTAR UMA NOVA ATUALIZAÇÃO: adicione UMA linha no fim de RELEASES (número do PR, data de publicação,
// tipo, título e uma frase simples do que mudou para o dono). No próximo "Criar canais" / /configurar o robô
// posta só as que ainda não estão no canal (ele reconhece pelo rodapé "histórico · #número").
export const REPO_URL = 'https://github.com/xdzinjesus/promisa_criativa';
export const KINDS = { novidade: '✨', correcao: '🛠️', seguranca: '🔒', desempenho: '⚡' };
export const HISTORY_MARK = 'histórico';
export const HISTORY_HEADER = { title: '📜 Histórico de atualizações da Promisa', description: 'Aqui estão, do mais antigo ao mais novo, todas as melhorias já feitas no sistema. Toque no número para ver os detalhes no GitHub.' };
// Limites do Discord: 10 embeds e 6000 caracteres por mensagem. Folga para o nome do robô (17 caracteres por embed).
const MAX_EMBEDS = 10, MAX_MESSAGE_CHARS = 5500, MAX_DESCRIPTION = 3800, MAX_PER_EMBED = 15;

export const release = (n, at, kind, t, why) => ({ n, at, kind, t, why });
export const RELEASES = [
  release(1, '2026-11-07T22:14:23Z', 'novidade', 'Repaginação do site e ambiente multiagente do Claude Code', 'O site da Promisa ganhou um visual novo e o projeto ficou preparado para o Claude trabalhar com vários ajudantes ao mesmo tempo.'),
  release(2, '2026-11-07T22:30:51Z', 'correcao', 'Mostra a causa real quando o armazenamento online falha', 'Quando o armazenamento online dá problema, o painel agora mostra o motivo verdadeiro em vez de um aviso vago.'),
  release(3, '2026-11-07T23:02:48Z', 'correcao', 'Corrige a sincronização online que falhava em todo salvamento', 'Consertei um erro que fazia a sincronização online falhar a cada salvamento. Agora seus dados sobem normalmente.'),
  release(4, '2026-11-07T23:21:07Z', 'novidade', 'Links de demonstração com validade para sites de clientes', 'Dá para gerar um link de demonstração do site de um cliente que vale por alguns dias e depois expira sozinho.'),
  release(5, '2026-11-07T23:28:13Z', 'correcao', 'Corrige o link de demonstração com barra no final', 'O link de demonstração com uma barra no final do endereço voltou a abrir direitinho.'),
  release(6, '2026-11-08T13:20:43Z', 'seguranca', 'Segurança: cabeçalhos, robots.txt e configurações do projeto', 'Reforcei a proteção do site com configurações de segurança que dificultam usos indevidos.'),
  release(10, '2026-11-08T13:51:13Z', 'seguranca', 'LGPD: nova política de privacidade e direitos do titular', 'O site ganhou uma política de privacidade nova (LGPD) que explica como cada pessoa pode pedir ou apagar os próprios dados.'),
  release(11, '2026-11-08T14:03:43Z', 'correcao', 'Corrige os botões de anexar do painel e prepara a criptografia (desativada)', 'Os botões de anexar arquivos do painel voltaram a funcionar, e deixei pronta uma proteção extra dos dados (por enquanto desligada).'),
  release(12, '2026-11-08T15:07:44Z', 'novidade', 'Envio de demonstrações pelo WhatsApp com fila e indicador de enviado', 'Dá para enviar a demonstração pelo WhatsApp, com fila de envios e uma marca mostrando o que já foi enviado.'),
  release(13, '2026-11-08T15:56:43Z', 'novidade', 'Painel administrativo mais simples e pensado para o celular', 'O painel ficou mais simples e muito mais fácil de usar no celular.'),
  release(14, '2026-11-08T17:07:03Z', 'novidade', 'Formulário de briefing do cliente (página pública + painel)', 'O cliente responde o briefing por um link público e você vê as respostas no painel.'),
  release(15, '2026-11-08T17:22:23Z', 'novidade', 'Anima o P do topo do site (mouse e toque)', 'O P do topo do site ganhou uma animação que reage ao mouse e ao toque.'),
  release(16, '2026-11-08T18:26:00Z', 'novidade', 'Projetos em destaque pelo painel, destaque do Instagram e animação do P no iPhone', 'Você escolhe pelo painel quais projetos aparecem em destaque no site, e a animação do P passou a funcionar também no iPhone.'),
  release(17, '2026-11-08T19:25:08Z', 'novidade', 'Seção Planos no site (sem preços, valor sob consulta)', 'O site ganhou uma seção de Planos, sem preços: o valor é combinado com o cliente.'),
  release(18, '2026-11-08T19:38:34Z', 'novidade', 'Prompts de IA por plano, lista de entregas e ajustes nos planos', 'Cada plano agora tem textos prontos para a IA e a lista do que é entregue ao cliente.'),
  release(19, '2026-11-08T20:22:33Z', 'seguranca', 'Entrar no painel com Face ID / digital (passkeys)', 'Dá para entrar no painel com Face ID ou digital, sem digitar senha.'),
  release(20, '2026-11-08T22:15:28Z', 'desempenho', 'Reduz o uso da cota do Vercel Blob pelo painel', 'O painel passou a gastar bem menos da cota gratuita de armazenamento na nuvem.'),
  release(21, '2026-11-08T22:35:01Z', 'novidade', 'Painel como app no celular e contador de visitas sem cookies', 'O painel pode ser instalado como um app no celular, e o site conta as visitas sem usar cookies.'),
  release(22, '2026-11-08T23:19:15Z', 'desempenho', 'Economiza espaço: separa dados e arquivos dos sites na nuvem', 'Os dados e os arquivos dos sites passaram a ficar separados na nuvem, o que economiza espaço.'),
  release(23, '2026-11-09T00:04:32Z', 'novidade', 'Diagnóstico grátis do site do cliente', 'Dá para criar um diagnóstico grátis do site de um cliente e mandar o link do relatório.'),
  release(24, '2026-11-09T00:31:08Z', 'novidade', 'Publicar site do cliente na Cloudflare Pages pelo painel', 'Você publica o site do cliente na internet direto pelo painel, sem mexer em nada técnico.'),
  release(25, '2026-11-09T03:16:17Z', 'novidade', 'Integração com o Discord: avisos automáticos e comandos', 'O Discord passou a avisar sozinho o que acontece (briefings, demonstrações, diagnósticos) e a receber comandos.'),
  release(38, '2026-11-11T13:26:25Z', 'novidade', 'P animado mais fluido e aba Instagram com análises', 'O P da página inicial gira suave ao clicar, e a aba Instagram do painel ficou mais bonita, com dicas automáticas, melhor dia e formato para postar e posts campeões.'),
  release(39, '2026-11-11T14:00:00Z', 'novidade', 'P da página inicial em 3D', 'O P agora tem espessura de verdade: dá para ver a lateral e o verso enquanto ele gira.'),
  release(40, '2026-11-12T12:00:00Z', 'seguranca', 'Backup automático dos sites no Discord', 'Cada site anexado ou alterado no painel ganha uma cópia em ZIP no canal 🗄️・backup-sites, sem gastar a cota da Vercel.'),
  release(41, '2026-11-12T12:30:00Z', 'novidade', 'Demonstração do Painel do cliente', 'Nova aba para montar sites por ramo (barbearia, restaurante, oficina, salão e loja) editando só textos, preços, fotos e contatos.'),
  release(42, '2026-11-12T13:00:00Z', 'novidade', 'Modelos de site repaginados', 'Cada ramo ganhou visual próprio, com botão de WhatsApp em cada serviço ou produto.'),
  release(43, '2026-11-12T13:30:00Z', 'novidade', 'Publicar na Cloudflare pelo Painel do cliente', 'O site montado no painel vai para a internet com um botão, e o passo a passo da hospedagem está no guia.'),
  release(44, '2026-11-12T15:00:00Z', 'seguranca', 'Meu site: o cliente edita o próprio site, com seu controle', 'O cliente recebe link e código para editar só o site dele; você vê tudo em Acessos dos clientes e corta quando quiser.'),
  release(45, '2026-11-12T17:00:00Z', 'novidade', 'Planos Essencial, Profissional e Premium + Odontologia', 'Cada ramo tem 3 planos prontos, o editor tem blocos que abrem e fecham e mais opções (equipe, depoimentos, perguntas, números), e entrou o ramo de odontologia.'),
  release(46, '2026-11-12T19:00:00Z', 'novidade', 'Cor livre, fotos em qualquer parte e acessos fora do editor', 'Dá para escolher qualquer cor, colocar foto no topo, em cada serviço, no Sobre e nos depoimentos; os acessos dos clientes são criados e controlados só na aba Acessos dos clientes, com troca de plano.'),
  release(47, '2026-11-12T21:00:00Z', 'novidade', 'Estilos de layout e animações nos planos', 'Os sites ganharam 3 estilos (Clássico, Moderno e Ousado) e animações ao rolar a página no Profissional e no Premium, para cada cliente ter um site com cara própria.'),
  release(48, '2026-11-12T23:00:00Z', 'seguranca', 'Correções da revisão do Codex', 'O bloqueio de códigos errados, o corte de acesso, a troca de plano e o limite diário agora resistem a pedidos simultâneos; a galeria aparece no Essencial e o editor ficou mais confiável.')
];

// Acrescenta atualizações novas a uma lista (sem repetir número), em ordem de data.
export function addRelease(list, ...items) {
  const known = new Set(list.map(item => item.n));
  const fresh = items.filter(item => item && Number.isSafeInteger(item.n) && item.n > 0 && !known.has(item.n) && Number.isFinite(Date.parse(item.at)) && KINDS[item.kind] && item.t && item.why);
  return [...list, ...fresh].sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.n - b.n);
}

const TZ = 'America/Sao_Paulo';
export const dayKey = at => new Date(at).toLocaleDateString('en-CA', { timeZone: TZ });
const dayTitle = at => {
  const text = new Date(at).toLocaleDateString('pt-BR', { timeZone: TZ, weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
  return '📅 ' + text.charAt(0).toUpperCase() + text.slice(1);
};
const oneLine = (value, max) => { const text = String(value ?? '').replace(/\s+/g, ' ').trim(); return text.length > max ? text.slice(0, max - 1) + '…' : text; };
export const releaseUrl = n => `${REPO_URL}/pull/${n}`;
export const releaseLine = item => `${KINDS[item.kind]} **${oneLine(item.t, 120)}** · [#${item.n}](${releaseUrl(item.n)})\n↳ ${oneLine(item.why, 220)}`;

// Números já postados, lidos dos rodapés "histórico · #1 #2 ...".
export function postedFromFooters(footers) {
  const posted = new Set();
  for (const footer of footers) {
    const text = String(footer ?? '');
    if (!text.startsWith(HISTORY_MARK)) continue;
    for (const match of text.matchAll(/#(\d+)/g)) posted.add(Number(match[1]));
  }
  return posted;
}
export const pendingReleases = (posted, list = RELEASES) => [...list].sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.n - b.n).filter(item => !posted.has(item.n));

// Agrupa por dia (Brasília), do mais antigo ao mais novo. Cada dia vira um ou mais embeds (descrição ≤ 3800),
// e os embeds são divididos em mensagens (≤ 10 embeds e ≤ 5500 caracteres). Devolve [{ embeds: [{ title, description, footer, numbers }] }].
export function buildHistoryMessages(list) {
  const embeds = [];
  const days = new Map();
  for (const item of list) { const key = dayKey(item.at); if (!days.has(key)) days.set(key, []); days.get(key).push(item); }
  for (const items of days.values()) {
    let part = [], size = 0, first = true;
    const flush = () => {
      if (!part.length) return;
      embeds.push({ title: dayTitle(part[0].at) + (first ? '' : ' (continuação)'), description: part.map(releaseLine).join('\n\n'), footer: `${HISTORY_MARK} · ${part.map(item => '#' + item.n).join(' ')}`, numbers: part.map(item => item.n) });
      part = []; size = 0; first = false;
    };
    for (const item of items) {
      const length = releaseLine(item).length + 2;
      if (part.length && (size + length > MAX_DESCRIPTION || part.length >= MAX_PER_EMBED)) flush();
      part.push(item); size += length;
    }
    flush();
  }
  const messages = [];
  let current = [], chars = 0;
  for (const embed of embeds) {
    const length = embed.title.length + embed.description.length + embed.footer.length;
    if (current.length && (current.length >= MAX_EMBEDS || chars + length > MAX_MESSAGE_CHARS)) { messages.push({ embeds: current }); current = []; chars = 0; }
    current.push(embed); chars += length;
  }
  if (current.length) messages.push({ embeds: current });
  return messages;
}
