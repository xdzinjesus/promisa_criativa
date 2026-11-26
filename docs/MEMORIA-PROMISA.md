---
title: Promisa — memória do projeto
aliases: [Promisa, Promisa Criativa, promisa_criativa]
tags: [promisa, projeto, memoria, vercel, painel]
repo: xdzinjesus/promisa_criativa
site: https://promisa.online
atualizado: 2026-11-26
---

# Promisa — memória do projeto

> Nota única para o cofre do Obsidian e para o repositório (`docs/MEMORIA-PROMISA.md`).
> Serve para qualquer pessoa ou IA retomar o projeto sem a conversa original.
> **Nenhum segredo aqui**: só os *nomes* das variáveis. Os valores ficam na Vercel e com o dono.

## 1. Em uma frase
Site e sistema de gestão da **Promisa Criação Digital** (agência de sites, identidade visual e presença digital de Concórdia/SC). Dono: **Alexandre**, não técnico.

## 2. Endereços
| O quê | Onde |
|---|---|
| Site público | https://promisa.online (também abre com `www.`) |
| Painel | https://promisa.online/admin (senha, Face ID/digital ou usuário de sócio) |
| Repositório | https://github.com/xdzinjesus/promisa_criativa (branch `main`) |
| Hospedagem | Vercel, time `alexandremachadofabris-3928's projects`, projeto `promisa_criativa`, **plano Pro** desde 17/11/2026 |
| Sites dos clientes | Cloudflare Pages (projetos `promisa-site-…`), publicados pelo painel |
| Assistente pessoal | Pixel — https://github.com/xdzinjesus/jarvis-pessoal (ver seção 9) |

## 3. Regras de trabalho (obrigatórias)
1. Comunicação com o dono **em português, muito simples, passo a passo, com o link exato e o caminho de botões**.
2. **Senhas e chaves nunca no chat, em documentos, logs ou commits.** Quem cria e cola segredos na Vercel é o dono.
3. Fluxo: branch própria (`claude/...`) → commit → pull request → **merge automático assim que os testes passam** (autorizado pelo dono) → a Vercel publica sozinha. Teste falhou = não faz merge.
4. Testes antes de entregar:
   ```bash
   SITE_URL=https://promisa.online node build.mjs
   npm test
   CHROMIUM_PATH=/opt/pw-browsers/chromium npx playwright test --trace off
   ```
5. **Gastar o mínimo do Blob**: cache, nada de listar o Blob em rotina, gravar só quando muda.
6. Preservar dados e funcionalidades. Não instalar nem rodar nada externo sem conferir a origem.
7. Antes de mexer em Discord, ler `docs/DISCORD.md`. Antes de mexer no que o Pixel usa, ler `docs/PIXEL.md` e conferir os PRs do Pixel.
8. Ações que mudam dados a partir de outro sistema (ex.: Pixel) só com autorização própria e confirmação do dono — nunca no modo automático.

## 4. Como funciona (arquitetura)
- **Sem framework**: HTML, CSS e JS. `build.mjs` gera `public/` (só isso é publicado) e os pacotes JS com esbuild.
- **Painel**: `private/admin.html` + `private/panel.js` (arquivo grande; ler por trechos) + módulos em `src/` montados sob demanda. Só sai pela função autenticada (`api/access.js`).
- **Servidor**: funções da Vercel em `api/`, lógica em `lib/`.
- **Dados**:
  - O painel guarda tudo no navegador (IndexedDB) e sincroniza com o **Vercel Blob privado** por índice (`manifest`) e hash — `src/cloud-client.js`, `lib/cloud-store.js`.
  - Registros `tipo:id`: `sales` (clientes), `exp`, `projects`, `bank`, `products`, `settings`, `sites`, `sitefiles`, `attachments`.
  - **Cofre (criptografia)**: clientes, despesas, projetos, extratos, produtos, configurações e anexos são criptografados **no navegador** com a senha do dono (`src/vault.js`). O servidor **não lê** esses dados — por isso integrações externas recebem só o que o painel monta (ex.: agenda do Pixel).
  - Sites dos clientes ficam em duas partes: `sites:<id>` (dados) e `sitefiles:<id>` (arquivos). Arquivos podem estar como texto, `data:` URL, Blob embalado (`{__promisaBlob, base64}`) ou bytes — `decodeFile` em `lib/demo-site.js` lê todos.
