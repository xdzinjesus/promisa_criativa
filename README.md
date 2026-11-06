# Promisa Criação Digital

Site institucional com área administrativa protegida e catálogo de projetos, com sincronização de dados e arquivos entre computador e celular usando Vercel Blob privado.

## Uso

1. Abra Área administrativa no rodapé e entre com sua senha.
2. Cadastre clientes, projetos, vendas e anotações. Sites aceitam HTML, ZIP ou pastas; projetos aceitam HTML e ZIP.
3. Aguarde o indicador **Salvo online** antes de sair ou trocar de aparelho.
4. Em outro aparelho, abra o mesmo domínio, entre com a mesma senha e aguarde a sincronização. Os anexos ficam disponíveis para baixar; HTMLs também têm prévia isolada.

O botão **Sincronizar agora** força uma verificação. A verificação automática ocorre a cada 20 segundos enquanto a página está visível. Arquivos são privados; prévias e download não publicam os sites na internet.

## Configuração

Veja `DADOS-ONLINE.md`. São necessários `ADMIN_PASSWORD`, `ADMIN_SESSION_SECRET` e `BLOB_READ_WRITE_TOKEN` de um armazenamento **privado**. Nenhum desses valores deve estar no GitHub. Localmente sem o armazenamento, o painel informa que os dados estão apenas no aparelho. Em produção, o Blob privado também é obrigatório para o login revogável.

## Desenvolvimento

Use Node.js 22 e configure `.env.local` a partir de `.env.example`.

```text
npm ci
node --env-file=.env.local build.mjs
npm run dev
```

Abra http://127.0.0.1:4173. Após alterações nas páginas ou scripts, execute o build novamente.

```text
npm test
```

Veja também `SEGURANCA-E-PRIVACIDADE.md` para retenção, configuração de sessões revogáveis, limitações e testes no navegador.

Os testes cobrem autenticação, proteção das rotas, preservação binária dos anexos, arquivos maiores que 4,5 MB, sincronização entre aparelhos, exclusões e conflitos. O fluxo do GitHub Actions executa o build e os testes sem usar credenciais de produção.

## Dados existentes e segurança

Os dados antigos de localStorage/IndexedDB continuam no aparelho e são enviados ao storage após a primeira conexão. A cópia local funciona como cache e conserva alterações em caso de falha de rede. A primeira sincronização deve acontecer no aparelho e domínio que já contêm os seus dados.

Duas edições diferentes no mesmo registro geram um aviso, sem substituir silenciosamente uma versão. Antes de aplicar a escolha, o painel baixa uma cópia completa do aparelho, com os ZIPs originais; essa cópia pode ser restaurada pelo menu Cópia de segurança.

O índice online usa ETag para evitar que um envio sobreponha alterações concorrentes. Arquivos recebem caminhos imutáveis e só são vinculados depois do envio completo. O token do armazenamento permanece no servidor; o navegador recebe autorizações temporárias e restritas.

Cada registro serializado aceita até 200 MB e o índice aceita 5.000 registros. JSON/base64 e a cópia do ZIP original podem aumentar o tamanho em relação ao arquivo selecionado. A exclusão no painel propaga a remoção lógica. A rotina de manutenção remove versões sem referências após a janela técnica de sete dias, quando CRON_SECRET e o agendador estiverem configurados. Antes da primeira execução, confira a simulação e os backups. A utilização segue os limites e cobrança do seu plano Vercel.
