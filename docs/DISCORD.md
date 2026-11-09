# Módulo do Discord (Promisa)

Guia para qualquer agente (Claude Code na nuvem ou no PC, Codex) que for mexer na integração com o Discord.
Leia inteiro antes de alterar qualquer arquivo citado aqui.

## Dois robôs diferentes

| Robô | Onde roda | Para quê | Regra |
|---|---|---|---|
| **Promisa** (app id `1569185663922864171`) | Vercel (`/api/discord`), 24h, sem PC | Avisos, dashboard, histórico, central de botões, comandos `/` | **Não alterar** o app no portal do Discord (o *Interactions Endpoint URL* aponta para a Vercel) |
| **Promisa Code** | PC do dono (Claude Code com `--channels plugin:discord@claude-plugins-official`) | Conversar com o Claude Code pelo Discord | Só funciona com o PC ligado e o terminal aberto. Acesso trancado por allowlist |

Um app do Discord com *Interactions Endpoint URL* manda **todas** as interações para esse endereço. Por isso um robô local precisa ser outro app.

## Arquivos

- `api/discord.js`: entrada única. Recebe as interações do Discord, as ações do painel e o cron do resumo diário.
- `lib/discord-handler.js`: segurança.
  - Lê o corpo **bruto** por eventos `data`/`end`, porque na Vercel o stream já foi consumido pelo runtime.
  - Confere a assinatura Ed25519 e o timestamp (no máximo 5 min).
  - Protege contra repetição pelo id da interação.
  - Aceita só o servidor `DISCORD_GUILD_ID` e só o dono `DISCORD_OWNER_ID`.
  - Responde em até 3 s (type 5) e termina o trabalho com `waitUntil` (`@vercel/functions`) + `followUp`.
- `lib/discord.js`: acesso à API do Discord com o token do robô.
  - Define `LAYOUT` (categorias e canais), `DEFS` (nome com emoji, tópico, `readOnly`) e `WELCOME` (mensagem fixada de cada canal).
  - Funções: `setupChannels` (cria, move e renomeia; **nunca apaga**), `registerCommands`, `notify(kind, embed)`, dashboard e central.
  - Os canais são encontrados pelo **slug**: o nome sem o prefixo `emoji・`.
- `lib/discord-events.js`: textos e embeds dos avisos (briefing, demonstração aberta, diagnóstico, site publicado, alertas, resumo, dashboard).
- `lib/discord-commands.js`: comandos `/` (`COMMANDS` e `plan()`) e os botões, seletores e formulários da central (`custom_id` com prefixo `pc:`, tratados em `planComponent()`).
- `lib/discord-data.js`: leitura dos dados (manifest, sites, clientes) com limite de leituras.
- `lib/discord-releases.js`: histórico de atualizações publicado no canal `📜・historico`. **A cada PR aprovado, acrescente uma entrada.**
- `lib/instagram-report.js` (textos do Instagram no dashboard, no resumo e na semana) e `lib/instagram-*.js` (API, histórico, atualização): leia `docs/INSTAGRAM.md`. O cron do resumo atualiza o Instagram antes de montar o resumo.
- `lib/visitor.js`: aparelho, navegador e cidade aproximada de quem abre uma demonstração. **Nunca** usar nem guardar o IP.
- `src/discord-panel.js`: diálogo "💬 Discord" no painel (Criar canais, mensagem de teste, atualizar dashboard).
- `tests/discord.test.mjs` e `tests/visitor.test.mjs`: testes com `fetch` simulado, sem chamar o Discord de verdade.

Variáveis na Vercel:

- `DISCORD_BOT_TOKEN`
- `DISCORD_APP_ID`
- `DISCORD_PUBLIC_KEY`
- `DISCORD_GUILD_ID`
- `DISCORD_OWNER_ID`
- `CRON_SECRET` (usado também pelo cron do resumo)

Sem elas, tudo vira "não faz nada" em silêncio.

## Canais atuais

- 📊 **PAINEL**:
  - `📊・dashboard`: só leitura; uma mensagem editada no lugar. Quando `INSTAGRAM_TOKEN` está configurado, ganha o quadro **📈 Instagram** (seguidores, meta, clientes do mês, último post).
  - `☀️・resumo-do-dia`: só leitura. Ganha a linha do Instagram e, na segunda-feira, o "📈 Semana no Instagram".
- 💼 **CLIENTES**: `🆕・novos-clientes`, `👀・demonstracoes`, `🩺・diagnosticos`.
- 🌐 **SITES**:
  - `🏗️・sites-em-criacao`: do robô do Codex ou do Promisa Code; o robô Promisa não posta aqui.
  - `🚀・sites-no-ar`.
- ⚙️ **SISTEMA**:
  - `🚨・alertas` (inclui: acesso ao Instagram expirou, Instagram sem atualizar há 2 dias).
  - `🎛️・central`: botões.
  - `🧠・claude-code`: mensagem fixada com o guia para ligar o Claude Code e o Codex em qualquer máquina (`docs/LIGAR-AGENTE.md`). O robô só posta a mensagem fixada; a conversa é com o robô do PC.
  - `📜・historico`: só leitura.
  - `💻・github`: webhook do GitHub; o robô não posta aqui.

## Como criar módulos novos

- **Canal novo:**
  1. Adicione o canal em `LAYOUT`, `DEFS` e `WELCOME` (`lib/discord.js`).
  2. Se o robô for postar nele, inclua o canal em `CHANNELS` e crie o aviso em `discord-events.js` com `notify('slug', {...})`.
  3. Depois do deploy, o dono toca em **Criar canais** no painel.
- **Aviso novo:** crie uma função em `discord-events.js`, chamada pelo ponto do sistema que gera o evento. Regras:
  - Sempre em segundo plano (`waitUntil`).
  - Nunca quebra o fluxo original.
  - Sem dados pessoais e sem tokens.
- **Botão novo na central:**
  1. Crie o `custom_id` `pc:<nome>` em `planComponent()` (`discord-commands.js`).
  2. Adicione o botão na mensagem da central.
  3. Para abrir um formulário, responda com type 9 (modal).

  Todo tipo de interação passa pelas checagens de `discord-handler.js`.
- **Comando `/` novo:** crie a entrada em `COMMANDS` e o `case` em `plan()`. Ele é registrado quando o dono toca em **Criar canais**.

## Regras obrigatórias

1. **Cota da Vercel (plano grátis):**
   - No máximo ~8 leituras de Blob por ação.
   - Nunca listar o Blob.
   - Atualizações automáticas com limite (dashboard: 1 vez por hora e 6 por dia).
2. **Segurança:**
   - Nunca enfraquecer as checagens de `discord-handler.js`.
   - Nunca registrar em log token, assinatura ou dados pessoais.
   - Nunca pedir token no chat.
3. **Antes de entregar**, tudo tem que passar:

   ```bash
   SITE_URL=https://example.test node build.mjs
   ```

   ```bash
   npm test
   ```

   ```bash
   npx playwright test --trace off
   ```
4. **Branch própria** (ex.: `pc/nome-da-tarefa`): commit, push e PR. **Merge só com aprovação do dono.**
5. **Dois agentes no mesmo projeto:** antes de começar, informe ao dono quais arquivos vai alterar, para não haver edição simultânea dos mesmos arquivos.
6. **Sites de clientes não entram neste repositório.** No PC, crie em `C:\PromisaSites\<cliente>\` e entregue o HTML ou ZIP pelo Discord (canal `🏗️・sites-em-criacao` ou mensagem direta). O dono anexa no cliente pelo painel.
