import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { apiRequest, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { useConfirm } from "../components/ConfirmDialog";
import { Icon } from "../components/Icon";
import { useToast } from "../components/ToastProvider";
import { AppLayout } from "../layouts/AppLayout";
import { formatCurrency } from "../utils/format";
import { TERMS_VERSION } from "./TermsPage";

type AccessState = "trial" | "active" | "past_due" | "canceled_active" | "courtesy" | "free";
type Plan = "monthly" | "yearly";

export interface BillingInfo {
  entitlement: { billingEnabled: boolean; premium: boolean; state: AccessState; endsAt: number | null };
  prices: { monthly: number; yearly: number };
  trialDays: number;
  termsVersion: string;
  subscription: {
    status: string;
    plan: Plan | null;
    currentPeriodEnd: number | null;
    pendingInvoiceUrl: string | null;
    payerName: string | null;
    isPayer: boolean;
    canRefund: boolean;
  } | null;
}

// O que cada plano tem -- a mesma lista dos Termos de uso (item 3).
const FREE_FEATURES = [
  "Lançamentos, Painel e Par sem limite",
  "Grupo com quantas pessoas quiser",
  "Cartões, dívidas, contas fixas e metas",
  "Relatórios na tela",
  "Assistente simples: \"gastei 50 no mercado\"",
];
const PREMIUM_FEATURES = [
  "Assistente com IA no app, Telegram e WhatsApp (entende qualquer mensagem e áudio)",
  "Importar extrato do banco (OFX/CSV)",
  "Exportar os lançamentos (CSV)",
  "Link pra compartilhar relatório",
];

function day(ms: number): string {
  return new Date(ms).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
}

function daysLeft(ms: number): number {
  return Math.max(0, Math.ceil((ms - Date.now()) / (24 * 60 * 60 * 1000)));
}

function maskDocument(value: string): string {
  const d = value.replace(/\D/g, "").slice(0, 14);
  if (d.length <= 11) {
    return d.replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d{1,2})$/, "$1-$2");
  }
  return d.replace(/^(\d{2})(\d)/, "$1.$2").replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3").replace(/\.(\d{3})(\d)/, ".$1/$2").replace(/(\d{4})(\d)/, "$1-$2");
}

function StatusCard({ info }: { info: BillingInfo }) {
  const { entitlement: e, subscription: sub } = info;
  let title = "Plano Grátis";
  let text = "Tudo o que é essencial continua grátis. O Premium libera a IA e as ferramentas de extrato.";
  if (!e.billingEnabled) {
    title = "Tudo liberado";
    text = "Por enquanto todas as funções estão liberadas pra todo mundo, sem cobrança.";
  } else if (e.state === "trial" && e.endsAt) {
    title = `Premium grátis por mais ${daysLeft(e.endsAt)} dias`;
    text = `O teste acaba em ${day(e.endsAt)}. Depois disso o grupo volta pro Grátis se ninguém assinar — nada é apagado.`;
  } else if (e.state === "active" && e.endsAt) {
    title = "Premium ativo";
    text = `${sub?.plan === "yearly" ? "Plano anual" : "Plano mensal"}${sub?.payerName ? `, assinado por ${sub.payerName}` : ""}. Renova em ${day(e.endsAt)}.`;
  } else if (e.state === "past_due" && e.endsAt) {
    title = "Pagamento em atraso";
    text = `O Premium continua até ${day(e.endsAt)}. Depois disso o grupo volta pro Grátis até o pagamento.`;
  } else if (e.state === "canceled_active" && e.endsAt) {
    title = "Assinatura cancelada";
    text = `Sem novas cobranças. O Premium continua até ${day(e.endsAt)}.`;
  } else if (e.state === "courtesy") {
    title = "Premium de cortesia";
    text = e.endsAt ? `Presente da equipe PAR. até ${day(e.endsAt)}.` : "Presente da equipe PAR., sem prazo.";
  }
  return (
    <div className={`card plan-status${e.premium ? " is-premium" : ""}`}>
      <span className="plan-status-icon" aria-hidden="true">
        <Icon name={e.premium ? "spark" : "user"} className="icon" />
      </span>
      <div>
        <p className="card-title">{title}</p>
        <p className="card-subtitle">{text}</p>
      </div>
    </div>
  );
}

