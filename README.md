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

```
npm run test:backend               # suíte automatizada (backend/src/**/*.test.ts), sobe e desliga o emulador sozinha
```

Além disso, siga o roteiro manual acima (registro, grupo, transação conjunta e pessoal, metas, orçamento, dívidas, relatórios) contra o emulador pra pegar o que os testes não cobrem. O CI (`.github/workflows/ci.yml`) roda os três — build do backend, testes e build do frontend — em todo push e pull request.

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
- Grupos sem limite de pessoas: criar, convidar por link, aceitar convite, sair do grupo, remover outro integrante (`/api/groups`).
- Transações: criar (split igualitário entre quantos membros o grupo tiver), listar (filtro por mês/conta/texto), editar (inclusive conta e pagador), excluir, cancelar ou editar o valor de uma série recorrente (só as ocorrências futuras), saldo "quem deve quem" par a par, resumo mensal e anual por categoria/pagador, exportar CSV (do mês ou tudo).
- Categorias: as padrão valem pra qualquer grupo; as criadas pelo grupo podem ser renomeadas, trocar de emoji ou ser excluídas.
- Metas (`/api/goals`): criar, listar, contribuir, remover.
- Orçamento (`/api/budgets`): teto mensal (geral ou por categoria) com gasto já calculado.
- Dívidas/parcelamentos (`/api/debts`): criar (com dia de vencimento opcional), marcar parcela como paga.
- Cartões (`/api/cards`): compras, fatura atual, lembrete de vencimento.
- Lembretes por e-mail (`/api/reminders/run`, chamado por um cron externo diário): avisa 3 dias antes do vencimento de fatura de cartão ou parcela de dívida, com dedupe pra nunca mandar duas vezes.
- Modelo de privacidade: contas/transações/dívidas pessoais só visíveis ao dono; itens da conta conjunta visíveis a qualquer membro do grupo — essa é a proteção de dados privados do app (não existe nem está planejado um bloqueio por PIN/biometria no nível de tela; a privacidade já é por dado, não por tela).
- Frontend completo: Painel (individual, com widgets e cache instantâneo entre meses já visitados), Par (conjunto, com orçamento e saldo por pessoa), Nova transação, Metas, Cartões, Dívidas, Lista de compras, Investimentos, Relatórios (gráficos, busca, visão anual, exportar), Conta (membros, contas, categorias, convite, desvincular). PWA com service worker (funciona offline pro shell, dados sempre vêm da rede).
- Suíte de testes automatizados (vitest, contra o emulador) e CI no GitHub Actions rodando type-check + testes + build em todo push/PR.

## O que falta (próximas etapas)

- **Contas recorrentes de verdade (aluguel/assinaturas)**: hoje "recorrência" é só criar N ocorrências futuras de uma vez na hora do lançamento — não existe um cadastro de "assinatura ativa" que gera o lançamento sozinha mês a mês, indefinidamente, até você cancelar.
- **Alertas inteligentes**: hoje só existe o lembrete por e-mail de vencimento (cartão/dívida). Não existe nada que avise sobre padrão de gasto (ex.: "no ritmo atual você estoura o orçamento de Mercado em 5 dias" ou "gastou 40% a mais em Lazer que a média dos últimos meses").
- **Refresh token / rotação de sessão mais robusta**: o SDK do Firebase já renova o token sozinho em segundo plano, mas isso pausa em aba inativa (token pode ficar velho até você voltar) e o backend não verifica revogação (`checkRevoked`) nem existe um "sair de todos os dispositivos".
