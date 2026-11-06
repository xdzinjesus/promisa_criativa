# Segurança, privacidade e operação

## O que foi corrigido

- Painel e catálogo compartilham `private/panel.js`, servido com autenticação. Os atributos HTML passaram a transportar dados para uma lista de ações permitidas, em vez de gerar JavaScript com IDs. A CSP de scripts não aceita `unsafe-inline`.
- Importações e registros sincronizados validam estrutura, IDs, vínculos, nomes de configurações e arquivos. Chaves de protótipo e caminhos de credenciais são rejeitados. Dados locais inválidos são preservados e o painel bloqueia sua renderização, em vez de iniciar com dados vazios e sobrescrever a cópia online.
- Prévias são estáticas, isoladas por sandbox e CSP: não executam JavaScript, não enviam formulários nem carregam rede externa. Isso muda intencionalmente a prévia de sites interativos; o download mantém o arquivo original.
- ZIPs têm limite de 64 MB de entrada, 128 MB reais descomprimidos e 5.000 entradas, com validação de caminhos e CRC. Sites serializados continuam sujeitos ao limite de 200 MB do armazenamento online.
- O backup geral v2 conserva os ZIPs originais e o tipo dos anexos. Backups v1 continuam aceitos mediante validação. A restauração de sites/anexos é agrupada em uma transação IndexedDB, com recuperação da cópia de localStorage se a operação falhar. Registros conflitantes não são substituídos nem renomeados silenciosamente, preservando os vínculos entre cadastros e anexos. Não interrompa o navegador no meio de uma restauração: localStorage e IndexedDB não oferecem uma transação única entre as duas tecnologias.
- A exclusão de projetos remove os seus anexos. A exclusão de leads remove vínculos e nomes copiados dos sites, sem apagar os sites automaticamente. Revise também nomes, descrições e notas livres quando cumprir um pedido de eliminação de dados pessoais.
- Registros excluídos não consomem o limite de cadastros ativos. Marcadores de exclusão continuam no manifesto para impedir que um aparelho antigo ressuscite registros. O índice mantém seu limite de tamanho; não há compactação destrutiva automática desses marcadores.
- O servidor calcula o SHA-256 e valida o conteúdo antes de vincular arquivos ao manifesto. O commit aceita no máximo 20 alterações, como o cliente já utilizava.
- `@vercel/cli-config` foi fixado por override na versão 0.3.7, compatível com a cadeia atual e contendo Zod corrigido. Não foi feito downgrade do Vercel Blob.

## Autenticação e cópia local

Em produção na Vercel, `BLOB_READ_WRITE_TOKEN` de um store privado é obrigatório também para autenticação. A senha administrativa precisa ter pelo menos 12 caracteres e o segredo de sessão, pelo menos 32. O Blob guarda sessões revogáveis e limites de tentativas com gravação condicional por ETag. Sem acesso ao armazenamento, a autenticação falha de forma segura. Localmente, sem token, os mesmos fluxos usam memória do processo e perdem sessões ao reiniciar.

A saída revoga a sessão no servidor, inclusive uma cópia do cookie. As sessões antigas foram invalidadas pela mudança de versão. Os links de download já emitidos têm validade própria de até quinze minutos; o logout não cancela esses links.

“Sair” mantém a cópia local para uso em aparelho confiável. “Sair e apagar dados deste aparelho” remove o banco local e as chaves do painel, preservando outros dados da mesma origem. Se houver alterações pendentes, o painel oferece baixar uma cópia antes de sair; cancelar mantém a sessão e os dados. Prefira sincronizar primeiro e confira o arquivo baixado antes de remover a última cópia. Feche outras abas do painel antes de limpar o aparelho. Backups que já foram baixados devem ser removidos manualmente ou guardados em local protegido.

