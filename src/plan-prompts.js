// Prompts completos para gerar, com IA, as entregas de cada plano.
// build(planId, dados) devolve uma lista de prompts prontos para copiar.
// dados: { empresa, telefone, briefing: { q1..q10 } } — campos ausentes viram [PREENCHER].

const P = '[PREENCHER]';
const txt = value => {
  if (value == null || value === '') return P;
  if (typeof value === 'string') return value.trim() || P;
  if (Array.isArray(value)) return value.length ? value.join(', ') : P;
  if (typeof value === 'object') {
    const list = [...(value.selected || []), ...(value.other ? [value.other] : [])];
    return list.length ? list.join(', ') : P;
  }
  return String(value);
};

function clientBlock(d) {
  const b = d.briefing || {};
  return `## DADOS DO CLIENTE
- Empresa e segmento: ${txt(b.q1 || d.empresa)}
- Principais produtos/serviços: ${txt(b.q2)}
- Público-alvo: ${txt(b.q3)}
- Diferenciais em relação aos concorrentes: ${txt(b.q4)}
- Objetivo principal do site: ${txt(b.q5)}
- Funcionalidades/seções desejadas: ${txt(b.q6)}
- Estilo visual preferido: ${txt(b.q7)}
- Materiais disponíveis (logo, cores, fotos, links): ${txt(b.q8)}
- Contatos, redes, endereço e horários: ${txt(b.q9)}
- Referências e pedidos específicos: ${txt(b.q10)}
- WhatsApp comercial (formato internacional, só números): ${d.telefone ? '55' + String(d.telefone).replace(/\D/g, '').replace(/^55/, '') : P}

Se algum dado estiver como ${P}, crie um conteúdo plausível e realista para o segmento, marcado no código com o comentário <!-- CONFIRMAR COM O CLIENTE -->. Nunca invente prêmios, números de clientes, anos de experiência, avaliações com nota ou depoimentos atribuídos a pessoas reais; para depoimentos use textos claramente de exemplo marcados para substituição.`;
}

const TECH = `## REQUISITOS TÉCNICOS (OBRIGATÓRIOS)
- HTML5 semântico + CSS + JavaScript puro (sem frameworks, sem jQuery, sem bibliotecas de terceiros).
- Mobile-first: perfeito em 360–430 px, tablet e desktop até 1440 px; nenhuma rolagem horizontal; áreas de toque ≥ 44 px; texto base ≥ 16 px.
- Desempenho: imagens em WebP com width/height definidos e loading="lazy" (exceto a primeira dobra); animações apenas com transform/opacity; nada de vídeos pesados; meta de Lighthouse ≥ 90 no celular.
- Acessibilidade: um único <h1>, hierarquia de títulos correta, contraste ≥ 4.5:1, foco visível no teclado, alt em todas as imagens informativas, botões e links com nomes claros, link "Pular para o conteúdo"; respeitar prefers-reduced-motion (desligar animações).
- SEO local: <title> e meta description únicos por página (com cidade e serviço principal), Open Graph e Twitter Card, link canonical, favicon, dados estruturados JSON-LD do tipo LocalBusiness (ou o subtipo mais adequado ao segmento) com nome, telefone, endereço, área atendida, horário e redes sociais.
- WhatsApp: todos os botões de contato abrem https://wa.me/<NÚMERO>?text=<mensagem pré-preenchida e codificada> em nova aba, com mensagens diferentes por botão (ex.: "Olá! Vi o site e quero um orçamento de ..."); botão flutuante fixo no canto inferior direito.
- Google Maps: incorporar com <iframe loading="lazy"> usando o endereço do cliente, com título acessível.
- LGPD e privacidade: NÃO usar Google Analytics, pixels, cookies de rastreamento nem fontes/scripts que rastreiem; incluir no rodapé um link "Privacidade" para uma seção/página curta explicando que o site não coleta dados e que o contato acontece pelo WhatsApp.
- Fontes: no máximo 2 famílias do Google Fonts (com display=swap) ou fontes do sistema.
- Código limpo, comentado em português, com variáveis CSS (:root) para cores, fontes, espaçamentos e raios, facilitando trocar a identidade depois.
- Rodapé com: nome, cidade, WhatsApp, Instagram, horário, "© <ano> <empresa>" e o crédito "Site criado por Promisa Criação Digital" com link para https://www.promisa.online.`;

