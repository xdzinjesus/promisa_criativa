# Promisa Criação Digital

Site institucional com entrada privada no rodapé, painel baseado no HTML fornecido e catálogo de projetos.

## Desenvolvimento local

Requer Node.js 22 ou superior, sem dependências externas.

1. Configure `.env.local` usando `.env.example`. Defina sua senha em ADMIN_PASSWORD e um segredo aleatório de pelo menos 32 caracteres em ADMIN_SESSION_SECRET. Não envie esse arquivo ao GitHub.
2. Execute `node --env-file=.env.local build.mjs`.
3. Execute `npm run dev` e abra http://127.0.0.1:4173.
4. Após alterações nas páginas ou assets, execute o build novamente.

O rodapé abre `/acesso.html`. Após a senha, escolha `/admin` ou `/catalogo`.

## Validação

Execute o build antes de `npm test`. Os testes verificam autenticação, proteção das páginas, senha incorreta, cookies, saída, limite de tentativas e exclusão dos arquivos privados do diretório público.

## Dados e publicação

O painel mantém o armazenamento original em localStorage e IndexedDB. O catálogo lê a mesma biblioteca no mesmo domínio e navegador. Dados não são sincronizados entre aparelhos; use Backup para transferi-los. Sair preserva os dados locais. Quem tem acesso ao perfil do navegador pode acessar esse armazenamento.

Importar HTML, pasta ou ZIP permite organizar e visualizar arquivos; não realiza deploy. Sistemas com backend não são executados pela prévia de HTML. Hospedagem automática, integração GitHub/Vercel e banco de dados compartilhado são etapas posteriores.

Consulte `ENVIAR-AO-GITHUB.md` para enviar o código e `PUBLICACAO.md` para configurar a Vercel. O HTML original anexado em Downloads permanece intacto.

O repositório inclui uma verificação no GitHub Actions: instala a configuração do projeto com Node.js 22, executa o build e os testes em pushes para `main` e pull requests. O fluxo usa credenciais fictícias apenas nos testes e não precisa da senha real.
