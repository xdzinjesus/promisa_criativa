# Hospedagem: como os sites vão para a internet

Guia simples, passo a passo. Vale para o dono (Alexandre) e para qualquer agente que for mexer nisso.

## 1. Os dois lugares onde as coisas ficam

| O quê | Onde fica hospedado | Quem publica |
|---|---|---|
| **O site da Promisa** (promisa.online) e o **painel** (/admin) | **Vercel** | Sozinho: todo pedido de alteração aprovado no GitHub vai para o ar em 1 a 2 minutos |
| **Os sites dos clientes** (GV Barber, Kaetano, RG Pneus, os criados no "Painel do cliente"…) | **Cloudflare Pages**, na **sua** conta da Cloudflare | Você, pelo painel, no botão **🌐 Publicar** / **🚀 Publicar na Cloudflare** |

A Cloudflare Pages é **grátis** para sites como esses, entrega rápido no Brasil e já vem com cadeado (HTTPS).

## 2. Configuração (feita uma vez só)

O painel precisa de duas informações da sua Cloudflare, guardadas na Vercel:

| Nome na Vercel | O que é |
|---|---|
| `CLOUDFLARE_ACCOUNT_ID` | O número da sua conta da Cloudflare (não é segredo) |
| `CLOUDFLARE_API_TOKEN` | A "chave" que deixa o painel publicar (é segredo: nunca mande no chat) |

**Se já estiverem na Vercel, pule para a parte 3.** Para conferir, abra https://vercel.com/dashboard → projeto **promisa_criativa** → **Settings** → **Environment Variables**.

### 2.1 Pegar o ID da conta
1. Entre em https://dash.cloudflare.com
2. Clique na sua conta. Na página inicial, à direita (ou no menu **⋯** ao lado do nome da conta), aparece **Account ID**. Clique em **Copiar**.

### 2.2 Criar a chave (token)
1. Abra https://dash.cloudflare.com/profile/api-tokens
2. Clique em **Create Token** → no fim da lista, em **Custom token**, clique em **Get started**.
3. Dê um nome: `Promisa painel`.
4. Em **Permissions**, adicione estas linhas (botão **+ Add more**):
   - **Account** → **Cloudflare Pages** → **Edit** (publicar os sites)
   - **Zone** → **Zone** → **Edit** (ligar o domínio do cliente)
   - **Zone** → **DNS** → **Edit** (apontar o domínio para o site)
5. Em **Account Resources**, escolha **Include → a sua conta**. Em **Zone Resources**, escolha **Include → All zones from an account → a sua conta**.
6. Clique em **Continue to summary** → **Create Token** → **Copy**. **Não cole no chat.**

### 2.3 Colocar na Vercel
1. Abra https://vercel.com/dashboard → **promisa_criativa** → **Settings** → **Environment Variables**.
2. Crie `CLOUDFLARE_ACCOUNT_ID` (cole o ID) e `CLOUDFLARE_API_TOKEN` (cole a chave). Deixe marcado **Production**. Clique em **Save**.
3. Vá em **Deployments** → nos três pontinhos (⋯) da primeira linha → **Redeploy**. Espere aparecer **Ready**.

## 3. Publicar um site (o dia a dia)

### A partir do "Painel do cliente"
1. Painel → **Mais** → **🧩 Painel do cliente**. Monte o site.
2. Toque em **🚀 Publicar na Cloudflare**. O painel salva o site no cadastro e abre a janela **🌐 Publicar site**.
3. Espere aparecer **"Salvo online"** no topo do painel (os arquivos precisam estar na nuvem) e toque em **Publicar agora**. Leva até 1 minuto.
4. Pronto: o site fica no ar num endereço grátis, tipo `https://promisa-barbearia-navalha-ab12.pages.dev`. Copie e mande para o cliente.

### A partir de um site anexado (HTML, ZIP ou pasta)
1. Painel → **Clientes** → abra o cliente → aba do site (ou **Sites sem cliente**).
2. Toque em **🌐 Publicar** e siga os passos 3 e 4 acima.

### Atualizar um site que já está no ar
Mudou alguma coisa? No Painel do cliente, toque em **🚀 Publicar na Cloudflare** de novo (ele salva por cima do mesmo site) e, na janela, toque em **Atualizar site**. O endereço continua o mesmo. Para tirar do ar: **Tirar do ar**, na mesma janela.

## 4. Planos dos sites (Essencial, Profissional, Premium)

No **🧩 Painel do cliente**, em **🧭 Ramo e plano**, escolha o ramo (barbearia, restaurante, oficina, salão, odontologia ou loja) e o plano que o cliente comprou:

| Plano | O que libera |
|---|---|
| 🌱 Essencial | Topo, até 6 serviços, Sobre, galeria de 4 fotos, contato, 2 combinações de cores |
| 🚀 Profissional | + destaques, promoção, "Como funciona", galeria de 8 fotos, depoimentos, perguntas frequentes, chamada final, topo dividido com foto, 4 cores |
| 👑 Premium | + faixa animada, números do negócio, equipe com fotos, menu fixo no topo, topo centralizado, 30 itens, 12 fotos, 6 cores |

**Estilos de layout:** 🏛️ Clássico (todos os planos), ✨ Moderno (Profissional e Premium) e ⚡ Ousado (só Premium). Cada ramo começa com um estilo diferente. **Animações:** o Profissional e o Premium mostram os blocos surgindo ao rolar e o brilho nos botões; o Premium tem ainda título com brilho, fundo animado, cartões que flutuam e zoom nas fotos.

O cliente **não consegue trocar de plano nem de ramo**: o servidor confere. Odontologia segue as regras do CFO (sem preços e sem promoções; responsável técnico e CRO no rodapé).

## 4.1 Dar ao cliente acesso para editar o próprio site ("Meu site")

O cliente edita **só o site dele** (textos, preços, cores, fotos em qualquer parte, promoção, horários). Ele não vê o seu painel. **Quem controla é você**, numa tela separada do editor:

1. Painel → **Mais** → **🔐 Acessos dos clientes**.
2. Em **➕ Dar acesso a um cliente**, preencha o nome do negócio, o **ramo**, o **plano** e o WhatsApp do cliente. Se quiser, marque "Começar com o site montado no 🧩 Painel do cliente".
   - Para o cliente **escolher o ramo sozinho**, marque "Deixar o cliente escolher o ramo".
   - Para **liberar tudo** (todos os blocos e todos os ramos), toque em **✨ Liberar tudo**: ele marca o Premium e o ramo livre.
3. Toque em **🔑 Dar acesso**. Aparecem um **link** e um **código de 6 números**. **Anote o código: ele aparece só nessa hora.** Toque em **📲 Enviar no WhatsApp**.
4. O cliente abre o link, digita o código e edita. Ao tocar em **Salvar e publicar**, o site dele atualiza sozinho na Cloudflare. Você recebe um aviso no Discord (`🚀・sites-no-ar`).

**Seu controle (na mesma aba):** lista de todos os clientes com acesso, quando editaram e quantas vezes salvaram; trocar o **plano** (vale no próximo salvamento); **🧭 Ramo livre: sim/não** (deixa ou não o cliente trocar o ramo); **✏️ Abrir no Painel do cliente** (para você mesmo ajustar o site dele); **⛔ Cortar acesso** (o site continua no ar, só a edição para) e **🔄 Novo link e código** (o antigo para de funcionar).

**Segurança:** o link tem uma parte secreta longa; o código fica guardado embaralhado; 5 códigos errados bloqueiam por 15 minutos; a entrada do cliente vale 2 horas; no máximo 30 salvamentos por dia; tudo o que o cliente envia é limpo no servidor antes de publicar.

## 4.2 Sites feitos à mão com área administrativa ("⚡ Dados ao vivo")

Para o site que **você fez** (um `index.html` ou uma pasta) e que tem **uma área administrativa própria** (ex.: cardápio do dia). Sem isso, o que o cliente salva fica só no navegador dele.

1. Anexe o site no painel (HTML ou pasta) e abra **🌐 Publicar**.
2. O painel **descobre sozinho** se o site tem área administrativa, onde ela abre (`#admin`, `#painel`, `admin.html`…) e como ela salva. Se for compatível, **liga sozinho** na primeira vez (se você tocar em **⛔ Desligar**, fica desligado). Se não for, ele explica o motivo (sem área, servidor próprio como Firebase, ou IndexedDB) e você ainda pode tocar em **Ligar dados ao vivo** para testar.
3. Anote a **senha** (aparece só nessa hora) e toque em **📲 Enviar instruções no WhatsApp**.
4. Toque em **Atualizar site** uma vez (o modo edição entra no ar).
5. O cliente abre o endereço de edição (`endereço-do-site/#admin` se o site já usa `#admin`, senão `endereço-do-site/#promisa-admin`; o painel mostra o certo), usa a área administrativa do site normalmente e salva. Se o site salva **baixando um `index.html` novo** (ex.: o site do padel), o sistema não baixa nada: publica direto. Se não, ele toca em **🚀 Publicar para todos**. A senha é pedida uma vez. Em até 1 minuto, todo mundo vê.