const QUALITY = `## PADRÃO DE QUALIDADE
- Visual premium e atual, coerente com o segmento e o estilo escolhido; NADA de aparência genérica de template.
- Hierarquia forte na primeira dobra: título com a proposta de valor, subtítulo, CTA principal para o WhatsApp e um elemento visual marcante.
- Microanimações suaves: entrada das seções ao rolar (IntersectionObserver), hover nos cards e botões (150–300 ms), sem exageros.
- Textos em português do Brasil, persuasivos, claros e curtos, focados em benefícios para o cliente final e em gerar contato.
- Use imagens de banco gratuito (Unsplash/Pexels) por URL direta apenas como provisórias, indicando no código <!-- TROCAR PELA FOTO DO CLIENTE -->.`;

const OUTPUT_ONE = `## ENTREGA
Entregue UM ÚNICO arquivo index.html completo (CSS dentro de <style> e JS dentro de <script> no próprio arquivo), pronto para abrir no navegador, sem explicações antes ou depois do código. Se a resposta for cortada, continue exatamente de onde parou quando eu disser "continue".`;

const OUTPUT_MULTI = pages => `## ENTREGA
Entregue um site com várias páginas, cada uma em um arquivo HTML completo: ${pages}. Use um arquivo compartilhado assets/style.css e assets/script.js. Entregue um arquivo por vez, começando pela estrutura de pastas e depois cada arquivo completo, identificado pelo caminho (ex.: "### index.html"). Mantenha menu, cabeçalho e rodapé idênticos em todas as páginas e destaque a página atual no menu. Se a resposta for cortada, continue exatamente de onde parou quando eu disser "continue". Ao final, eu vou compactar tudo em um ZIP.`;

export const PLANS = [
  { id: 'essencial', name: 'Essencial', subtitle: 'Site de 1 página' },
  { id: 'profissional', name: 'Profissional', subtitle: 'Site completo' },
  { id: 'premium', name: 'Premium', subtitle: 'Presença digital completa' }
];

function essencial(d) {
  return [{
    title: 'Site de 1 página (Essencial)',
    tool: 'Claude ou ChatGPT',
    text: `Você é um web designer e desenvolvedor front-end sênior, especialista em sites que geram contatos para pequenas empresas brasileiras.

Crie um SITE DE UMA PÁGINA (one-page) profissional para a empresa abaixo.

${clientBlock(d)}

## SEÇÕES (nesta ordem)
1. Cabeçalho fixo com logo/nome, menu âncora (Sobre, Serviços, Fotos, Contato) e botão "Falar no WhatsApp"; menu hambúrguer acessível no celular.
2. Hero: proposta de valor clara + subtítulo + CTA principal para o WhatsApp + CTA secundário "Ver serviços".
3. Sobre: história curta, o que a empresa faz e para quem; 3 diferenciais em destaque.
4. Serviços/Produtos: até 6 cards com título, descrição curta e botão "Pedir orçamento" (mensagem do WhatsApp citando o serviço).
5. Fotos: galeria com 6 imagens em grade responsiva e lightbox simples (abrir em tamanho maior, fechar com Esc e com botão).
6. Por que escolher: 3–4 motivos com ícones SVG inline.
7. Contato: endereço, horário, WhatsApp, Instagram e mapa do Google incorporado.
8. CTA final forte ("Pronto para ...? Fale com a gente no WhatsApp").
9. Rodapé completo + seção curta de Privacidade.

${TECH}

${QUALITY}

${OUTPUT_ONE}`
  }];
}

