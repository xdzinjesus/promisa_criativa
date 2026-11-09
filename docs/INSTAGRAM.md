# Instagram na Promisa: como conectar (passo a passo)

O painel puxa sozinho os números do seu Instagram (seguidores, posts, curtidas, alcance), mostra as metas e manda o resumo para o Discord. Para isso o painel precisa de uma "chave de acesso" (chamada **token**). Você gera essa chave uma vez e cola na Vercel.

Seu Instagram já é **Profissional** e **não** está ligado a uma página do Facebook. Tudo bem: usamos o *Login do Instagram*, que não precisa de Facebook.

## O que você vai precisar
- A senha do Instagram da Promisa.
- Uma conta no Facebook/Meta só para criar o "aplicativo" de desenvolvedor (pode ser a sua pessoal; ela não aparece para ninguém).

## Passo 1 – Criar o aplicativo na Meta
1. Abra https://developers.facebook.com/apps e entre.
2. Se pedir, aceite os termos de desenvolvedor e confirme seu cadastro.
3. Toque em **Criar app** (*Create app*).
4. Nome: `Promisa Painel`. Escolha o tipo **Business** (Empresa) e conclua.

## Passo 2 – Ligar o produto Instagram
1. Dentro do app, no menu da esquerda, toque em **Adicionar produto** e escolha **Instagram**.
2. Toque em **API setup with Instagram login** (Configuração da API com login do Instagram).

## Passo 3 – Adicionar sua conta e gerar o token
1. Na mesma tela, em **Generate access tokens**, toque em **Add account** e entre com o Instagram da Promisa. Se o Instagram pedir, aceite ser "testador": abra o aplicativo do Instagram, vá em **Configurações > Apps e sites** (ou o aviso que chegou) e aceite o convite.
2. Volte para a tela do app e toque em **Generate token** ao lado da sua conta.
3. Confirme as permissões (leitura de perfil, mídia e métricas).
4. **Copie o token** que aparece (é um texto bem longo). Não mande para ninguém e não cole em conversas.

## Passo 4 – Colocar o token na Vercel
1. Abra https://vercel.com/alexandremachadofabris-3928s-projects/promisa_criativa/settings/environment-variables
2. Toque em **Add Environment Variable** (Adicionar variável).
3. Nome (*Key*): `INSTAGRAM_TOKEN`
4. Valor (*Value*): cole o token.
5. Marque **Production** (e as outras, se quiser) e toque em **Save**.
6. Faça um novo deploy: em **Deployments**, no último, toque nos três pontinhos e em **Redeploy**. (Ou espere o próximo deploy.)

## Passo 5 – Conferir no painel
1. Entre no painel e abra **Mais > Instagram**.
2. Toque em **Atualizar agora**. Em alguns segundos aparecem seguidores, posts e gráfico.
3. Toque em **Editar metas** e defina a meta de seguidores (número e data) e a de clientes por mês.
4. No cadastro de cada cliente, escolha **Como conheceu a Promisa?**. Os que vieram do **Instagram** entram na meta de clientes.

## Depois disso é automático
- Todo dia de manhã (cron das 11:05 UTC) o sistema atualiza os números, o resumo do dia e o dashboard do Discord. Toda segunda-feira o canal `☀️・resumo-do-dia` ganha o "📈 Semana no Instagram".
- O token **se renova sozinho** (vale 60 dias; o sistema troca por um novo quando passa de ~45 dias e guarda o novo em local privado). Você não precisa fazer nada.
- Se um dia o token vencer, o Discord (`🚨・alertas`) avisa: "🔑 O acesso ao Instagram expirou". Aí é só repetir os passos 3 e 4 (gerar de novo e trocar o valor na Vercel; o token novo vale no próximo deploy).
- Se a atualização falhar por 2 dias seguidos, também aparece um aviso em `🚨・alertas`.

## Segurança e privacidade
- O token fica só na Vercel e no armazenamento privado do projeto. Ele nunca aparece no painel, no Discord nem nos registros.
- O que vai para o Discord e para a página de metas são só números (seguidores, curtidas, quantidade de clientes). Nenhum dado pessoal de cliente sai do painel.

## Para quem for mexer no código
- API usada (Instagram API with Instagram Login, `https://graph.instagram.com`, versão em `lib/instagram.js`): `GET /me`, `GET /me/media`, `GET /{media-id}/insights`, `GET /refresh_access_token`. Não consegui abrir a documentação oficial da Meta no ambiente de desenvolvimento (a página só carrega com JavaScript), então nomes de campos e métricas seguem o que eu conheço dela; o código é defensivo (métrica recusada vira uma tentativa menor e é lembrada).
- Dados: `promisa/instagram/v1/history.json` e `promisa/instagram/v1/token.json` (Blob privado).
- Rota do painel: `POST /api/instagram` com `status`, `sync`, `goals`, `clients-count`.
- Arquivos: `lib/instagram.js`, `lib/instagram-store.js`, `lib/instagram-sync.js`, `lib/instagram-handler.js`, `lib/instagram-report.js`, `src/instagram-math.js`, `src/instagram-panel.js`, `api/instagram.js`, `tests/instagram.test.mjs`.
