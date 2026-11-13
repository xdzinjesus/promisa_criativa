# Promisa · Resumo do projeto (para continuar em outra conversa)

Leia este arquivo, o `CLAUDE.md` e os guias de `docs/` antes de mexer em qualquer coisa.

## O que é
O site e o sistema de gestão da **Promisa Criação Digital**, uma agência de identidade visual, sites e presença digital de Concórdia/SC. O dono é o Alexandre, que não é técnico.

- **Site público:** https://www.promisa.online
- **Painel administrativo:** https://www.promisa.online/admin, com login por senha ou Face ID (passkey).
- **Repositório:** `xdzinjesus/promisa_criativa`, branch padrão `main`.

## Fluxo de trabalho (obrigatório)
1. Trabalhar numa **branch própria** (ex.: `claude/...`).
2. Fazer commit e push, depois abrir um **pull request**.
3. **Fazer o merge só com a aprovação do dono, dada no chat.**
4. O merge na `main` dispara o **deploy automático na Vercel** (`promisa.online`). Não existe outro passo de publicação.
5. Antes de entregar, rodar:
   1. `SITE_URL=https://example.test node build.mjs`
   2. `npm test`
   3. `CHROMIUM_PATH=/opt/pw-browsers/chromium npx playwright test --trace off`

   Tudo precisa passar.
6. Comunicação com o dono: português, muito simples, passo a passo, sempre com o link exato de onde clicar.
7. **Tokens e senhas nunca no chat.** Quem cria e cola segredos na Vercel é o dono.

## Arquitetura
- **Site e painel:** HTML, CSS e JS sem framework.
  - O `build.mjs` gera `public/` (só isso é publicado) e os bundles (esbuild).
  - `private/` (painel: `admin.html` e `panel.js`, que é muito grande; ler por trechos) só é entregue pela função autenticada.
- **Servidor:** funções da Vercel em `api/`, com limite de 12 no plano Hobby. A lógica fica em `lib/`.
- **Dados:** Vercel Blob privado.
  - O painel guarda tudo no navegador (IndexedDB) e sincroniza com o Blob por índice e hash (`src/cloud-client.js`, `lib/cloud-store.js`).
  - Os sites dos clientes ficam divididos em `sites:` (dados) e `sitefiles:` (arquivos).
- **Plano grátis da Vercel**, com limites mensais apertados:
  - Blob: 10 mil operações simples, 2 mil avançadas e 1 GB.
  - Toda funcionalidade nova deve economizar leituras e gravações: usar cache, não listar o Blob e limitar atualizações automáticas.
- **Rotinas diárias:** `/api/maintenance` (limpeza do Blob, guarda 3 dias) e `/api/discord?cron=summary` (resumo, Instagram e dashboard), protegidas por `CRON_SECRET`.

