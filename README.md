# PAR.

Finanças em grupo — controle de gastos, metas e orçamento compartilhado, sem limite de pessoas por grupo.

## Stack

- **Frontend**: React + Vite + TypeScript (`frontend/`)
- **Backend**: Node.js + Express + TypeScript (`backend/`)
- **Banco de dados**: Firebase Firestore
- **Auth**: Firebase Authentication (Google Sign-In + e-mail/senha)

Em produção: backend no [Render](https://render.com), frontend no Firebase Hosting. Detalhes em [DEPLOY.md](DEPLOY.md).

## Pré-requisitos

- Node.js 20+
- Uma conta Google (só necessário para rodar `firebase login` — usado pelo emulador local e pelo deploy do frontend, não para desenvolver no dia a dia)

## Setup local

1. Copie os arquivos de exemplo de variáveis de ambiente:
   ```
   cp backend/.env.example backend/.env
   cp frontend/.env.example frontend/.env
   ```
   Os valores padrão já apontam para o **emulador do Firebase** (projeto fake `demo-par`) — não precisa de nenhuma credencial real para desenvolver.

2. Instale as dependências:
   ```
   npm install
   npm --prefix backend install
   npm --prefix frontend install
   ```

## Rodando localmente

```
npm run dev
```

Isso sobe, juntos: o emulador do Firebase (Firestore na porta `8080`, Auth na `9099`, UI do emulador em `http://localhost:4001`), o backend (`http://localhost:4000`) e o frontend (`http://localhost:5173`).

Na primeira vez, popule as categorias padrão (em outro terminal, com o `npm run dev` já rodando):
```
npm run seed
```

Dados do emulador ficam salvos em `emulator-data/` entre execuções (import/export automático, configurado em `package.json`).

## Verificando que funciona

1. Acesse `http://localhost:4001` — UI do emulador, deve mostrar Firestore e Authentication rodando.
2. Acesse `http://localhost:5173/register`, crie uma conta (e-mail/senha ou Google) → deve redirecionar para o dashboard.
3. Atualize a página → deve continuar logado.
4. Crie um grupo, convide alguém (ou registre um segundo usuário e aceite o convite pelo link) e lance uma transação na conta conjunta.

## Testando antes de subir

Antes de dar push, rode em `backend/` e `frontend/`:
```
npm --prefix backend run build     # tsc — precisa compilar sem erros
npm --prefix frontend run build    # tsc -b && vite build
```

Não existe suíte de testes automatizados ainda — a verificação é manual, seguindo o roteiro acima (registro, grupo, transação conjunta e pessoal, metas, orçamento, dívidas, relatórios) contra o emulador.

## Fluxo de trabalho (branches, commits, deploy)

Veja [CONTRIBUTING.md](CONTRIBUTING.md) e [DEPLOY.md](DEPLOY.md).

## Estrutura do projeto

```
backend/src/modules/         # um módulo por domínio: groups, categories, transactions, goals, budgets, debts, users
backend/src/db/firestore.ts  # inicialização do Firebase Admin SDK
backend/src/utils/money.ts   # dinheiro em centavos (int) — evita bug de ponto flutuante
frontend/src/pages/          # uma página por rota
frontend/src/auth/           # AuthContext (Firebase Auth)
```

## O que já existe

- Auth via Firebase (Google + e-mail/senha), perfil criado automaticamente no primeiro login (`POST /api/me/bootstrap`).
- Grupos sem limite de pessoas: criar, convidar por link, aceitar convite, sair do grupo (`/api/groups`).
- Transações: criar (split igualitário entre quantos membros o grupo tiver), listar (filtro por mês/conta), editar, excluir, saldo "quem deve quem" par a par, resumo mensal por categoria/pagador.
- Metas (`/api/goals`): criar, listar, contribuir, remover.
- Orçamento (`/api/budgets`): teto mensal (geral ou por categoria) com gasto já calculado.
- Dívidas/parcelamentos (`/api/debts`): criar, marcar parcela como paga.
- Modelo de privacidade: contas/transações/dívidas pessoais só visíveis ao dono; itens da conta conjunta visíveis a qualquer membro do grupo.
- Frontend completo: Painel (individual), Par (conjunto, com orçamento e saldo por pessoa), Nova transação, Metas, Relatórios (com gráficos), Conta (membros, contas, convite, desvincular).

## O que falta (próximas etapas)

Contas recorrentes (aluguel/assinaturas), alertas inteligentes, refresh token / rotação de sessão mais robusta, testes automatizados, CI rodando `build` em cada PR.