- **Rotinas diárias** (`vercel.json` → crons): `/api/maintenance` (limpa o Blob; excluídos ficam 3 dias) e `/api/discord?cron=summary`.

## 5. Módulos do painel
| Módulo | O que faz | Arquivos principais |
|---|---|---|
| Início ("Visão geral") | KPIs com variação de 30 dias, gráfico de vendas, rosca por etapa, atividade recente, próximos passos (inclui entregas atrasadas e que vencem hoje), uso da Vercel e do Blob | `private/panel.js` (`dash`), `src/vercel-usage-panel.js`, `lib/vercel-usage.js`, `lib/blob-usage.js` |
| Clientes | Lista/Quadro, filtros, responsável (dono/sócio), ficha em abas, **prazo de entrega**, **Lixeira** (mover, desfazer, restaurar, excluir para sempre) | `private/panel.js`, `src/client-helpers.js` |
| Meus sites | Anexar HTML/ZIP/pasta, links de demonstração (`/demo/<token>`), destaque, **Publicar** na Cloudflare com domínio (plano B: ponte por Worker) | `api/demo.js`, `lib/demo-site.js`, `api/publish.js`, `lib/cloudflare-pages.js` |
| Entregas | Checklist por plano + prazo + **Conectar ao Pixel** | `src/delivery-checklist.js`, `src/agenda.js` |
| Plano, Anotações, Projetos, Backup, Prompts de IA | Gestão geral | `private/panel.js`, `src/plan-prompts*.js`, `src/site-backup.js` |
| Instagram | Métricas e metas | `api/instagram.js`, `docs/INSTAGRAM.md` |
| Painel do cliente / Acessos dos clientes | Editor que o cliente usa e controle de acesso | `src/client-*.js`, `api/meu-site.js` |
| Extratos bancários | Importa OFX/CSV (ex.: Nubank), categorias, dashboard | `src/bank*.js` |
| Produtos físicos | Placas NFC: estoque, custo, vendas, fotos | `src/products*.js` |
| Sócios | Usuário + senha, módulos liberados, histórico de quem fez o quê | `src/partner-modules.js`, `lib/partner-store.js` |
| Ajuda | Tutorial de todos os módulos com busca | `src/help-panel.js` |

Visual: tema preto com LED roxo (`assets/panel-neon.css`), ícones no lugar de emojis (`assets/panel-icons.js`), login limpo (`assets/login-neon.css`).

## 6. Variáveis na Vercel (só os nomes)
- Sistema: `ADMIN_PASSWORD`, `ADMIN_SESSION_SECRET`, `BLOB_READ_WRITE_TOKEN`, `CRON_SECRET`
- Cloudflare: `CLOUDFLARE_API_TOKEN` (precisa de Pages, Zone, DNS, Workers Scripts e Workers Routes — Edit), `CLOUDFLARE_ACCOUNT_ID`
- Discord: `DISCORD_BOT_TOKEN`, `DISCORD_APP_ID`, `DISCORD_PUBLIC_KEY`, `DISCORD_GUILD_ID`, `DISCORD_OWNER_ID`
- Instagram: `INSTAGRAM_TOKEN`, `INSTAGRAM_ACCOUNT_ID`
- Uso da Vercel: `VERCEL_API_TOKEN` (opcionais: `VERCEL_TEAM_ID`, `VERCEL_TEAM_SLUG`, `VERCEL_PLAN`)
- Pixel: `PIXEL_TOKEN` (32+ caracteres)
- Opcional: `PAGESPEED_API_KEY`

## 7. Custos e limites
- Vercel Pro: **US$ 20/mês** (cerca de R$ 125 na fatura com câmbio e IOF), com US$ 20 de crédito de uso incluído; cobrança todo dia 17. Uso em nov/2026: centavos.
- Blob: monitor no Início (tamanho por tipo, "Liberar espaço agora" com aviso). Excluídos somem sozinhos em 3 dias.
- Alternativa futura se o Blob pesar: mover só os arquivos dos sites para Cloudflare R2. GitHub **não** serve como banco de dados.