function profissional(d) {
  return [{
    title: 'Site completo de 5 páginas (Profissional)',
    tool: 'Claude ou ChatGPT',
    text: `Você é um web designer, redator e desenvolvedor front-end sênior, especialista em sites que geram pedidos de orçamento para pequenas empresas brasileiras.

Crie um SITE COMPLETO DE 5 PÁGINAS para a empresa abaixo, com textos persuasivos escritos por você.

${clientBlock(d)}

## PÁGINAS
1. index.html (Início): hero com proposta de valor e CTA para o WhatsApp; resumo dos serviços (cards que levam à página de serviços); 3 diferenciais; prévia da galeria; chamada para o catálogo; CTA final.
2. sobre.html (Sobre): história, missão, como a empresa trabalha (passo a passo em 4 etapas), diferenciais e equipe (cards de exemplo marcados para substituição).
3. servicos.html (Serviços/Produtos): CATÁLOGO com filtro por categoria (botões de filtro acessíveis) e busca por nome; cada item com foto, nome, descrição, destaques e botão "Pedir orçamento deste item" (WhatsApp com o nome do item na mensagem). Estruture os itens em um array JavaScript no topo de assets/script.js para facilitar edição.
4. galeria.html (Galeria): grade de fotos com filtros por categoria e lightbox acessível (setas, Esc, swipe no celular).
5. contato.html (Contato): FORMULÁRIO DE ORÇAMENTO (nome, telefone, serviço de interesse em lista, cidade, melhor horário, mensagem) com validação amigável; ao enviar, monta uma mensagem organizada e abre o WhatsApp com ela (não envia dados para servidor); também endereço, horário, mapa do Google e redes sociais.

## CONTEÚDO E SEO
- Escreva todos os textos (títulos, descrições, chamadas) com foco em benefícios e em gerar contato, usando a cidade/região nos títulos e descrições para SEO local.
- Cada página com <title>, meta description, Open Graph e canonical próprios; JSON-LD LocalBusiness na página inicial e BreadcrumbList nas internas; sitemap.xml e robots.txt.
- Inclua uma seção "Perguntas frequentes" (5 perguntas típicas do segmento, com dados estruturados JSON-LD FAQPage) na página de serviços.

${TECH}

${QUALITY}

${OUTPUT_MULTI('index.html, sobre.html, servicos.html, galeria.html, contato.html, privacidade.html, sitemap.xml, robots.txt')}`
  }];
}

