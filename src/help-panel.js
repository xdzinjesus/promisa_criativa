// Ajuda / tutorial do painel: tudo explicado em linguagem simples, com busca.
// Só mostra os módulos que a pessoa pode abrir (o sócio vê só os dele). Montado pelo painel em #helpRoot.

// Cada módulo: id da aba, ícone, nome, o que é, passo a passo, botões e dicas.
export const TOPICS = [
  { id: 'dash', icon: '📊', name: 'Início', what: 'O resumo do seu negócio: o que fazer agora, vendas, lucro e o que falta receber.',
    steps: ['Abra o painel: o Início é a primeira tela.', 'Veja "Próximos passos": são as tarefas mais urgentes (ex.: demonstrações para enviar, clientes em contato). Toque em uma para ir direto até ela.', 'Role para ver vendas de hoje, dos últimos 7 dias, o gráfico de 30 dias, lucro, recebido, a receber e em negociação.'],
    buttons: [['Próximos passos', 'Cada linha leva para a tarefa certa já filtrada.'], ['Cartões de números', 'Lucro = o que entrou menos despesas e custo dos produtos. "Em negociação" = propostas ainda abertas.'], ['Uso da Vercel', 'Só o dono vê: quanto do plano de hospedagem já foi usado no mês.']],
    tips: ['Os números sobem "contando" quando a tela abre: é só animação, o valor é o mesmo.'] },
  { id: 'clients', icon: '👥', name: 'Clientes', what: 'Todos os seus clientes e possíveis clientes, do primeiro contato até o pagamento.',
    steps: ['Toque em "+ Novo cliente", escreva o nome e o WhatsApp e toque em "Adicionar".', 'Use as abas Ativos / Fechados / Perdidos / Todos para filtrar. "Mais filtros" mostra mais opções.', 'Troque entre "Lista" e "Quadro". No Quadro (computador), arraste o cartão de uma coluna para outra para mudar a etapa.', 'Toque em "⋯" no cartão para abrir a ficha completa do cliente.'],
    buttons: [['Botão principal do cartão', 'Mostra o próximo passo daquele cliente (ex.: "Anexar site", "Enviar demonstração", "Cobrar retorno", "Marcar como pago").'], ['⋯ (ficha)', 'Abre a ficha com abas: Resumo, Site e demo, Briefing e Entregas.'], ['Resumo', 'Nome, telefone, serviço, valor, data, etapa, de onde veio e "Marcar como pago". Tudo salva sozinho.'], ['Site e demo', 'Anexar o site (HTML, ZIP ou pasta), enviar a demonstração por WhatsApp, publicar na internet e gerar prompts de IA.'], ['Briefing', 'Envia o formulário para o cliente responder e mostra as respostas.'], ['Entregas', 'Aparece quando o cliente é fechado: lista do que falta entregar.'], ['Responsável', 'Quando há sócio: filtra para ver só os seus clientes ou os de cada um.'], ['Mover para a lixeira', 'Na ficha → Mais opções. O cliente some das listas e das contas, mas fica guardado. Logo depois aparece "Desfazer" por alguns segundos.'], ['Lixeira', 'Aba ao lado de "Todos". Restaurar devolve o cliente; "Excluir para sempre" apaga de vez (pede confirmação); "Esvaziar lixeira" apaga todos.']],
    tips: ['Telefone com DDD: o botão de WhatsApp já abre a conversa certa.', '"Enviar demonstração para pendentes" manda para todos que ainda não receberam, um por um.'] },
  { id: 'mySites', icon: '🌐', name: 'Meus sites', what: 'Os sites que você guarda e publica: os seus e os dos clientes.',
    steps: ['Toque em "+ Anexar HTML", "Anexar ZIP" ou "Anexar pasta completa" e escolha os arquivos.', 'Use a busca para achar um site.', 'No site, toque em "🌐 Publicar" para colocar na internet.'],
    buttons: [['🌐 Publicar', 'Coloca o site no ar e mostra o link (termina em .pages.dev). "Atualizar site" publica de novo depois de mudanças.'], ['Ligar domínio', 'Liga um endereço próprio (ex.: loja.com.br). O painel cria tudo na Cloudflare; se faltar algo no Registro.br, ele mostra os dois "servidores DNS" para trocar.'], ['Verificar agora', 'Confere se o domínio já está no ar e conserta sozinho o que der.'], ['Tirar do ar', 'Remove o site da internet (o arquivo continua guardado aqui).'], ['⭐ Destaque', 'Mostra o site na vitrine do site da Promisa.'], ['Ligar dados ao vivo', 'Para sites com área administrativa: o que o cliente mudar vale para todo mundo.']],
    tips: ['Um domínio novo pode levar de 15 minutos a 24 horas para abrir pela primeira vez.'] },
  { id: 'entregas', icon: '📦', name: 'Entregas', what: 'O checklist do que já foi feito para cada cliente fechado.',
    steps: ['Feche o cliente (etapa "Fechado") em Clientes.', 'Aqui, escolha o plano do cliente (Essencial, Profissional ou Premium).', 'Marque cada item quando terminar. A barra mostra a porcentagem.'],
    buttons: [['Filtros no topo', 'Mostram só quem tem entrega pendente, concluída etc.']], tips: ['Quando tudo fica marcado, aparece "Entregas concluídas" na linha do tempo do cliente.'] },
  { id: 'plano', icon: '🎯', name: 'Plano', what: 'Sua meta do mês e quantos clientes e contatos você precisa para chegar nela.',
    steps: ['Preencha a meta (R$), o ticket médio (quanto cada cliente paga em média) e a conversão (de cada 100 contatos, quantos fecham).', 'O painel calcula quantos clientes e contatos você precisa.', 'Use os campos de texto para anotar pacotes, público e diferenciais.'], buttons: [], tips: ['Tudo salva sozinho enquanto você digita.'] },
  { id: 'notes', icon: '📝', name: 'Anotações', what: 'Bloco de notas para ideias, possíveis clientes e lembretes.',
    steps: ['Escreva livremente. Um nome por linha ajuda a organizar.'], buttons: [], tips: ['Salva sozinho e aparece no celular e no computador.'] },
  { id: 'projects', icon: '🗂️', name: 'Projetos', what: 'Seus projetos pessoais, com prazo, situação e próximos passos.',
    steps: ['Crie um projeto com nome e prazo.', 'Mude a situação (Planejado, Em andamento, Aguardando, Concluído).', 'Se quiser, vincule um dos seus sites.'], buttons: [], tips: [] },
  { id: 'backup', icon: '💾', name: 'Backup', what: 'Uma cópia de tudo em um arquivo, e o backup automático no Discord.',
    steps: ['Toque em "Baixar backup geral" para salvar um arquivo com tudo.', 'Para voltar uma cópia, toque em "Restaurar backup" e escolha o arquivo.'],
    buttons: [['Baixar backup geral', 'Clientes, vendas, despesas, projetos, anotações, plano, sites e arquivos num só arquivo.'], ['Restaurar backup', 'Junta os dados do arquivo aos do painel.'], ['Backup no Discord', 'Envia cópias automáticas para o seu canal no Discord.']],
    tips: ['Faça um backup antes de mudanças grandes.'] },
  { id: 'prompts2', icon: '🤖', name: 'Prompts de IA', what: 'Textos prontos para pedir sites a uma IA (Essencial, Profissional, Premium).',
    steps: ['Melhor caminho: em Clientes → ⋯ → Site e demo → Prompts de IA. Assim o texto já vem com os dados e as respostas do cliente.', 'Copie o prompt e cole na IA que você usa.'], buttons: [['Copiar', 'Copia o texto inteiro.']], tips: [] },
  { id: 'instagram', icon: '📈', name: 'Instagram', what: 'Seguidores, posts, metas e clientes que vieram do Instagram.',
    steps: ['Ligue a conta do Instagram (uma vez).', 'Acompanhe os números e as metas; marque nos clientes "Como conheceu: Instagram" para contar aqui.'], buttons: [], tips: [] },
  { id: 'clientPanel', icon: '🧩', name: 'Painel do cliente', what: 'Demonstração do painel que você pode vender: o cliente edita o próprio site sem quebrar o design.',
    steps: ['Abra os grupos (textos, cores, fotos) e mude o que quiser.', 'A prévia ao lado mostra o resultado na hora. Troque entre computador e celular.'], buttons: [], tips: ['Use para mostrar ao cliente como ele mesmo vai atualizar o site.'] },
  { id: 'clientAccess', icon: '🔐', name: 'Acessos dos clientes', what: 'Quem pode editar o próprio site, quando editou e o botão para cortar o acesso.',
    steps: ['Crie o acesso do cliente e envie o link.', 'Acompanhe as últimas edições.', 'Se precisar, corte o acesso na hora.'], buttons: [], tips: [] },
  { id: 'bank', icon: '🏦', name: 'Extratos bancários', what: 'Importe o extrato do banco e veja quanto entrou, quanto saiu e para onde foi o dinheiro.',
    steps: ['Baixe o extrato no app do banco (ex.: Nubank → extrato → exportar em CSV ou OFX).', 'Toque em "Importar extrato" e escolha o arquivo. Lançamentos repetidos são ignorados.', 'Veja o painel do mês: entradas, saídas, categorias e evolução.'], buttons: [['Categorias', 'Toque num lançamento para mudar a categoria; o painel aprende para os próximos.']], tips: ['Só o dono vê esta tela, a não ser que libere para o sócio.'] },
  { id: 'products', icon: '🛍️', name: 'Produtos físicos', what: 'Estoque, compras, vendas, custo e lucro dos produtos que você vende (ex.: placas NFC).',
    steps: ['Cadastre o produto (ou use os modelos prontos) e coloque até 3 fotos.', 'Lance a compra (quantidade e valor pago): o custo por unidade é calculado sozinho.', 'Lance cada venda com cliente, valor e se já foi pago.'], buttons: [['Entrada', 'Comprei ou recebi produtos.'], ['Venda', 'Vendi: baixa o estoque e soma no lucro do Início.'], ['Ajuste', 'Perda, brinde ou contagem.']], tips: ['O estoque fica vermelho quando chega no mínimo que você definiu.'] },
  { id: 'partners', icon: '🤝', name: 'Sócios', what: 'Dar acesso ao painel para um sócio, escolhendo quais módulos ele pode ver.',
    steps: ['Toque em "Novo sócio", escreva nome, usuário e uma senha (8 ou mais caracteres).', 'Marque os módulos que ele pode abrir (ou "Marcar todos").', 'Passe o usuário e a senha para ele. Ele entra em promisa.online → "Sou sócio: entrar com usuário".'], buttons: [['Pausar / Apagar', 'Corta o acesso na hora, mesmo se ele estiver com o painel aberto.'], ['Trocar senha', 'Define uma senha nova e desconecta o sócio.'], ['Atividade', 'Mostra o que cada um alterou e quando.']], tips: ['Backup e Sócios são só do dono.'] },
];