## 8. Decisões importantes
- Prazo de entrega fica **no cliente** (`prazo`, AAAA-MM-DD), definido no cadastro e editável a qualquer momento.
- Regra de prazos (painel e Pixel): hoje no fuso `America/Sao_Paulo`; `< hoje` atrasada, `= hoje` vence hoje, `até +7 dias` próximos; lixeira, perdidos e entregas completas não entram.
- Cliente excluído vai para a **Lixeira**; só sai de vez com confirmação.
- Avisos de "recarregue a página" foram trocados por carregamento automático.
- Merge automático com testes passando (dono autorizou).

## 9. Integração com o Pixel
- Contrato completo: `docs/PIXEL.md`.
- Pergunta: "Pixel, o que tenho pra entregar hoje no Promisa?".
- Endereço só de leitura: `GET https://promisa.online/api/pixel?action=agenda` com `Authorization: Bearer <PIXEL_TOKEN>`.
- A agenda é montada e criptografada (AES-256-GCM, AAD `promisa-pixel-v1`) pelo painel, enviada só quando muda; o Pixel decifra no Windows.
- Credenciais no Pixel: Gerenciador de Credenciais do Windows, serviço `Pixel Promisa`, nomes `PROMISA_PIXEL_TOKEN` e `PROMISA_PIXEL_KEY`.
- Lado do Pixel: PR #1 de `jarvis-pessoal` (branch `codex/pixel-promisa`, rascunho, aplicado localmente no Windows). Arquivos: `jarvis/integrations/promisa.py`, `jarvis/integrations/hub.py`, `tests/test_promisa.py`. Resumo do lado do Pixel: `docs/CONTEXTO-PARA-OUTRA-IA.md` do Pixel.
- Funcionando (18/11/2026): resposta real "Nada vence hoje no Promisa".

## 10. Pendências e próximos passos
- **Kadosh**: link de demonstração em branco / "Site sem conteúdo". PRs #84 e #85 publicados (leitura de arquivos em todos os formatos). Diagnóstico em 26/11/2026: `X-Promisa-Diag: string:0` = a página principal do site está **salva vazia** na nuvem (o leitor de ZIP confere tamanho e CRC, então não esvazia sozinho). Próximo passo: conferir no painel se a prévia do site mostra conteúdo e qual arquivo é o principal; anexar de novo o HTML correto.
- **Aguardando OK do dono**: (1) links da agenda sempre com `https://promisa.online` (sem `www`); (2) esconder a chave do Pixel no painel por padrão.
- **Pixel — próximas perguntas** (só no Pixel, sem mudar o Promisa): "o que está atrasado", "o que vence esta semana", "o que falta para a próxima entrega". Ações que alteram dados só com caixa de pedidos + confirmação no painel.
- **Domínio da Teph Kaetano** (`kaetanoink.com.br`): preso fora da conta na Cloudflare; o plano B (ponte por Worker) precisa das permissões de Workers na chave da Cloudflare.
- **Segurança**: ativar 2FA na conta da Vercel (https://vercel.com/account/settings/authentication).
- `docs/PROJETO.md` ainda cita o plano grátis (Hobby) em alguns trechos; o plano atual é Pro.

## 11. Histórico recente (pull requests)
| PR | O quê |
|---|---|
| #66–#73 | Domínio de cliente preso na Cloudflare: mover sozinho, refazer cadastro, ponte por Worker |
| #74 | Ficha do cliente maior no computador |
| #75 | Painel repaginado (preto + LED roxo), Visão geral, Ajuda, ícones, login limpo, celular |
| #76 | Lixeira de clientes e fim dos avisos de recarregar |
| #77 | Merge automático com testes passando |
| #78–#80 | Uso da Vercel no Pro, monitor do Blob, "Liberar espaço agora" |
| #81 | Prazos de entrega e agenda do Pixel (só leitura) |
| #84–#85 | Link de demonstração em branco (Kadosh): ler arquivos em todos os formatos |

## 12. Documentos relacionados
- `CLAUDE.md` — regras para o Claude Code
- `docs/PROJETO.md` — resumo técnico por área
- `docs/PIXEL.md` — contrato com o Pixel
- `docs/DISCORD.md`, `docs/INSTAGRAM.md`, `docs/HOSPEDAGEM.md`, `docs/LIGAR-AGENTE.md`
