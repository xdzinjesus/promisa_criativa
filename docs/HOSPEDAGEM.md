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

## 4. Dar ao cliente acesso para editar o próprio site ("Meu site")

O cliente edita **só o site dele** (textos, preços, fotos, promoção, horários). Ele não vê o seu painel. **Quem controla é você.**

1. Painel → **Mais** → **🧩 Painel do cliente** → monte (ou abra) o site do cliente.
2. Embaixo da prévia, em **🔑 Acesso do cliente**, toque em **Dar acesso ao cliente**.
3. Aparecem um **link** e um **código de 6 números**. **Anote o código: ele aparece só nessa hora.** Toque em **📲 Enviar no WhatsApp** para mandar os dois ao cliente.
4. O cliente abre o link, digita o código e edita. Ao tocar em **Salvar e publicar**, o site dele atualiza sozinho na Cloudflare (no mesmo endereço e domínio). Você recebe um aviso no Discord (`🚀・sites-no-ar`).

**Seu controle (Mais → 🔐 Acessos dos clientes):** lista de todos os clientes com acesso, quando entraram e quantas vezes salvaram, e os botões **⛔ Cortar acesso** (o site continua no ar, só a edição para) e **🔄 Novo link e código** (o antigo para de funcionar). Para trazer as edições do cliente para o seu painel: no editor do mesmo site, **⬇️ Trazer edições do cliente**.

**Segurança:** o link tem uma parte secreta longa; o código fica guardado embaralhado; 5 códigos errados bloqueiam por 15 minutos; a entrada do cliente vale 2 horas; no máximo 30 salvamentos por dia; tudo o que o cliente envia é limpo no servidor antes de publicar.

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
