# Integração Promisa → Pixel ("o que tenho pra entregar hoje?")

Contrato entre o Promisa (este repositório) e o Pixel (`xdzinjesus/jarvis-pessoal`).
Referência do lado do Pixel: PR #1 (https://github.com/xdzinjesus/jarvis-pessoal/pull/1).
Regra de coordenação: mudanças que afetem a consulta de prazos, as permissões ou os campos abaixo
são registradas no PR do Promisa com o link do PR correspondente do Pixel.

## Como funciona (mínimo de uso do Blob)
1. O dono abre o painel. O navegador monta a **fonte da agenda** (tudo que tem prazo e não foi entregue),
   criptografa com a **chave do Pixel** e envia para `promisa/pixel/v1/agenda.json` — **só quando o conteúdo muda**
   (impressão digital SHA-256 guardada no aparelho). A fonte não depende do dia, então não muda à meia-noite.
2. O Pixel lê `GET https://promisa.online/api/pixel?action=agenda` com `Authorization: Bearer <PIXEL_TOKEN>`.
   A rota é só leitura, guarda a agenda 5 min na memória e responde `304` com `If-None-Match` igual ao `ETag`.
3. O servidor nunca vê o conteúdo: o envelope é AES-GCM 256 e a chave só existe no painel do dono e no Pixel.

Custo: 1 gravação por mudança de prazo/entrega; ≤ 1 leitura do Blob a cada 5 min de perguntas.

## Segredos (nunca no chat nem no código)
- `PIXEL_TOKEN`: criado pelo dono na Vercel (Settings → Environment Variables), 32+ caracteres. Sem ele a rota responde 503.
- Chave do Pixel: gerada no painel em **Entregas → Conectar ao Pixel → Gerar chave do Pixel** (base64 de 32 bytes, 44 caracteres).
  Fica no cofre do dono (`settings:pixelKey`, criptografado) e não é liberada para sócios.

## Resposta da rota
`200` com o envelope:
```json
{ "v": 1, "alg": "A256GCM", "aad": "promisa-pixel-v1", "iv": "<base64 12 bytes>", "ct": "<base64>", "updatedAt": "2026-11-17T17:32:10.000Z" }
```
Erros: `401` token errado · `404` agenda ainda não gerada (abrir o painel uma vez) · `405` método diferente de GET · `503` sem `PIXEL_TOKEN` ou Blob indisponível.

Decifrar em Python (biblioteca `cryptography`):
```python
import base64, json
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
def abrir(envelope: dict, chave_b64: str) -> dict:
    aes = AESGCM(base64.b64decode(chave_b64))
    plain = aes.decrypt(base64.b64decode(envelope["iv"]), base64.b64decode(envelope["ct"]), b"promisa-pixel-v1")
    return json.loads(plain)
```

## Conteúdo decifrado (fonte da agenda)
```json
{
  "version": 1, "timezone": "America/Sao_Paulo", "updatedAt": "2026-11-17T17:32:10.000Z", "semPrazo": 4,
  "items": [
    { "type": "entrega", "id": "mwl9go9ffh2", "title": "Teph Kaetano", "stage": "Fechado", "plan": "profissional",
      "done": 12, "total": 15, "pct": 80, "missing": ["Domínio ligado", "Treinamento do cliente"],
      "due": "2026-11-17", "url": "https://promisa.online/admin?tab=clients&cliente=mwl9go9ffh2&aba=entregas" },
    { "type": "projeto", "id": "p1", "title": "Portfólio", "stage": "Em andamento", "plan": "", "done": 0, "total": 0,
      "pct": 0, "missing": [], "due": "2026-11-18", "url": "https://promisa.online/admin?tab=projects" }
  ]
}
```
Não vêm: telefone, valores, pagamentos, respostas de formulário, extratos.

## Regra (a mesma de `src/agenda.js`; o Pixel aplica com o dia de hoje)
- **Hoje** = data em `America/Sao_Paulo` (`AAAA-MM-DD`).
- Para cada item, `diff = due − hoje` em dias:
  `diff < 0` → **atrasada** · `diff = 0` → **vence hoje** · `1 ≤ diff ≤ 7` → **próximos dias** · `diff > 7` → não aparece.
- Ordem: atrasadas, vence hoje, próximos; dentro de cada grupo, prazo mais cedo primeiro, depois nome.
- `semPrazo`: clientes Fechados com entrega incompleta e sem prazo (só a contagem: "e 4 sem prazo").
- Já filtrado pelo painel: clientes na lixeira, Perdidos, entregas completas e projetos Concluídos/Pausados não entram.
- Se `updatedAt` tiver mais de 1 dia, avisar "atualizado em …" (a agenda reflete a última vez que o painel foi aberto).

## Onde o prazo fica no Promisa
- Cliente: campo `prazo` (`AAAA-MM-DD`) — definido no cadastro (**Novo cliente → Mais detalhes → Prazo de entrega**)
  e alterável a qualquer momento na ficha (Resumo) e no cartão da tela Entregas.
- Projeto pessoal: `dueDate` (tela Projetos).

## Link direto da ficha
`/admin?tab=clients&cliente=<id>&aba=entregas` abre a ficha na aba Entregas. Sem sessão, passa pelo login
(`/acesso.html?next=…`) e volta para a ficha.

## Testes que garantem o contrato
`tests/agenda.test.mjs` (regra e envelope), `tests/pixel.test.mjs` (rota, cache, login), `tests/browser/prazos.spec.js`.
