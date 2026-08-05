# Deploy

Produção usa um projeto real do Firebase (`par-projeto`): **Render** hospeda o backend, **Firebase Hosting** hospeda o frontend, e ambos falam com o **Firestore/Auth reais** desse projeto (não o emulador).

Isso só roda depois que um PR de `desenvolvimento` foi mergeado em `master` — veja [CONTRIBUTING.md](CONTRIBUTING.md) para o fluxo de branches.

## Backend (Render)

Deploy automático: o serviço no Render está conectado ao repositório do GitHub e configurado para redeployar sozinho a cada push em `master`. Não precisa rodar nada manualmente — só mergear o PR.

URL atual: `https://financas-casal-m496.onrender.com` (plano free — "dorme" depois de um tempo sem uso; a primeira requisição depois disso demora alguns segundos pra acordar).

Configuração do serviço (só precisa mexer se for recriar o serviço do zero):
- **Root Directory**: `backend`
- **Runtime**: Docker (usa `backend/Dockerfile`)
- **Environment variables**:
  - `FIREBASE_PROJECT_ID=par-projeto`
  - `GOOGLE_APPLICATION_CREDENTIALS=/etc/secrets/serviceAccountKey.json`
  - `ALLOWED_ORIGIN=<URL do Firebase Hosting>` — restringe quem pode chamar a API. Atualizar sempre que a URL do frontend mudar.
- **Secret Files** (Render → aba Environment → Secret Files): arquivo `serviceAccountKey.json` com o conteúdo da chave de service account do Firebase (gerada em Firebase Console → Configurações do projeto → Contas de serviço → Gerar nova chave privada). O Render monta isso em `/etc/secrets/serviceAccountKey.json` — é por isso que `GOOGLE_APPLICATION_CREDENTIALS` aponta pra lá, não pro `.env`.

A chave de service account **nunca** vai pro Git (está no `.gitignore`) nem entra na imagem Docker (está no `.dockerignore`) — só existe no Render como Secret File.

## Frontend (Firebase Hosting)

Deploy manual, depois do merge em `master`:

```
cd frontend
npm run build
cd ..
firebase deploy --only hosting --project par-projeto
```

Isso builda com as variáveis de `frontend/.env.production` (já aponta pro backend do Render e pro Firebase real — ver arquivo) e publica o conteúdo de `frontend/dist`.

Primeira vez numa máquina nova: `firebase login` (abre o navegador pra logar com a conta Google que tem acesso ao projeto `par-projeto`). Só precisa rodar `firebase deploy` de novo pra publicar update — não precisa logar toda vez.

## Depois de um novo deploy do frontend

Se a URL do Hosting mudou (só acontece se o projeto Firebase mudar — normalmente fica fixa em `https://par-projeto.web.app` / `https://par-projeto.firebaseapp.com`), atualizar `ALLOWED_ORIGIN` no Render com essa URL e deixar o serviço redeployar.

## Firestore: regras e índices

```
firebase deploy --only firestore:rules,firestore:indexes --project par-projeto
```

Só precisa rodar isso se `firestore.rules` ou `firestore.indexes.json` mudaram.

## Setup do zero (só se for recriar o projeto Firebase do zero)

1. Criar o projeto no [Firebase Console](https://console.firebase.google.com).
2. Firestore Database → Criar banco de dados → modo Nativo.
3. Authentication → Sign-in method → ativar **E-mail/senha** e **Google**.
4. Configurações do projeto → Contas de serviço → gerar chave privada → usar como Secret File no Render (acima).
5. Configurações do projeto → Geral → apps Web → copiar o `firebaseConfig` (apiKey, authDomain, projectId) pro `frontend/.env.production`.
6. `.firebaserc` já mapeia `production` → `par-projeto`; ajustar se o project ID for outro.