## Funcionalidades
| Área | Onde |
|---|---|
| Login, sessão de 15 min e passkeys | `api/access.js`, `lib/auth-store.js`, `lib/passkey-*` |
| Clientes (resumo, filtros, próximo passo, ficha em abas, modo Quadro) | `private/panel.js`, `src/client-helpers.js` |
| Sites de clientes, links de demonstração (`/demo/<token>`) e projetos em destaque (`/projeto/<id>`) | `api/cloud.js`, `api/demo.js`, `api/featured.js`, `lib/share-store.js`, `lib/site-cache.js` |
| Formulário de briefing (`/briefing/<token>`) | `api/briefing.js`, `lib/briefing-*` |
| Diagnóstico grátis de sites (`/diagnostico/<token>`) | `api/diagnostico.js`, `lib/diagnostico-*` |
| Publicar site de cliente na Cloudflare Pages (com domínio); passo a passo em `docs/HOSPEDAGEM.md` | `api/publish.js`, `lib/cloudflare-pages.js`, `lib/publish-*` |
| Painel do cliente (modelos por ramo), "Meu site" do cliente (link + código) e controle de acessos | `src/client-*.js`, `api/meu-site.js`, `lib/client-access-*`, `meu-site.html` |
| Discord: avisos, dashboard, histórico e central de botões | `api/discord.js`, `lib/discord*.js` (ver `docs/DISCORD.md`) |
| Instagram: métricas, metas e "como conheceu" | `api/instagram.js`, `lib/instagram*.js` (ver `docs/INSTAGRAM.md`) |
| Extratos bancários (importar OFX/CSV, categorias, resumo mensal, conciliação com vendas). Registro `bank:AAAA-MM` (1 por mês, criptografado com o cofre) e regra `settings:bankRules` Dashboard com período, comparação justa (até o mesmo dia) e gráficos SVG próprios. Nubank: CSV da conta (usa o Identificador) e da fatura do cartão (inverte sinais e ignora o pagamento) | `src/bank.js`, `src/bank-panel.js`, `src/bank-dashboard.js`, `assets/bank.css` |
| Produtos físicos (placas NFC): estoque, compras, vendas com o link da placa, custo médio, lucro, a receber. Registro `products:<id>` (1 por produto, criptografado com o cofre) | `src/products.js`, `src/products-panel.js`, `assets/products.css` |
| Sócios: usuário + senha (scrypt), módulos liberados por sócio (`src/partner-modules.js`). Permissões no cookie assinado (`u`, `m`); `who()`/`allowedFor()` em `api/access.js`; `api/cloud.js` filtra manifest/read/commit por tipo; publish/meu-site/instagram/diagnóstico pelo módulo; Discord, backup, cofre, Face ID, sócios e uso da Vercel só do dono. Mudar/pausar/apagar corta as sessões do sócio | `lib/partner-store.js`, `src/partners-panel.js` |
| Histórico de quem fez o quê: `manifest.history` (últimas 300 alterações, gravado junto com o índice, sem operação extra); `GET /api/cloud?action=history` só do dono; aparece na aba Sócios. Cobrança no WhatsApp (`chargeLink`) e dias em aberto; venda de produto ligada ao cliente (`saleId`); aviso de espaço do aparelho (70%) | `lib/cloud-store.js`, `src/partners-panel.js`, `private/panel.js` |
| Entregas, prompts de IA por plano, LGPD, backup e app no iPhone | `private/panel.js`, `src/*` |

## Variáveis na Vercel (nomes; os valores só o dono tem)
- **Sistema:** `ADMIN_PASSWORD`, `ADMIN_SESSION_SECRET`, `BLOB_READ_WRITE_TOKEN`, `CRON_SECRET`
- **Cloudflare:** `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
- **Discord:** `DISCORD_BOT_TOKEN`, `DISCORD_APP_ID`, `DISCORD_PUBLIC_KEY`, `DISCORD_GUILD_ID`, `DISCORD_OWNER_ID`
- **Instagram:** `INSTAGRAM_TOKEN` e, se o token começar com "EA", `INSTAGRAM_ACCOUNT_ID`
- **Opcional:** `PAGESPEED_API_KEY`

## Pendências conhecidas
- **Instagram:** o token do "login unificado" é do Facebook. Falta o dono pôr `INSTAGRAM_ACCOUNT_ID` na Vercel. O ID aparece em business.facebook.com → Configurações → Contas → Contas do Instagram.
- **Cota da Vercel:** acompanhar o uso. Se o armazenamento passar de cerca de 700 MB, mover os arquivos dos sites para a Cloudflare R2.
- **Ideias aprovadas que ainda não foram feitas:**
  - "Link de envio" para o cliente mandar fotos e arquivos (guardados na R2).
  - Diagnóstico grátis aberto no site público.
  - Depoimentos reais.
  - Perguntas frequentes.
- **Sites de clientes** (GV Barber, Kaetano, RG Pneus) **não ficam no repositório**: são anexados pelo painel.
