# PAR.

Finanças a dois — controle de gastos, metas e orçamento compartilhado para casais.

## Stack

- **Frontend**: React + Vite + TypeScript (`frontend/`)
- **Backend**: Node.js + Express + TypeScript, SQL puro via `pg` (`backend/`)
- **Banco de dados**: PostgreSQL, rodando localmente via Docker Compose (`db/schema.sql`, `db/seed.sql`)
- **Auth**: JWT (registro/login com senha hasheada via bcryptjs)

## Pré-requisitos

- Node.js 20+
- Docker Desktop (para o Postgres local)

## Setup

1. Copie os arquivos de exemplo de variáveis de ambiente:
   ```
   cp .env.example .env
   cp backend/.env.example backend/.env
   cp frontend/.env.example frontend/.env
   ```
2. Instale as dependências:
   ```
   npm install
   npm --prefix backend install
   npm --prefix frontend install
   ```

## Rodando

```
npm run dev
```

Isso sobe o Postgres (Docker), o backend (`http://localhost:4000`) e o frontend (`http://localhost:5173`) juntos.

Ou individualmente:
```
npm run db:up            # sobe só o Postgres
npm --prefix backend run dev
npm --prefix frontend run dev
```

**Importante**: `db/schema.sql` e `db/seed.sql` só são executados na *primeira* inicialização do container (volume vazio). Se você editar o schema depois, rode `npm run db:reset` para recriar o banco do zero.

## Verificando que funciona

1. `docker exec -it fincae_db psql -U fincae -d fincae -c '\dt'` — deve listar todas as tabelas.
2. Acesse `http://localhost:5173/register`, crie uma conta → deve redirecionar para `/dashboard` mostrando seu nome.
3. Atualize a página do dashboard → deve continuar logado (token persistido).
4. `GET http://localhost:4000/api/me` sem header → `401`; com o token retornado no registro/login → `200` com os dados do usuário.

## O que já existe

- Schema completo do banco (usuários, casais, convites, contas pessoais/conjunta, transações com split e saldo "quem deve quem", categorias, metas, orçamento, contas recorrentes).
- Registro e login com JWT, rota protegida de exemplo (`GET /api/me`).
- Casal: criar casal, convidar parceiro(a) por link, aceitar convite (`/api/couples`).
- Transações: criar (com split 50/50 opcional), listar (com filtro por mês), excluir, saldo "quem deve quem" e resumo mensal por categoria/pagador.
- Metas (`/api/goals`): criar, listar, contribuir, remover.
- Orçamento (`/api/budgets`): definir/consultar teto mensal do casal, com gasto já calculado.
- Frontend completo com navegação lateral (Painel, Nova despesa, Metas, Relatórios, Conta):
  - Painel com saldo da conta conjunta, gasto do mês por pessoa, progresso do orçamento e extrato recente.
  - Nova despesa (formulário completo: conta, categoria, pagador, divisão, privacidade).
  - Metas com barra de progresso e contribuições.
  - Relatórios com quebra por categoria e extrato do mês (com exclusão).
  - Conta com membros, contas (saldo), convite e definição de orçamento.

## O que falta (próxima etapa)

Contas recorrentes (aluguel/assinaturas), "marcar como pago" (settlement) para além do saldo bruto, alertas inteligentes, refresh token, e mover o token para um cookie httpOnly antes de qualquer deploy real.