function premium(d) {
  const block = clientBlock(d);
  return [
    {
      title: '1) Identidade visual: logo, paleta, fontes e mini manual',
      tool: 'Claude (gera SVG e o manual em HTML)',
      text: `Você é um designer de marcas sênior. Crie a IDENTIDADE VISUAL da empresa abaixo.

${block}

## ENTREGAS
1. Conceito: 3 ideias de conceito para a marca (2 frases cada) e a escolhida com justificativa.
2. LOGO em SVG (código completo, viewBox definido, sem fontes externas: converta o texto em formas/paths ou use apenas formas geométricas): versão principal horizontal, versão símbolo (ícone quadrado) e versão monocromática branca. Design simples, memorável, legível em 32 px e em fachada.
3. PALETA: 5 cores (primária, secundária, destaque, fundo claro, texto escuro) com HEX, RGB, nome e quando usar; verifique contraste AA das combinações de texto.
4. TIPOGRAFIA: 2 fontes gratuitas do Google Fonts (títulos e textos) com pesos e tamanhos recomendados.
5. MINI MANUAL DA MARCA em um único arquivo HTML (manual-da-marca.html) com: conceito, logo e variações, área de respiro, usos corretos e incorretos (mostre 4 erros), paleta com amostras, tipografia com exemplos, tom de voz (5 regras) e exemplos de aplicação (cartão, post e fachada) desenhados em HTML/CSS.

Entregue primeiro os 3 SVGs (cada um em um bloco de código separado) e depois o manual-da-marca.html completo, sem textos fora dos blocos além dos títulos.`
    },
    {
      title: '2) Site premium de até 10 páginas',
      tool: 'Claude ou ChatGPT',
      text: `Você é um diretor de arte digital e desenvolvedor front-end sênior. Crie um SITE PREMIUM de até 10 páginas para a empresa abaixo, com visual de site de grande empresa e animações sofisticadas.

${block}

Use a identidade visual definida (cores, fontes e logo) — se ainda não houver, crie uma coerente com o estilo escolhido.

## PÁGINAS
1. index.html: hero cinematográfico (título forte, animação de entrada, elemento visual em destaque com leve parallax e inclinação 3D no mouse/toque), números/destaques do negócio (sem inventar dados — use marcadores de substituição), serviços em cards animados, prévia do catálogo, depoimentos, chamada para promoções e CTA final.
2. sobre.html: história em linha do tempo animada, missão/valores, equipe, diferenciais.
3. servicos.html: serviços detalhados, cada um com benefícios, como funciona e FAQ.
4. catalogo.html: CATÁLOGO COM PEDIDO PELO WHATSAPP — produtos em array JS (nome, categoria, preço opcional, foto, descrição, variações); filtros, busca, carrinho lateral (adicionar, quantidade, remover, total), salvo no localStorage; botão "Enviar pedido pelo WhatsApp" que monta a mensagem com itens, quantidades e observações.
5. agendamento.html: AGENDAMENTO ONLINE via WhatsApp — o visitante escolhe serviço, data (calendário próprio em JS bloqueando domingos/feriados configuráveis e datas passadas), horário (grade de horários configurável em um objeto JS) e informa nome/telefone; ao confirmar, abre o WhatsApp com a solicitação organizada. Deixe claro que o horário será confirmado pela empresa.
6. depoimentos.html: depoimentos em cards e carrossel acessível, com espaço para avaliações do Google (texto de exemplo marcado para substituição) e botão "Avalie-nos no Google".
7. promocoes.html: página de campanha com contagem regressiva configurável, oferta em destaque, condições e CTA — pensada para ser usada em anúncios e no Instagram.
8. galeria.html: galeria com filtros e lightbox acessível.
9. contato.html: formulário de orçamento que abre o WhatsApp, mapa, horários, redes, e e-mail profissional (contato@DOMINIO).
10. privacidade.html: política curta (sem coleta de dados; contato via WhatsApp; sem cookies de rastreamento).
Além disso: 404.html personalizada, sitemap.xml e robots.txt.

## ANIMAÇÕES PREMIUM
Transições de entrada encadeadas (stagger) ao rolar, cabeçalho que muda ao rolar, contadores animados, hover magnético nos botões principais, cursor normal (não substituir o cursor), brilho sutil em gradiente no fundo; tudo com transform/opacity, 60 fps no celular, e desligado com prefers-reduced-motion.

## SEO E CONVERSÃO
SEO local completo em todas as páginas (title, description, OG, canonical, JSON-LD LocalBusiness + Product/Service/FAQPage onde fizer sentido, BreadcrumbList), botão flutuante do WhatsApp, CTA em todas as seções.

${TECH}

${QUALITY}

${OUTPUT_MULTI('index.html, sobre.html, servicos.html, catalogo.html, agendamento.html, depoimentos.html, promocoes.html, galeria.html, contato.html, privacidade.html, 404.html, sitemap.xml, robots.txt')}`
    },
    {
      title: '3) Cartão de visita digital + QR Code',
      tool: 'Claude ou ChatGPT',
      text: `Crie um CARTÃO DE VISITA DIGITAL (uma página única, cartao.html) para a empresa abaixo, no padrão da identidade visual dela.

${block}

Conteúdo: logo, nome, frase curta, botões grandes (WhatsApp, Ligar, Instagram, Site, Como chegar no Maps, Salvar contato), horário de atendimento e um botão "Salvar contato" que gera e baixa um arquivo vCard (.vcf) com nome, telefone, site, endereço e Instagram (gerado em JavaScript, sem servidor). Design mobile-first elegante, animação de entrada suave, funcionamento offline, sem rastreadores. Não é preciso gerar o QR Code: ele será criado depois apontando para o endereço do cartão. Entregue um único arquivo HTML completo.`
    },
    {
      title: '4) Instagram: 15 artes, capa e destaques',
      tool: 'Claude/ChatGPT para o roteiro + Canva para montar',
      text: `Você é social media e designer. Crie o PLANEJAMENTO VISUAL de Instagram da empresa abaixo, seguindo a identidade visual (cores e fontes) definida.

${block}

## ENTREGAS
1. Tom de voz e 3 pilares de conteúdo do perfil.
2. 15 ARTES para o feed (formato 1080×1350): para cada uma informe — objetivo, tipo (carrossel/estático), título da arte (máx. 8 palavras), textos de cada lâmina, sugestão de imagem/foto, layout (posição de título, imagem e logo), cores usadas, legenda completa com CTA e 5–10 hashtags locais e do segmento.
   Distribua: 5 de apresentação e serviços, 3 de diferenciais/bastidores, 3 de dicas úteis para o público, 2 de prova social (modelos para depoimentos), 2 de oferta/convite para o WhatsApp.
3. BIO otimizada (até 150 caracteres) com CTA e sugestão de link.
4. 6 CAPAS DE DESTAQUES: nome (máx. 12 caracteres) + ícone sugerido + cor de fundo.
5. Calendário de publicação para 4 semanas (dias e horários).
Formate tudo em tabelas/listas claras para eu montar no Canva.`
    },
    {
      title: '5) Perfil da Empresa no Google (Maps)',
      tool: 'Claude ou ChatGPT',
      text: `Você é especialista em SEO local no Google. Prepare tudo para criar e otimizar o PERFIL DA EMPRESA NO GOOGLE da empresa abaixo.

${block}

Entregue: categoria principal e até 5 categorias secundárias mais adequadas; descrição da empresa (até 750 caracteres, com cidade e serviços, sem links); lista de serviços/produtos com descrições curtas; atributos recomendados; horário; 5 perguntas e respostas (Q&A); 4 posts iniciais (novidade, oferta, evento, dica) com título, texto e CTA; roteiro de 10 fotos que o cliente deve tirar (fachada, interior, equipe, produtos…); mensagem modelo para pedir avaliações aos clientes pelo WhatsApp e 3 modelos de resposta a avaliações (positiva, neutra, negativa).`
    },
    {
      title: '6) WhatsApp Business: mensagens automáticas',
      tool: 'Claude ou ChatGPT',
      text: `Escreva as MENSAGENS AUTOMÁTICAS e respostas rápidas do WhatsApp Business da empresa abaixo, no tom de voz da marca, em português do Brasil, curtas e cordiais.

${block}

Entregue: mensagem de saudação (até 400 caracteres); mensagem de ausência (fora do horário, informando o horário); 8 respostas rápidas com atalho (ex.: /orcamento, /horario, /endereco, /pagamento, /prazo, /catalogo, /obrigado, /avaliacao); descrição do perfil comercial (até 256 caracteres); e sugestão de 5 etiquetas para organizar clientes (ex.: Novo contato, Orçamento enviado, Fechado).`
    },
    {
      title: '7) E-mail profissional: assinatura',
      tool: 'Claude ou ChatGPT',
      text: `Crie uma ASSINATURA DE E-MAIL em HTML (tabelas e estilos inline, compatível com Gmail, Outlook e celular) para contato@DOMINIO da empresa abaixo, seguindo a identidade visual: logo (URL a definir), nome, cargo, WhatsApp clicável, site, Instagram e endereço. Entregue também uma versão em texto simples.

${block}`
    }
  ];
}

const BUILDERS = { essencial, profissional, premium };

export function buildPlanPrompts(planId, data = {}) {
  const build = BUILDERS[planId];
  if (!build) throw new Error('Plano desconhecido.');
  return build(data);
}