// Conta > Plano: situação do grupo, o que tem em cada plano, assinar e cancelar.
export function PlanPage() {
  const { token } = useAuth();
  const { showToast } = useToast();
  const confirm = useConfirm();
  const [info, setInfo] = useState<BillingInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [plan, setPlan] = useState<Plan>("monthly");
  const [documentNumber, setDocumentNumber] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  function load() {
    apiRequest<BillingInfo>("/billing", { token })
      .then(setInfo)
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : "Não foi possível carregar o plano."));
  }
  useEffect(load, [token]);

  async function handleSubscribe(event: FormEvent) {
    event.preventDefault();
    setError(null);
    // Abre a aba antes do await: navegador de celular bloqueia janela aberta
    // depois de uma espera.
    const tab = window.open("", "_blank");
    setIsBusy(true);
    try {
      const { invoiceUrl } = await apiRequest<{ invoiceUrl: string }>("/billing/checkout", {
        method: "POST",
        token,
        body: { plan, cpfCnpj: documentNumber, acceptTerms: accepted, termsVersion: TERMS_VERSION },
      });
      if (tab) tab.location.href = invoiceUrl;
      else window.location.assign(invoiceUrl);
      showToast("Página de pagamento aberta", { description: "Assim que o pagamento cair, o Premium é liberado." });
      load();
    } catch (err) {
      tab?.close();
      setError(err instanceof ApiError ? err.message : "Não foi possível abrir o pagamento.");
    } finally {
      setIsBusy(false);
    }
  }

  async function handleCancel(refund: boolean) {
    const ok = await confirm({
      title: refund ? "Cancelar e pedir o dinheiro de volta?" : "Cancelar a assinatura?",
      body: refund
        ? "O valor pago volta inteiro pelo mesmo meio de pagamento e o Premium acaba agora."
        : "Não haverá novas cobranças. O Premium continua até o fim do período já pago.",
      confirmLabel: refund ? "Cancelar e reembolsar" : "Cancelar assinatura",
      tone: "danger",
    });
    if (!ok) return;
    setIsBusy(true);
    try {
      await apiRequest("/billing/cancel", { method: "POST", token, body: { refund } });
      showToast(refund ? "Assinatura cancelada e reembolso pedido" : "Assinatura cancelada");
      load();
    } catch (err) {
      showToast("Não foi possível cancelar", { variant: "error", description: err instanceof ApiError ? err.message : undefined });
    } finally {
      setIsBusy(false);
    }
  }

  if (!info) {
    return (
      <AppLayout>
        <div className="page-stack">
          <h1>Plano</h1>
          {loadError ? <p className="alert" role="alert">{loadError}</p> : <p className="empty-state">Carregando...</p>}
        </div>
      </AppLayout>
    );
  }

  const { entitlement: e, subscription: sub, prices } = info;

  // Cobrança desligada (Admin > Assinaturas): nada de preço nem de assinatura.
  if (!e.billingEnabled) {
    return (
      <AppLayout>
        <div className="page-stack plan-page">
          <h1>Plano</h1>
          <StatusCard info={info} />
        </div>
      </AppLayout>
    );
  }
  const yearlySaving = prices.monthly * 12 - prices.yearly;
  const canSubscribe = e.billingEnabled && ["trial", "free", "canceled_active"].includes(e.state);
  const paying = sub && (e.state === "active" || e.state === "past_due") && sub.status !== "canceled";

  return (
    <AppLayout>
      <div className="page-stack plan-page">
        <h1>Plano</h1>
        <StatusCard info={info} />

        {sub?.pendingInvoiceUrl && e.billingEnabled && (
          <div className="card">
            <p className="card-title">{e.state === "past_due" ? "Pagar a cobrança em aberto" : "Pagamento em aberto"}</p>
            <p className="card-subtitle">Pix, boleto ou cartão, na página de pagamento do Asaas.</p>
            <a className="btn btn-primary" href={sub.pendingInvoiceUrl} target="_blank" rel="noreferrer">
              Abrir pagamento
            </a>
          </div>
        )}

        <div className="plan-compare">
          <div className="card">
            <p className="card-title">Grátis</p>
            <p className="plan-price">R$ 0</p>
            <ul className="plan-features">
              {FREE_FEATURES.map((f) => (
                <li key={f}>
                  <Icon name="check" className="icon" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="card plan-premium">
            <p className="card-title">Premium</p>
            <p className="plan-price">
              {formatCurrency(prices.monthly)}
              <small>/mês por grupo</small>
            </p>
            <p className="card-subtitle">Tudo do Grátis, mais:</p>
            <ul className="plan-features">
              {PREMIUM_FEATURES.map((f) => (
                <li key={f}>
                  <Icon name="spark" className="icon" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {canSubscribe && (
          <form className="card plan-checkout" onSubmit={handleSubscribe}>
            <p className="card-title">Assinar o Premium</p>
            <div className="segmented" role="radiogroup" aria-label="Plano">
              {(["monthly", "yearly"] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  role="radio"
                  aria-checked={plan === p}
                  className={`segmented-option${plan === p ? " active" : ""}`}
                  onClick={() => setPlan(p)}
                >
                  {p === "monthly" ? `Mensal · ${formatCurrency(prices.monthly)}` : `Anual · ${formatCurrency(prices.yearly)}`}
                </button>
              ))}
            </div>
            {plan === "yearly" && yearlySaving > 0 && (
              <p className="field-hint">Economia de {formatCurrency(yearlySaving)} por ano em relação ao mensal.</p>
            )}

            <div className="field">
              <label htmlFor="plan-document">CPF ou CNPJ de quem paga</label>
              <input
                id="plan-document"
                inputMode="numeric"
                autoComplete="off"
                value={documentNumber}
                onChange={(ev) => setDocumentNumber(maskDocument(ev.target.value))}
                placeholder="000.000.000-00"
                required
              />
              <p className="field-hint">Exigido pra emitir a cobrança. Vai direto pro Asaas e não fica guardado no PAR.</p>
            </div>

            <label className="plan-accept">
              <input type="checkbox" checked={accepted} onChange={(ev) => setAccepted(ev.target.checked)} />
              <span>
                Li e aceito os <Link to="/termos" target="_blank">termos de uso</Link> e a{" "}
                <Link to="/privacidade" target="_blank">política de privacidade</Link>.
              </span>
            </label>

            <ul className="plan-rules">
              <li>
                {plan === "monthly" ? formatCurrency(prices.monthly) + " por mês" : formatCurrency(prices.yearly) + " por ano"}, renovação
                automática. {e.state === "trial" && e.endsAt ? `A primeira cobrança vence em ${day(e.endsAt)}, quando o teste acaba.` : ""}
              </li>
              <li>Cancele quando quiser, aqui mesmo, sem multa.</li>
              <li>Até 7 dias depois de pagar, dá pra cancelar e receber o valor inteiro de volta.</li>
            </ul>

            {error && <p className="alert" role="alert">{error}</p>}
            <button type="submit" className="btn btn-primary" disabled={!accepted || isBusy || documentNumber.replace(/\D/g, "").length < 11}>
              {isBusy ? "Abrindo..." : "Continuar para o pagamento"}
            </button>
            <p className="field-hint">O pagamento (Pix, boleto ou cartão) é feito na página segura do Asaas.</p>
          </form>
        )}

        {paying && (
          <div className="card">
            <p className="card-title">Assinatura</p>
            {sub.isPayer ? (
              <>
                <p className="card-subtitle">
                  Cancelar para as próximas cobranças. O que já foi pago continua valendo até o fim do período.
                </p>
                <div className="plan-cancel-actions">
                  <button type="button" className="btn btn-outline" disabled={isBusy} onClick={() => handleCancel(false)}>
                    Cancelar assinatura
                  </button>
                  {sub.canRefund && (
                    <button type="button" className="btn btn-outline" disabled={isBusy} onClick={() => handleCancel(true)}>
                      Cancelar e receber o dinheiro de volta
                    </button>
                  )}
                </div>
                {sub.canRefund && <p className="field-hint">O reembolso integral vale até 7 dias depois do pagamento.</p>}
              </>
            ) : (
              <p className="card-subtitle">Quem assinou foi {sub.payerName ?? "outra pessoa do grupo"}. Só essa pessoa pode cancelar.</p>
            )}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