export const FIRST_STEPS = [
  ['Instale como aplicativo', 'No celular: abra promisa.online no navegador → menu (⋮ ou compartilhar) → "Adicionar à tela inicial". Abre como app.'],
  ['Entre mais rápido', 'Depois de entrar com a senha, ative "Entrar com Face ID / digital" para não digitar a senha toda vez.'],
  ['Ache qualquer coisa', 'No computador aperte Ctrl + K (ou toque na lupa 🔍) e digite o que procura: telas e ações aparecem na hora.'],
  ['Crie qualquer coisa', 'O botão "+ Novo" no topo cria cliente, venda, despesa ou projeto de qualquer tela.'],
  ['Confie no "Salvo online"', 'O aviso no topo mostra se tudo foi salvo na nuvem. Verde = salvo; amarelo = salvando; vermelho = sem internet (salva quando voltar).'],
];

export const FAQ = [
  ['Mudei no celular e não aparece no computador.', 'Espere o aviso ficar verde ("Salvo online") no celular e recarregue o computador (Ctrl + Shift + R).'],
  ['A tela ficou estranha depois de uma atualização.', 'Recarregue com Ctrl + Shift + R (no celular, feche e abra o app).'],
  ['O domínio do cliente não abre.', 'Em Meus sites → 🌐 Publicar → "Verificar agora". A janela diz o que falta e conserta o que der.'],
  ['Apaguei algo sem querer.', 'Use Backup → "Restaurar backup" com um arquivo baixado antes.'],
  ['O sócio não vê um módulo.', 'Em Sócios, edite o acesso dele e marque o módulo.'],
];

