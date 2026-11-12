import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useLocation } from "react-router-dom";
import { apiRequest } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { useToast } from "./ToastProvider";
import { Icon, type IconName } from "./Icon";
import { isWelcomeTourOpen, isWelcomeTourPending, subscribeWelcomeTour } from "../utils/welcomeTour";
import {
  onboardingReopenCount,
  setOnboardingOpen,
  subscribeOnboarding,
  type Goal,
  type Preferences,
  type Usage,
} from "../utils/preferences";

const USAGES: { value: Usage; label: string; icon: IconName }[] = [
  { value: "solo", label: "Sozinho", icon: "user" },
  { value: "couple", label: "Com meu par", icon: "heart" },
  { value: "friends", label: "Com amigos", icon: "users" },
];

const GOALS: { value: Goal; label: string; icon: IconName }[] = [
  { value: "spending", label: "Controlar gastos", icon: "chart" },
  { value: "split", label: "Dividir contas", icon: "receipt" },
  { value: "debts", label: "Sair das dívidas", icon: "coin" },
  { value: "saving", label: "Juntar dinheiro", icon: "target" },
];

// Mesmas rotas em que a apresentação não aparece, mais a de criar grupo.
const HIDDEN_ON = ["/login", "/register", "/privacidade", "/termos", "/r/", "/invite/", "/group-setup"];

// Pergunta inicial, em 2 passos curtos, que monta o app do jeito da pessoa:
// com quem ela usa e o que quer resolver. O servidor transforma a resposta
// nas funções ligadas (Preferences.modules). Aparece pra quem nunca
// respondeu, só depois da apresentação de boas-vindas (nunca as duas
// juntas), e de novo pelo "Refazer as perguntas" da tela Conta e grupo.
export function OnboardingQuestions() {
  const { user, token, setPreferences } = useAuth();
  const { showToast } = useToast();
  const location = useLocation();
  const tourOpen = useSyncExternalStore(subscribeWelcomeTour, () => !!user && isWelcomeTourOpen(user.id));
  const reopened = useSyncExternalStore(subscribeOnboarding, onboardingReopenCount);
  // Fechou (respondeu ou pulou) nesta sessão: não volta enquanto o perfil
  // não chega com a resposta. Guarda o "Refazer" que fechou, pra abrir de
  // novo no próximo.
  const [closedAt, setClosedAt] = useState<number | null>(null);
  const [step, setStep] = useState<1 | 2>(1);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const firstChoiceRef = useRef<HTMLButtonElement>(null);

  const hiddenHere = HIDDEN_ON.some((prefix) => location.pathname.startsWith(prefix));
  const tourFirst = !!user && (tourOpen || isWelcomeTourPending(user));
  const wanted = reopened > 0 ? closedAt !== reopened : user?.preferences == null && closedAt === null;
  const open = !!user && !hiddenHere && !tourFirst && wanted;

  // Reaberto pelo "Refazer": começa do passo 1 com o que a pessoa já tinha.
  useEffect(() => {
    if (reopened === 0) return;
    setStep(1);
    setUsage(user?.preferences?.usage ?? null);
    setGoals(user?.preferences?.goals ?? []);
    // Só quando pedem pra reabrir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reopened]);

  useEffect(() => {
    if (open) firstChoiceRef.current?.focus();
  }, [open, step]);

  useEffect(() => {
    setOnboardingOpen(open);
    return () => setOnboardingOpen(false);
  }, [open]);

  if (!open) return null;

  async function save(body: { usage: Usage | null; goals: Goal[] }) {
    setIsSaving(true);
    try {
      const preferences = await apiRequest<Preferences>("/me/preferences", { method: "PUT", token, body });
      setPreferences(preferences);
      setClosedAt(reopened);
    } catch {
      showToast("Não deu pra salvar agora. Tente de novo.", { variant: "error" });
    } finally {
      setIsSaving(false);
    }
  }

  function toggleGoal(goal: Goal) {
    setGoals((current) => (current.includes(goal) ? current.filter((g) => g !== goal) : [...current, goal]));
  }

  const skip = () => void save({ usage: null, goals: [] });

  return (
    <div className="modal-backdrop welcome-tour-backdrop">
      <div className="modal-panel welcome-tour onboarding" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
        <button type="button" className="welcome-tour-skip link-button" onClick={skip} disabled={isSaving}>
          Pular
        </button>
        <p className="welcome-tour-step">{step} de 2</p>
        {step === 1 ? (
          <>
            <h2 id="onboarding-title">Você vai usar com quem?</h2>
            <div className="onboarding-choices" role="group" aria-labelledby="onboarding-title">
              {USAGES.map((option, index) => (
                <button
                  key={option.value}
                  ref={index === 0 ? firstChoiceRef : undefined}
                  type="button"
                  className={`onboarding-choice${usage === option.value ? " is-selected" : ""}`}
                  aria-pressed={usage === option.value}
                  onClick={() => setUsage(option.value)}
                >
                  <span className="onboarding-choice-icon" aria-hidden="true">
                    <Icon name={option.icon} />
                  </span>
                  {option.label}
                </button>
              ))}
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-primary" disabled={!usage} onClick={() => setStep(2)}>
                Continuar
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 id="onboarding-title">O que você quer resolver?</h2>
            <p className="welcome-tour-text">Pode marcar mais de um.</p>
            <div className="onboarding-choices is-grid" role="group" aria-labelledby="onboarding-title">
              {GOALS.map((option, index) => (
                <button
                  key={option.value}
                  ref={index === 0 ? firstChoiceRef : undefined}
                  type="button"
                  className={`onboarding-choice${goals.includes(option.value) ? " is-selected" : ""}`}
                  aria-pressed={goals.includes(option.value)}
                  onClick={() => toggleGoal(option.value)}
                >
                  <span className="onboarding-choice-icon" aria-hidden="true">
                    <Icon name={option.icon} />
                  </span>
                  {option.label}
                </button>
              ))}
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-outline" onClick={() => setStep(1)} disabled={isSaving}>
                Voltar
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={isSaving}
                onClick={() => void save({ usage, goals: GOALS.map((g) => g.value).filter((g) => goals.includes(g)) })}
              >
                {isSaving ? "Salvando..." : "Pronto"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
