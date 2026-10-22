# PAR.

Finanças em grupo (casal, família, amigos): cada pessoa vê o próprio saldo e o do grupo, com contas, cartões, metas e orçamento num lugar só.

**No ar:** https://par-projeto.web.app

## Como é feito

- **Frontend**: React + Vite + TypeScript (`frontend/`), no Firebase Hosting
- **Backend**: Node.js + Express + TypeScript (`backend/`), no Render
- **Banco e login**: Firebase (Firestore e Authentication)

O frontend só conversa com o backend, pelo endereço da variável `VITE_API_URL` (lida em `frontend/src/api/client.ts`). O backend é dividido em módulos (`backend/src/modules/`), e cada um explica o que faz no topo do seu `*.routes.ts`. O mapa de todos os endereços `/api/...` fica em `backend/src/app.ts`.

## Onde ler mais

- [CONTRIBUTING.md](CONTRIBUTING.md): rodar no seu PC, testes, branches e commits
- [DEPLOY.md](DEPLOY.md): como o app é publicado (automático no merge pro `master`)
- [CHANGELOG.md](CHANGELOG.md): o que mudou em cada versão
