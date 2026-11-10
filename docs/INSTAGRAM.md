# Instagram na Promisa: como conectar (passo a passo)

O painel puxa sozinho os números do seu Instagram (seguidores, posts, curtidas, alcance), mostra as metas e manda o resumo para o Discord. Para isso o painel precisa de uma "chave de acesso" (chamada **token**). Você gera essa chave uma vez e cola na Vercel.

Seu Instagram já é **Profissional** e **não** está ligado a uma página do Facebook. Tudo bem: usamos o *Login do Instagram*, que não precisa de Facebook.

## O que você vai precisar
- A senha do Instagram da Promisa.
- Uma conta no Facebook/Meta só para criar o "aplicativo" de desenvolvedor (pode ser a sua pessoal; ela não aparece para ninguém).

## Passo 1 – Criar o aplicativo na Meta
1. Abra https://developers.facebook.com/apps e entre.
2. Se pedir, aceite os termos de desenvolvedor e confirme seu cadastro.
3. Toque em **Criar app** (*Create app*), no canto de cima à direita.
4. Nome: `Promisa Painel` e seu e-mail de contato.
5. Em **Caso de uso** (*Use case*), escolha **Outro** (*Other*) e toque em **Avançar** (*Next*).
6. Em **Tipo de app** (*App type*), escolha **Empresa** (*Business*) e toque em **Avançar**. (Só app do tipo Empresa pode usar o Instagram.)
7. Ele pode pedir para "conectar um negócio" (*Connect a business*): pode pular agora. Isso só é exigido para publicar o app para o público, e aqui ele fica só para você.

## Passo 2 – Ligar o produto Instagram
1. No painel do app, role a lista de produtos até **Instagram** e toque em **Configurar** (*Set up*).
2. A opção **API setup with Instagram login** (Configuração da API com login do Instagram) entra sozinha no menu da esquerda, em **Instagram**. É ela que usamos (não escolha a opção "with Facebook login").

## Passo 3 – Adicionar sua conta e gerar o token
1. No menu da esquerda, toque em **Instagram > API setup with Instagram login**.
2. Na parte **Generate access tokens** (Gerar tokens de acesso), toque em **Add account** (Adicionar conta) e entre com o Instagram da Promisa. A conta precisa ser **Profissional** (Empresa ou Criador de conteúdo) e **pública**.
3. Se o Instagram mostrar um convite de "testador" (*tester*), aceite: no Instagram, vá em **Configurações > Permissões do site/Apps e sites > Convites de testador** e toque em **Aceitar**. As contas com acesso ficam em **App Roles > Roles** (Funções do app). Como o app fica em modo de desenvolvimento e só usa a sua própria conta, **não precisa** passar pela análise da Meta (*App Review*).
4. Toque em **Generate token** (Gerar token) ao lado da sua conta e faça login no Instagram se pedir.
5. Confirme as permissões. As duas que o painel usa são `instagram_business_basic` (perfil, seguidores e posts) e `instagram_business_manage_insights` (alcance, visualizações, salvamentos e compartilhamentos). Pode deixar as outras desmarcadas, se a tela permitir.
6. **Copie o token** que aparece (é um texto bem longo). Ele vale **60 dias**. Não mande para ninguém e não cole em conversas.

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
- O token **se renova sozinho**: ele vale 60 dias; a Meta só deixa renovar depois de 24 horas de vida e antes de vencer. O sistema troca por um novo na primeira rotina depois de 24 h e, a partir daí, sempre que passa de ~45 dias, e guarda o novo em local privado. Você não precisa fazer nada, desde que a rotina diária rode pelo menos uma vez a cada 60 dias.
- Se um dia o token vencer, o Discord (`🚨・alertas`) avisa: "🔑 O acesso ao Instagram expirou". Aí é só repetir os passos 3 e 4 (gerar de novo e trocar o valor na Vercel; o token novo vale no próximo deploy).
- Se a atualização falhar por 2 dias seguidos, também aparece um aviso em `🚨・alertas`.

## Segurança e privacidade
- O token fica só na Vercel e no armazenamento privado do projeto. Ele nunca aparece no painel, no Discord nem nos registros.
- O que vai para o Discord e para a página de metas são só números (seguidores, curtidas, quantidade de clientes). Nenhum dado pessoal de cliente sai do painel.

## Para quem for mexer no código
- API usada (Instagram API with Instagram Login, `https://graph.instagram.com`, versão `v27.0` em `lib/instagram.js`): `GET /me?fields=user_id,username,followers_count,follows_count,media_count`, `GET /me/media?fields=id,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count,thumbnail_url&limit=25`, `GET /{media-id}/insights?metric=reach,views,saved,shares,total_interactions` e `GET /refresh_access_token?grant_type=ig_refresh_token` (sem versão no caminho). Conferido na documentação oficial da Meta (nov/2026): as 5 métricas valem para posts (FEED, inclui carrossel) e Reels; `impressions`, `plays` e `video_views` estão descontinuadas e não são usadas. Posts dentro de um carrossel não têm métricas; dados podem atrasar até 48 h. Métrica recusada (erro 100) vira pedido de uma por vez e é lembrada por tipo de post; erro do post inteiro só deixa aquele post sem métricas.
- Dados: `promisa/instagram/v1/history.json` e `promisa/instagram/v1/token.json` (Blob privado).
- Rota do painel: `POST /api/instagram` com `status`, `sync`, `goals`, `clients-count`.
- Arquivos: `lib/instagram.js`, `lib/instagram-store.js`, `lib/instagram-sync.js`, `lib/instagram-handler.js`, `lib/instagram-report.js`, `src/instagram-math.js`, `src/instagram-panel.js`, `api/instagram.js`, `tests/instagram.test.mjs`.

## Se o token começar com "EA" (login unificado)
O painel da Meta pode gerar um token no formato do Facebook. Nesse caso o sistema precisa saber **qual é a conta do Instagram**:
1. Descubra o **ID da conta do Instagram** (número que começa com `1784...`), mostrado ao lado da conta na tela de gerar token do app.
2. Na Vercel, crie a variável `INSTAGRAM_ACCOUNT_ID` com esse número e faça um novo deploy.

Sem esse número, o sistema tenta achar a conta sozinho pelas Páginas do Facebook e pelo portfólio empresarial (precisa de permissão `business_management`).