O aplicativo continua com uma senha administrativa única, sem usuários individuais nem MFA próprio. Isso não deve ser tratado como segregação de acesso entre funcionários ou clientes. Para esse uso, integrar um provedor de identidade, contas individuais, MFA e permissões por usuário é uma etapa adicional. Ative MFA nas contas GitHub/Vercel e regras de firewall para conter abuso antes das funções: o limite compartilhado do aplicativo não substitui proteção contra DDoS ou controle de custos de armazenamento.

## Retenção e limpeza física

O cron `/api/maintenance`, diário às 06:00 UTC, exige `CRON_SECRET` exclusivo com pelo menos 32 caracteres, cadastrado de forma segura na Vercel. Sem configuração, retorna 503 e não executa exclusões. Não coloque esse valor no Git, chat, frontend ou nos logs.

Arquivos sem referências são elegíveis após sete dias desde sua criação ou desde a última remoção de vínculo registrada no manifesto, o que ocorrer por último. Objetos ativos não são removidos. A rotina usa uma janela de manutenção no manifesto, respeitada pelos commits, para evitar uma nova referência durante a exclusão. Versões antigas, anteriores ao registro de remoção de vínculo, usam a data de criação como referência; confira a simulação antes de ativar a primeira limpeza.

Para conferir sem apagar:

```sh
node --env-file=.env.local scripts/storage-maintenance.mjs
```

Para executar a remoção no armazenamento configurado, após revisar o resultado:

```sh
node --env-file=.env.local scripts/storage-maintenance.mjs --apply
```

A execução é limitada por tempo, por isso pode exigir múltiplos ciclos em um armazenamento grande. Os metadados de sessões expiradas e contadores de tentativas também são limpos em lotes limitados. Monitore erros, frequência e custos. Não foi executada uma limpeza no Blob de produção durante estas alterações.

A exclusão lógica de um registro, a retirada de anexos e a remoção física de arquivos não identificam automaticamente todos os dados de uma pessoa em notas livres, projetos, cópias offline e backups externos. Um pedido de eliminação requer busca e acompanhamento nessas fontes. Conserve dados obrigatórios por lei com finalidade e acesso limitados. Os sete dias são uma janela técnica de recuperação; não substituem uma política de retenção por categoria e base legal.

## Pendências de configuração e LGPD

1. Confirmar Blob privado, variáveis de produção e preview separadas e permissões mínimas. O login de produção depende de `ADMIN_PASSWORD`, `ADMIN_SESSION_SECRET` e `BLOB_READ_WRITE_TOKEN` funcionando.
2. Cadastrar `CRON_SECRET` e conferir que o agendador é executado e envia o cabeçalho Authorization esperado. Verificar o resultado da simulação antes da primeira limpeza real.
3. Confirmar nome/razão social do controlador e dados institucionais cabíveis no aviso de privacidade. O código não inventa CNPJ, e-mail nem identidade legal.
4. Definir prazos de conservação para leads, contratos, registros financeiros, anexos e backups; registrar bases legais e critérios de prospecção, sem usar consentimento genérico.
5. Conferir contratos, regiões efetivas dos serviços e garantias de transferência internacional; manter inventário de tratamento e um procedimento de resposta a incidentes e pedidos dos titulares.
6. Manter backups protegidos e testar restauração. Não enviar backup privado, senha, token ou segredo de sessão em issues, chat ou commits. Rotacionar credenciais que tenham sido compartilhadas dessa forma.

O aviso público foi ampliado para descrever os dados administrativos, cópias locais, fornecedores, cookie necessário, direitos e conservação. A conformidade depende também dessas decisões e práticas fora do código.

## Validação de desenvolvimento

```sh
npm ci --ignore-scripts
SITE_URL=https://example.com npm run build
npm test
npx playwright install chromium
npm run test:browser
```

Com Chromium já instalado, informe `CHROMIUM_PATH=/usr/bin/chromium` para os testes de navegador. O servidor de teste usa credenciais exclusivamente de teste e uma porta própria; não consulta produção. O CI executa os testes de unidade e navegador. Os testes de armazenamento usam transporte simulado para concorrência entre instâncias; o acesso ao Blob real e a configuração efetiva da Vercel precisam de validação no ambiente publicado.
