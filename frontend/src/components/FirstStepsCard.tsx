import type { CSSProperties } from "react";
import { Link } from "react-router-dom";
import { Icon } from "./Icon";

export type StepId = "first_transaction" | "invite_partner" | "first_split" | "set_budget" | "first_goal";

export interface Checklist {
  steps: { id: StepId; done: boolean }[];
  completedAt: string | null;
}

// Texto de cada passo e onde a pessoa resolve ele. "Dividir" abre o lançar
// já com a divisão ligada (?dividir=1); o teto fica em Conta e grupo.
const STEPS: Record<StepId, { label: string; action: string; to: string }> = {
  first_transaction: { label: "Lance seu primeiro gasto", action: "Lançar", to: "/transactions/new" },
  invite_partner: { label: "Chame alguém pro grupo", action: "Convidar", to: "/account#convite" },
  first_split: { label: "Divida um gasto", action: "Dividir", to: "/transactions/new?dividir=1" },
  set_budget: { label: "Diga quanto quer gastar no mês", action: "Definir", to: "/account#orcamento" },
  first_goal: { label: "Crie uma meta", action: "Criar", to: "/goals" },
};

// Cores do confete: as da marca e duas da paleta das categorias.
const CONFETTI_COLORS = ["var(--coffee-500)", "var(--olive-500)", "var(--series-4)", "var(--series-3)", "var(--series-5)"];

// "Primeiros passos" no Painel: o que falta pra pessoa tirar proveito do app,
// com o atalho de cada um. Tudo feito: parabéns com um confete curto (sem
// animação pra quem pediu menos movimento) e "Fechar".
export function FirstStepsCard({ checklist, onDismiss }: { checklist: Checklist; onDismiss: () => void }) {
  const steps = checklist.steps.filter((step) => STEPS[step.id]);
  const done = steps.filter((step) => step.done).length;
  const total = steps.length;
  if (total === 0) return null;
  const allDone = done === total;

  if (allDone) {
    return (
      <section className="card first-steps is-done" aria-label="Primeiros passos">
        <div className="confetti" aria-hidden="true">
          {Array.from({ length: 18 }, (_, i) => (
            <i
              key={i}
              style={
                {
                  "--x": `${(i * 37) % 100}%`,
                  "--delay": `${(i % 6) * 0.08}s`,
                  "--spin": `${(i % 2 ? 1 : -1) * (180 + i * 20)}deg`,
                  background: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
                } as CSSProperties
              }
            />
          ))}
        </div>
        <span className="first-steps-done-icon" aria-hidden="true">
          <Icon name="check" />
        </span>
        <p className="card-title">Parabéns! Tudo pronto.</p>
        <p className="card-subtitle">Você já sabe o principal do PAR.</p>
        <button type="button" className="btn btn-outline btn-sm" onClick={onDismiss}>
          Fechar
        </button>
      </section>
    );
  }

  return (
    <section className="card first-steps" aria-label="Primeiros passos">
      <div className="section-header">
        <p className="card-title">Primeiros passos</p>
        <button type="button" className="link-button" onClick={onDismiss}>
          Dispensar
        </button>
      </div>
      <div className="first-steps-progress">
        <span>
          {done} de {total}
        </span>
        <div
          className="progress-track thin"
          role="progressbar"
          aria-label="Primeiros passos feitos"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={done}
        >
          <div className="progress-fill" style={{ width: `${(done / total) * 100}%` }} />
        </div>
      </div>
      <ul className="first-steps-list">
        {steps.map((step) => {
          const info = STEPS[step.id];
          return (
            <li key={step.id} className={`first-steps-row${step.done ? " is-done" : ""}`}>
              <span className="first-steps-check" aria-hidden="true">
                {step.done && <Icon name="check" />}
              </span>
              <span className="first-steps-label">
                {info.label}
                {step.done && <span className="sr-only"> (feito)</span>}
              </span>
              {!step.done && (
                <Link to={info.to} className="btn btn-outline btn-sm">
                  {info.action}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