const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const norm = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const textOf = t => norm([t.name, t.what, ...t.steps, ...t.buttons.flat(), ...t.tips].join(' '));

function topicCard(t, canOpen) {
  const card = el('details', 'hp-topic'); card.dataset.id = t.id;
  const sum = el('summary'); sum.append(el('span', 'hp-ico', t.icon), Object.assign(el('span', 'hp-name'), { innerHTML: '' }));
  sum.querySelector('.hp-name').append(el('b', '', t.name), el('small', '', t.what));
  const body = el('div', 'hp-body');
  if (t.steps.length) { body.append(el('h4', '', 'Como usar')); const ol = el('ol', 'hp-steps'); for (const s of t.steps) ol.append(el('li', '', s)); body.append(ol); }
  if (t.buttons.length) { body.append(el('h4', '', 'Botões e funções')); const dl = el('dl', 'hp-buttons'); for (const [b, d] of t.buttons) dl.append(el('dt', '', b), el('dd', '', d)); body.append(dl); }
  if (t.tips.length) { const box = el('div', 'hp-tips'); for (const tip of t.tips) box.append(el('p', '', '💡 ' + tip)); body.append(box); }
  if (canOpen) { const go = el('button', 'hp-go', `Abrir ${t.name} →`); go.type = 'button'; go.dataset.click = 'go'; go.dataset.clickArgs = JSON.stringify([t.id]); body.append(go); }
  card.append(sum, body);
  return card;
}

