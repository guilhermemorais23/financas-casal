# PAR.

Finanças em grupo — controle de gastos, metas e orçamento compartilhado, sem limite de pessoas por grupo.

## Stack

- **Frontend**: React + Vite + TypeScript (`frontend/`)
- **Backend**: Node.js + Express + TypeScript (`backend/`)
- **Banco de dados**: Firebase Firestore
- **Auth**: Firebase Authentication (Google, Apple e e-mail/senha)

Em produção: backend no [Render](https://render.com), frontend no Firebase Hosting. Os dois são publicados sozinhos pelo CI a cada push no `master`. Detalhes em [DEPLOY.md](DEPLOY.md).

## Pré-requisitos

- Node.js 20+ (o CI usa o 22)
- Java 21+ (o emulador do Firestore roda em Java; só pra rodar local e os testes)
- Uma conta Google (só necessário para rodar `firebase login` — usado pelo emulador local, não para desenvolver no dia a dia)

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

Pra entrar direto num Painel já preenchido (duas pessoas, conta conjunta com gastos divididos, conta fixa, cartão, dívida, meta, orçamento e empréstimos a receber), rode também:
```
npm run seed:demo
```
e entre em `http://localhost:5173/login` com **demo@par.local** / **demo1234** (a outra pessoa do grupo é **ana.demo@par.local**, mesma senha). Só funciona contra o emulador: não toca no Firebase de produção nem gasta a cota dele.

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

Além disso, siga o roteiro manual acima (registro, grupo, transação conjunta e pessoal, metas, orçamento, dívidas, relatórios) contra o emulador pra pegar o que os testes não cobrem. O CI (`.github/workflows/ci.yml`) roda os três — build do backend, testes e build do frontend — em todo pull request e em todo push no `master`.

## Fluxo de trabalho (branches, commits, deploy)

Veja [CONTRIBUTING.md](CONTRIBUTING.md) e [DEPLOY.md](DEPLOY.md).

## Estrutura do projeto

O frontend e o backend só conversam por HTTP. O endereço do backend fica numa única variável, `VITE_API_URL`, lida em `frontend/src/api/client.ts`. Todas as telas chamam `apiRequest()` dali, que junta esse endereço com o caminho do pedido e manda o token de login.

```
frontend/src/main.tsx            # primeiro arquivo que roda: liga o React e o roteador
frontend/src/App.tsx             # lista de rotas (qual página abre em cada endereço)
frontend/src/api/client.ts       # conversa com o backend (VITE_API_URL + token)
frontend/src/auth/               # AuthContext: quem está logado, entrar, sair
frontend/src/pages/              # uma página por rota (DashboardPage, BillsPage...)
frontend/src/components/         # pedaços reaproveitados (Sheet, Icon, avisos...)
frontend/src/layouts/            # a moldura do app (menu lateral, barra de baixo)
frontend/src/hooks/, utils/      # funções comuns (formatar R$ e datas, cache...)
frontend/src/index.css           # todo o visual: cores (tokens), botões, cards

backend/src/index.ts             # liga o servidor na porta
backend/src/app.ts               # monta o Express: CORS, limites e o mapa de rotas (/api/...)
backend/src/middleware/          # roda antes das rotas: login (auth.ts), erro, Premium
backend/src/modules/             # um módulo por assunto (lista abaixo)
backend/src/db/firestore.ts      # conexão com o Firestore (Firebase Admin SDK)
backend/src/utils/money.ts       # dinheiro em centavos (int) — evita bug de ponto flutuante
backend/src/utils/month.ts       # datas e meses no fuso de Brasília
```

A maioria dos módulos tem as mesmas 4 camadas: `*.routes.ts` (endereço → função), `*.controller.ts` (lê e valida o pedido), `*.service.ts` (regra de negócio) e `*.repository.ts` (lê e grava no Firestore). Os testes (`*.test.ts`) ficam ao lado do arquivo testado.

| Módulo | Endereço | O que faz |
|---|---|---|
| `users` | `/api/me` | perfil, primeiro login, excluir conta, sair de todos os dispositivos |
| `groups` | `/api/groups` | grupos, convites, membros, vários grupos por pessoa |
| `transactions` | `/api/transactions` | lançamentos, divisão, saldo entre pessoas, resumos, exportar |
| `categories` | `/api/categories` | categorias de gasto e de receita |
| `dashboard` | `/api/dashboard` | tudo que o Painel precisa, numa chamada só |
| `upcoming` | `/api/bills` | lista "o que vence" (faturas, parcelas, contas fixas) |
| `recurringBills` | `/api/recurring-bills` | contas fixas, contas sem valor certo e os avisos delas |
| `debts` | `/api/debts` | compras parceladas e contas "só esta vez" (1 parcela) |
| `cards` | `/api/cards` | cartões, compras, faturas, limite (inclusive garantido) |
| `goals` | `/api/goals` | metas, submetas, guardar e retirar |
| `budgets` | `/api/budgets` | teto do mês, geral e por categoria |
| `loans` | `/api/loans` | empréstimos ("A receber" e "Eu devo") |
| `shopping` | `/api/shopping` | lista de compras do casal |
| `statements` | `/api/statements` | importar extrato (PDF, OFX, CSV) e regras por nome |
| `openFinance` | `/api/open-finance` | conectar conta pelo Pluggy |
| `shares` | `/api/shares` | link público de leitura do extrato |
| `alerts` | `/api/alerts` | alertas inteligentes do Painel |
| `monthClose` | `/api/month-close` | fechamento do mês (resumo do mês anterior) |
| `reminders` | `/api/reminders` | trabalho diário: e-mails e avisos de vencimento |
| `push` | `/api/push` | notificação no celular (Web Push) |
| `assistant` | `/api/assistant` | assistente com IA (chat no app, Telegram, WhatsApp) |
| `quotes` | `/api/quotes` | cotações para a tela de Investimentos |
| `billing` | `/api/billing` | assinatura Premium pelo Asaas |
| `feedback` | `/api/feedback` | conversa de feedback entre usuário e dono |
| `announcements` | `/api/announcements` | novidades (pop-ups) enviadas pelo Admin |
| `admin` | `/api/admin` | painel do dono: usuários, diagnóstico, números de uso |
| `aiUsage`, `settings` | — | limite de IA por pessoa; chaves do app (cobrança, manutenção) |

## O que já existe

- **Login**: Firebase (Google, Apple e e-mail/senha; popup, com redirecionamento quando o popup não abre, como no app instalado no iPhone). Perfil criado no primeiro login (`POST /api/me/bootstrap`). **Excluir conta** (`DELETE /api/me`) apaga login, perfil, conta pessoal e tudo nela; o último membro leva o grupo junto. **Sair de todos os dispositivos** (`POST /api/me/revoke-sessions`): o backend confere a revogação do token em todo pedido (`checkRevoked` em `middleware/auth.ts`). Política de privacidade em `/privacidade` e termos em `/termos`.
- **Grupos** sem limite de pessoas: criar, convidar por link, aceitar, sair, remover integrante. Uma pessoa pode participar de **vários grupos separados** e trocar pelo seletor no topo.
- **Lançamentos**: criar (dividido igualmente entre o grupo ou não), listar com filtros, editar, excluir com **Desfazer**, **excluir vários de uma vez** (um dia inteiro ou escolhendo), série recorrente, **forma de pagamento** (crédito, débito, Pix, dinheiro), saldo "quem deve quem", resumo mensal e anual, exportar CSV.
- **Categorias**: padrão e do grupo; **receita tem categorias próprias**, começando só com "Receita".
- **Painel**: saldo do mês, quanto dá pra gastar por dia, o que vence em 7 dias, alertas inteligentes, avisos de conta a pagar, widgets (meta, cartão com limite), fechamento do mês e cache instantâneo entre meses já visitados. Botão de lançar com opções.
- **Contas** (lista única pelo que vence primeiro):
  - **Contas fixas**: lançam sozinhas todo mês (`/api/recurring-bills`). Pra contas que mudam de valor (celular, água, luz), dá pra marcar "Mais ou menos" (estimativa) ou "Não sei ainda": o PAR. avisa antes de vencer, com "Já paguei" e "Me lembre mais tarde".
  - **Conta só esta vez**: conta avulsa (boleto, multa, mensalidade atrasada), com categoria opcional. É uma dívida de 1 parcela; ao pagar, entra no extrato com a data do pagamento e a categoria escolhida.
  - **Parceladas**: compras em N parcelas, com dia de vencimento opcional.
- **Cartões**: compras, fatura atual, limite disponível, **limite em porcentagem com aviso aos 80%**, quanto volta a cada fatura paga. **Limite garantido** (o dinheiro guardado vira o limite): guardar e resgatar como transferência, fora de Entrada/Saída e relatórios.
- **Metas**: com prazo e mínimo por mês, **submetas**, guardar tirando da conta, retirar, histórico e "Não é gasto".
- **Orçamento**: teto mensal, geral ou por categoria.
- **Empréstimos**: "A receber" e "Eu devo", com pagamentos parciais.
- **Lista de compras** (para casal) e **Investimentos** (cotações).
- **Importar extrato**: PDF (inclusive com senha), OFX e CSV, com leitores conferidos com extratos reais (Bradesco, Nubank e outros), tela de revisão, duplicados desmarcados, categoria sugerida e regras por nome. **Open Finance pelo Pluggy**: conectar a conta e receber os lançamentos novos.
- **Avisos**: e-mail (Brevo) e **notificação no celular (Web Push)** antes de vencer fatura, parcela ou conta fixa; e-mail de fechamento do mês.
- **Assistente com IA**: chat no app, Telegram e WhatsApp, respondendo com os números reais do grupo. Tem limite de uso por pessoa.
- **Premium** (assinatura pelo Asaas): libera importar extrato, Open Finance, link de compartilhamento e exportar CSV (`middleware/requirePremium.ts`).
- **Exportar**: PDF do mês (impressão do navegador), CSV e link público de leitura (`/r/:token`, expira em 7 dias, revogável, nunca inclui lançamentos privados).
- **Admin** (só o dono): usuários (bloquear, redefinir senha, excluir a pedido), assinaturas, novidades (pop-ups por público), feedback em formato de chat, importações por banco, diagnóstico das configurações e alertas por e-mail quando algo quebra.
- **Privacidade**: contas, lançamentos e dívidas pessoais só aparecem pro dono; itens da conta conjunta, pra qualquer membro do grupo. A proteção é por dado, não por tela.
- **App**: PWA instalável, com service worker (o shell abre offline, os dados sempre vêm da rede), apresentação de boas-vindas pra conta nova, tema claro e escuro, menu de app no celular.
- **Qualidade**: suíte de testes automatizados (vitest contra o emulador) e CI no GitHub Actions rodando type-check, testes e build; no `master`, publica backend e frontend sozinho.

## O que falta (próximas etapas)

Nada em aberto no momento. Pra conferir qual commit está no ar depois de um deploy: `https://financas-casal-m496.onrender.com/api/health` responde `{"status":"ok","commit":"abc1234"}`, e é só comparar com o `git log` do `master`.
