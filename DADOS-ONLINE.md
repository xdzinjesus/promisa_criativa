# Ativar arquivos e dados entre PC e celular

## Na Vercel

1. Abra o projeto **promisa_criativa**.
2. Abra **Storage**. Se esse item não aparecer no projeto, use a área **Storage** da sua equipe e depois conecte o recurso ao projeto.
3. Escolha criar um armazenamento **Blob** com acesso **Private**. O acesso Public não serve para esta integração.
4. Conecte o armazenamento ao projeto e ao ambiente **Production**. Adicione Preview se também quiser testar as publicações de prévia.
5. Confirme que existe a variável `BLOB_READ_WRITE_TOKEN` em Environment Variables. Se só houver `BLOB_STORE_ID`, use a opção de Read-write token do armazenamento e adicione o token como variável secreta `BLOB_READ_WRITE_TOKEN` no projeto. Não compartilhe esse valor no chat ou no GitHub.
6. Preserve `ADMIN_PASSWORD` e `ADMIN_SESSION_SECRET` já configuradas.
7. Publique um novo deploy depois de conectar o armazenamento.

O projeto usa Node.js **22.x**, Framework **Other**, Build Command `node build.mjs` e Output Directory `public`. O build precisa instalar as dependências do package-lock.json; mantenha o Install Command automático.

## Primeiro envio dos dados antigos

1. Abra o painel **no computador e no domínio que já contêm seus dados**. Um domínio diferente tem uma cópia local diferente.
2. Faça uma cópia de segurança antes da primeira sincronização.
3. Clique em **Sincronizar agora** e aguarde **Salvo online**.
4. Abra o mesmo endereço no celular, entre e clique em **Sincronizar agora**.
5. Confira um cliente/projeto e baixe um HTML ou ZIP anexado pelo computador.

O primeiro upload depende da conexão do aparelho que guarda os arquivos. O servidor não consegue ler arquivos que existem apenas no navegador de um PC fechado. Backups antigos podem ser restaurados na seção Backup do painel antes do envio.

## Durante o uso

- **Salvo online**: o envio foi confirmado e o conteúdo pode ser recebido por outros aparelhos.
- **Enviando / aguardando**: mantenha a página aberta até terminar.
- **Sem internet / falha**: a cópia local fica preservada; reconecte e sincronize novamente.
- **Armazenamento não configurado**: não há confirmação online; confira o token e o novo deploy.
- **Resolver diferenças**: o mesmo registro foi alterado nos dois aparelhos. Escolha a versão que deseja manter. Antes de aplicar, é baixada uma cópia local com os anexos originais.

Os downloads privados usam links temporários válidos por até 15 minutos. A prévia de HTML é isolada em sandbox e não executa um backend. Esta configuração compartilha arquivos e dados privados; não hospeda automaticamente os sites públicos dos clientes.

## Limites e manutenção

Uploads grandes vão do navegador diretamente ao Blob, sem passar pelo corpo da função Vercel. O conteúdo de cada registro serializado tem limite de 200 MB, incluindo base64 e ZIP original. O índice aceita 5.000 registros. Conteúdo acima do limite permanece local, e o indicador mostra a falha.

Versões anteriores e uploads sem confirmação podem permanecer no storage para preservar arquivos em caso de interrupção. Excluir no painel remove a referência sincronizada; uma limpeza física de versões históricas deve ser planejada separadamente. Monitore o uso e os limites do plano na Vercel.
