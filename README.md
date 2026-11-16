# photo-selection

Site para um grupo de amigos juntar as fotos de uma viagem: cada um sobe as fotos no grupo e encontra, na própria página, as fotos em que aparece, no arquivo original. O reconhecimento usa uma selfie de referência por pessoa. Só o administrador cria grupos; os amigos entram pelo link de convite.

## Como é feito

- **Worker da Cloudflare** (TypeScript, Hono) em `src/worker/`: API em `/api/*`, contas, grupos, cotas, download e a fila de processamento, tocada por um cron a cada minuto.
- **Frontend** (React + Vite) em `src/web/`, servido como arquivos estáticos pelo mesmo Worker.
- **D1** para os registros (`migrations/`) e **R2** para os arquivos. O original é guardado byte a byte como chegou.
- **Container `face-service`** (`face-service/`, Python): o único lugar que abre imagens. Gera a versão de tela e a miniatura, detecta rostos e devolve os vetores. Só o Worker fala com ele.

## Rodar local

Requisitos: Node 22 ou mais novo e Docker rodando (o `npm run dev` constrói a imagem do `face-service`; a primeira vez demora).

```sh
npm install
cp .dev.vars.example .dev.vars   # preencha os valores
npm run db:migrate:local
npm run dev
```

Sem Docker, dá para subir só o Worker: `npm run build && npx wrangler dev --enable-containers=false --assets dist/client`. Nesse modo o site funciona como álbum: as fotos ficam "em análise" e já podem ser baixadas, e a separação por rosto começa quando o container existir.

Outros comandos: `npm run typecheck`, `npm test` (API do Worker contra D1 e R2 locais, com o container trocado por um dublê), `npm run build`. Depois de mudar o `wrangler.jsonc`, rode `npm run types` para regenerar `worker-configuration.d.ts`.

## Deploy

Exige o plano Workers Paid (por causa do container) e Docker rodando na máquina que faz o deploy.

```sh
npx wrangler d1 create photo-selection        # copie o database_id para o wrangler.jsonc
npx wrangler r2 bucket create photo-selection
npx wrangler secret put ADMIN_EMAIL           # repita para cada segredo abaixo
npm run db:migrate:remote
npm run deploy
```

## Segredos

Definidos com `wrangler secret put` em produção e em `.dev.vars` no ambiente local. Nenhum valor fica no repositório.

| Segredo | Para que serve |
|---|---|
| `ADMIN_EMAIL` | O e-mail da conta que administra o site. |
| `ADMIN_SETUP_CODE` | Código exigido para cadastrar o e-mail do administrador com senha. |
| `SESSION_SECRET` | Chave usada para guardar as sessões só em forma de hash. Trocar encerra todas as sessões. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Opcionais. Com os dois definidos, aparece "Entrar com Google". No console do Google, a URI de redirecionamento é `https://<seu-domínio>/api/auth/google/callback`. |

A senha é guardada como PBKDF2-SHA256 com 100.000 iterações e sal por usuário; 100.000 é o teto que o runtime dos Workers aceita.

## Licença dos modelos de rosto

O `face-service` usa os pesos `buffalo_l` do InsightFace, baixados na construção da imagem e nunca incluídos neste repositório. **Esses pesos são licenciados apenas para uso não comercial de pesquisa.** Este projeto é de uso pessoal entre amigos; qualquer uso comercial exige outros modelos ou uma licença própria.