Como funciona: a área administrativa do site continua igual; o sistema captura o que ela grava no navegador (`localStorage`) ou o bloco de dados `<script type="application/json" id="...">` do `index.html` que ela gera para baixar, e publica de novo o site com esses dados dentro do HTML. Quem visita recebe os dados junto com a página (nenhuma leitura extra na Vercel). Limites: 40 publicações por dia por site; até 3 MB de dados; 5 senhas erradas bloqueiam por 15 min. Áreas administrativas que guardam em outro lugar (IndexedDB, servidor próprio) não são capturadas.

## 4.3 Ver o uso da Vercel no painel (cartão "☁️ Uso da Vercel" no Início)

O painel mostra os mesmos números da tela **Usage** da Vercel (últimos 30 dias, com o limite do plano grátis). Precisa de uma chave de leitura, criada uma vez:

1. Abra https://vercel.com/account/settings/tokens → **Create Token**.
2. Nome: `Promisa painel uso`. Em **Scope**, escolha a sua conta (a mesma do projeto). Validade: **No expiration** (ou 1 ano). Toque em **Create** e copie. **Não cole no chat.**
3. Abra https://vercel.com/dashboard → **promisa_criativa** → **Settings** → **Environment Variables** → crie `VERCEL_API_TOKEN` com a chave, marcado em **Production** → **Save**.
4. **Deployments** → ⋯ da primeira linha → **Redeploy**. Pronto: o cartão aparece no Início (atualiza a cada 30 min, ou no 🔄).

A chave só é usada no servidor (nunca vai para o navegador). Se o cartão disser que a Vercel não devolveu dados, a consulta oficial pode não trazer o plano grátis; nesse caso, o uso continua em vercel.com → Usage.

## 5. Ligar o domínio do cliente (ex.: barbearianavalha.com.br)

1. Na janela **🌐 Publicar site**, em **Domínio do cliente**, digite o domínio (sem `www`) e toque em **Ligar domínio**.
2. O painel cria o domínio na sua Cloudflare e mostra **dois "servidores DNS"** (parecidos com `ana.ns.cloudflare.com`).
3. No lugar onde o domínio foi comprado, troque os servidores DNS por esses dois:
   - **Registro.br:** https://registro.br/painel/ → o domínio → **DNS** → **Alterar servidores DNS** → cole os dois → **Salvar**.
   - **Hostinger:** **Domínios** → o domínio → **DNS / Nameservers** → **Alterar nameservers** → cole os dois.
4. Espere de 1 a 24 horas. Volte na janela e toque em **Verificar agora**. Quando aparecer **✅ No ar em https://…**, terminou. O `www` também funciona.

Se aparecer o aviso de **"endereços antigos neste domínio"** (por exemplo, um e-mail do cliente já configurado), **não continue sozinho**: peça ajuda, para não derrubar o e-mail dele.

## 6. Por dentro (para agentes)

1. O site fica no navegador (IndexedDB) e é enviado ao **Blob privado** da Vercel pela sincronização (`src/cloud-client.js`, chaves `sites:` e `sitefiles:`).
2. A janela de publicação espera o "Salvo online" e chama `POST /api/publish` (`action: publish`, só com sessão do dono).
3. `lib/publish-handler.js` lê o site do Blob e `lib/cloudflare-pages.js` faz o mesmo envio do `wrangler pages deploy` (Direct Upload): cria o projeto `promisa-<nome>-<id>` se não existir, envia só os arquivos novos e cria a publicação.
4. O resultado (endereço `.pages.dev`, domínio) fica em `lib/publish-store.js`. O Discord recebe o aviso em `🚀・sites-no-ar`.
5. Domínio: cria a *zone* na conta, liga `apex` e `www` ao projeto e cria os CNAME com proxy. Nunca apaga registros que já existem.
6. A chave da Cloudflare só é lida no servidor: nunca vai para o navegador, para as respostas nem para os registros.
7. "Meu site": `api/meu-site.js` + `lib/client-access-handler.js` + `lib/client-access-store.js` (Blob `promisa/client-access/v1/`), página `meu-site.html` + `src/client-portal.js`, controle em `src/client-access-ui.js`. O cliente salva o rascunho limpo (`cleanDraft`), o servidor gera o HTML (`renderSite`) e publica no mesmo projeto da Cloudflare do site.

**Custos:** a Cloudflare Pages é grátis no uso da Promisa. Na Vercel, cada publicação gasta poucas leituras do Blob (os arquivos do site). Para vender o "Painel do cliente" para clientes finais, com login próprio, o recomendado é a Vercel **Pro** (o plano grátis não permite uso comercial).
