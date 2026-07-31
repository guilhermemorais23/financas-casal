-- PAR. database schema
-- Conventions: uuid PKs, numeric(12,2) for money, timestamptz for timestamps.
-- No ORM: this file is the single source of truth for the schema.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- couples: a pair of users. Membership is derived from users.couple_id, not
-- stored here, so this table has no FK back to users.
-- ---------------------------------------------------------------------------
CREATE TABLE couples (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nickname    text,
  emoji       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------
CREATE TABLE users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email          text NOT NULL UNIQUE,
  password_hash  text NOT NULL,
  display_name   text NOT NULL,
  couple_id      uuid REFERENCES couples(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_users_couple_id ON users(couple_id);

-- ---------------------------------------------------------------------------
-- couple_invites: backs "Criar conta do casal" / "Já tenho um convite".
-- A couple is capped at two members; that's enforced in application code on
-- invite-accept, not here (expressing "exactly 2" cleanly needs a trigger).
-- ---------------------------------------------------------------------------
CREATE TABLE couple_invites (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id    uuid NOT NULL REFERENCES couples(id) ON DELETE CASCADE,
  inviter_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token        text NOT NULL UNIQUE,
  status       text NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
  accepted_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  expires_at   timestamptz NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  accepted_at  timestamptz
);

CREATE INDEX idx_couple_invites_token ON couple_invites(token);
CREATE INDEX idx_couple_invites_couple_id ON couple_invites(couple_id);

-- ---------------------------------------------------------------------------
-- accounts: personal (owner_user_id set) or joint (owner_user_id NULL).
-- Models "Contas separadas + conjunta".
-- ---------------------------------------------------------------------------
CREATE TABLE accounts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id      uuid NOT NULL REFERENCES couples(id) ON DELETE CASCADE,
  owner_user_id  uuid REFERENCES users(id) ON DELETE CASCADE,
  type           text NOT NULL CHECK (type IN ('personal', 'joint')),
  name           text NOT NULL,
  emoji          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT personal_has_owner CHECK (
    (type = 'personal' AND owner_user_id IS NOT NULL) OR
    (type = 'joint' AND owner_user_id IS NULL)
  )
);

CREATE INDEX idx_accounts_couple_id ON accounts(couple_id);
CREATE INDEX idx_accounts_owner_user_id ON accounts(owner_user_id);

-- ---------------------------------------------------------------------------
-- categories: couple_id NULL = global default category (seeded below).
-- Automatic categorization later just populates transactions.category_id.
-- ---------------------------------------------------------------------------
CREATE TABLE categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id   uuid REFERENCES couples(id) ON DELETE CASCADE,
  name        text NOT NULL,
  emoji       text,
  is_default  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (couple_id, name)
);

CREATE INDEX idx_categories_couple_id ON categories(couple_id);