function draw(root) {
  const allowed = new Set(String(root.dataset.tabs || '').split(',').filter(Boolean));
  const topics = TOPICS.filter(t => !allowed.size || allowed.has(t.id));
  root.textContent = '';
  const search = el('input', 'hp-search'); search.type = 'search'; search.placeholder = 'Buscar na ajuda (ex.: domínio, estoque, senha)'; search.setAttribute('aria-label', 'Buscar na ajuda');
  const first = el('section', 'card hp-first'); first.append(el('h2', '', '🚀 Primeiros passos'));
  const grid = el('div', 'hp-first-grid');
  for (const [title, text] of FIRST_STEPS) { const c = el('div', 'hp-tile'); c.append(el('b', '', title), el('p', '', text)); grid.append(c); }
  first.append(grid);
  const index = el('div', 'hp-index'); index.setAttribute('role', 'navigation'); index.setAttribute('aria-label', 'Ir para o módulo');
  const list = el('section', 'hp-list');
  list.append(el('h2', '', '🧭 Módulos e botões'));
  const cards = topics.map(t => topicCard(t, true));
  for (const t of topics) { const chip = el('button', 'fchip hp-chip', `${t.icon} ${t.name}`); chip.type = 'button'; chip.addEventListener('click', () => { const c = cards.find(x => x.dataset.id === t.id); c.open = true; c.scrollIntoView({ behavior: 'smooth', block: 'start' }); }); index.append(chip); }
  list.append(...cards);
  const faq = el('section', 'card hp-faq'); faq.append(el('h2', '', '❓ Perguntas frequentes'));
  for (const [q, a] of FAQ) { const d = el('details', 'hp-q'); d.append(el('summary', '', q), el('p', '', a)); faq.append(d); }
  const empty = el('p', 'sub hp-empty', 'Nada encontrado. Tente outra palavra.'); empty.hidden = true;
  search.addEventListener('input', () => {
    const q = norm(search.value.trim());
    let shown = 0;
    cards.forEach((c, i) => { const hit = !q || textOf(topics[i]).includes(q); c.hidden = !hit; if (hit) shown++; c.open = Boolean(q) && hit; });
    for (const d of faq.querySelectorAll('.hp-q')) { const hit = !q || norm(d.textContent).includes(q); d.hidden = !hit; d.open = Boolean(q) && hit; }
    first.hidden = Boolean(q); index.hidden = Boolean(q); empty.hidden = shown > 0 || !q;
  });
  root.append(search, first, index, list, empty, faq);
}

export function mount(root) { if (root) draw(root); }
if (typeof window !== 'undefined') window.promisaHelp = { mount };