-- ---------------------------------------------------------------------------
-- transactions: expenses/income. created_by is tracked separately from
-- payer_id because visibility (is_private) is keyed off who *logged* the
-- entry, not who paid -- one partner can pay for something the other
-- partner privately logs.
--
-- PRIVACY RULE (enforce in every query returning transaction rows, in SQL,
-- never filtered after the fact in application code):
--   WHERE couple_id = $1 AND (is_private = false OR created_by = $2)
-- Balance totals derived from private transactions may still be exposed
-- (the amount owed is real); the row's description/category must not leak.
-- ---------------------------------------------------------------------------
CREATE TABLE transactions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id         uuid NOT NULL REFERENCES couples(id) ON DELETE CASCADE,
  account_id        uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  category_id       uuid REFERENCES categories(id) ON DELETE SET NULL,
  payer_id          uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_by        uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  description       text NOT NULL,
  amount            numeric(12,2) NOT NULL CHECK (amount > 0),
  transaction_type  text NOT NULL DEFAULT 'expense' CHECK (transaction_type IN ('expense', 'income')),
  occurred_at       date NOT NULL,
  is_private        boolean NOT NULL DEFAULT false,
  split_type        text NOT NULL DEFAULT 'none'
                    CHECK (split_type IN ('none', 'equal', 'proportional', 'by_category', 'custom')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_transactions_couple_id ON transactions(couple_id);
CREATE INDEX idx_transactions_account_id ON transactions(account_id);
CREATE INDEX idx_transactions_category_id ON transactions(category_id);
CREATE INDEX idx_transactions_payer_id ON transactions(payer_id);
CREATE INDEX idx_transactions_occurred_at ON transactions(occurred_at);
CREATE INDEX idx_transactions_couple_private ON transactions(couple_id, is_private);

-- ---------------------------------------------------------------------------
-- transaction_splits: one row per user per transaction. Every split_type
-- other than 'none' materializes two rows summing to transactions.amount.
-- Written at write-time (not computed at read-time) so the balance view
-- below is a single uniform join with no per-split-type branching.
-- ---------------------------------------------------------------------------
CREATE TABLE transaction_splits (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id  uuid NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  share_amount    numeric(12,2) NOT NULL CHECK (share_amount >= 0),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (transaction_id, user_id)
);

CREATE INDEX idx_transaction_splits_transaction_id ON transaction_splits(transaction_id);
CREATE INDEX idx_transaction_splits_user_id ON transaction_splits(user_id);

-- ---------------------------------------------------------------------------
-- couple_balances: "quem deve quem", computed from source rows -- never a
-- mutable stored balance, so it can't drift from the transaction log.
-- App code nets the (at most two) resulting rows into one signed figure.
-- A future "mark as settled" feature would add a settlements table as
-- another input to that net calculation, with zero migration here.
-- ---------------------------------------------------------------------------
CREATE VIEW couple_balances AS
SELECT
  t.couple_id,
  t.payer_id           AS paid_by,
  ts.user_id           AS owed_by,
  SUM(ts.share_amount) AS total_owed
FROM transactions t
JOIN transaction_splits ts ON ts.transaction_id = t.id
WHERE ts.user_id <> t.payer_id
  AND t.transaction_type = 'expense'
GROUP BY t.couple_id, t.payer_id, ts.user_id;

-- ---------------------------------------------------------------------------
-- goals: current_amount is maintained directly by app code on contribution
-- (not derived) since contributions are explicit, low-frequency actions.
-- achieved_at is set once current_amount >= target_amount, driving the
-- milestone/celebration moment client-side.
-- ---------------------------------------------------------------------------
CREATE TABLE goals (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id       uuid NOT NULL REFERENCES couples(id) ON DELETE CASCADE,
  name            text NOT NULL,
  emoji           text,
  target_amount   numeric(12,2) NOT NULL CHECK (target_amount > 0),
  current_amount  numeric(12,2) NOT NULL DEFAULT 0 CHECK (current_amount >= 0),
  deadline        date,
  achieved_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_goals_couple_id ON goals(couple_id);

-- ---------------------------------------------------------------------------
-- budgets: "spent so far" is computed at query time from transactions, not
-- stored. category_id NULL = whole-couple budget for that month. No
-- automatic rollover between months (explicit deferral).
-- ---------------------------------------------------------------------------
CREATE TABLE budgets (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id     uuid NOT NULL REFERENCES couples(id) ON DELETE CASCADE,
  period_month  date NOT NULL,
  cap_amount    numeric(12,2) NOT NULL CHECK (cap_amount > 0),
  category_id   uuid REFERENCES categories(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (couple_id, period_month, category_id)
);

CREATE INDEX idx_budgets_couple_id_period ON budgets(couple_id, period_month);

-- ---------------------------------------------------------------------------
-- recurring_bills: aluguel/condomínio/internet-style reminders.
-- ---------------------------------------------------------------------------
CREATE TABLE recurring_bills (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id         uuid NOT NULL REFERENCES couples(id) ON DELETE CASCADE,
  name              text NOT NULL,
  amount            numeric(12,2) NOT NULL CHECK (amount > 0),
  category_id       uuid REFERENCES categories(id) ON DELETE SET NULL,
  due_day           smallint NOT NULL CHECK (due_day BETWEEN 1 AND 31),
  recurrence        text NOT NULL DEFAULT 'monthly' CHECK (recurrence IN ('monthly', 'weekly', 'yearly')),
  is_active         boolean NOT NULL DEFAULT true,
  last_notified_at  timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_recurring_bills_couple_id ON recurring_bills(couple_id);

-- Reports/extract ("Extrato compartilhado", "Relatórios claros") have no
-- dedicated table -- they're satisfied by querying transactions (joined with
-- categories, filtered by couple_id/date range/privacy predicate) using the
-- indexes defined above.
