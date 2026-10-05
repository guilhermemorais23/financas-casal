import { useEffect, useState } from "react";
import { ApiError, apiRequest } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { currentSubscription, disablePush, enablePush, isIos, isStandalone, PushError, pushSupported } from "../utils/push";
import { Icon } from "./Icon";
import { useToast } from "./ToastProvider";

// Conta e grupo > Avisos no celular: liga a notificação neste aparelho
// (vencimentos e lançamentos novos do banco). Some se o servidor não tiver as
// chaves de notificação.
export function PushSettingsCard() {
  const { token } = useAuth();
  const { showToast } = useToast();
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [isOn, setIsOn] = useState<boolean | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    apiRequest<{ publicKey: string | null }>("/push", { token })
      .then((res) => setPublicKey(res.publicKey))
      .catch(() => setPublicKey(null));
    currentSubscription()
      .then((sub) => setIsOn(!!sub))
      .catch(() => setIsOn(false));
  }, [token]);

  if (!publicKey) return null;

  const iosNeedsInstall = isIos() && !isStandalone();
  const supported = pushSupported() && !iosNeedsInstall;

  async function turnOn() {
    setIsBusy(true);
    try {
      await enablePush(token, publicKey!);
      setIsOn(true);
      const res = await apiRequest<{ delivered: number }>("/push/test", { method: "POST", token });
      showToast("Avisos ligados neste aparelho", {
        description: res.delivered > 0 ? "Mandamos uma notificação de teste." : undefined,
      });
    } catch (err) {
      showToast("Não deu pra ligar", {
        variant: "error",
        description: err instanceof PushError || err instanceof ApiError ? err.message : undefined,
      });
    } finally {
      setIsBusy(false);
    }
  }

  async function turnOff() {
    setIsBusy(true);
    try {
      await disablePush(token);
      setIsOn(false);
      showToast("Avisos desligados neste aparelho");
    } finally {
      setIsBusy(false);
    }
  }

  async function test() {
    setIsBusy(true);
    try {
      const res = await apiRequest<{ delivered: number }>("/push/test", { method: "POST", token });
      showToast(res.delivered > 0 ? "Notificação enviada" : "Nenhum aparelho recebeu", {
        variant: res.delivered > 0 ? "success" : "error",
        description: res.delivered > 0 ? undefined : "Desligue e ligue de novo os avisos neste aparelho.",
      });
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <div className="card push-card">
      <p className="card-title">Avisos no celular</p>
      <p className="card-subtitle">
        Fatura, parcela e conta fixa perto de vencer, e lançamentos novos do banco conectado. Continua chegando por email também.
      </p>
      {!supported ? (
        <p className="field-hint push-hint">
          <Icon name="info" />
          {iosNeedsInstall
            ? "No iPhone, primeiro adicione o PAR. à Tela de Início (no Safari: Compartilhar > Adicionar à Tela de Início) e abra por lá."
            : "Este navegador não recebe notificações. No celular, use o Chrome (Android) ou o app na Tela de Início (iPhone)."}
        </p>
      ) : isOn ? (
        <div className="push-actions">
          <span className="push-on">
            <Icon name="check" /> Ligado neste aparelho
          </span>
          <button type="button" className="btn btn-outline btn-sm" disabled={isBusy} onClick={() => void test()}>
            Mandar teste
          </button>
          <button type="button" className="link-button" disabled={isBusy} onClick={() => void turnOff()}>
            Desligar
          </button>
        </div>
      ) : (
        <button type="button" className="btn btn-primary btn-sm" disabled={isBusy || isOn === null} onClick={() => void turnOn()}>
          {isBusy ? "Ligando..." : "Ligar avisos neste aparelho"}
        </button>
      )}
    </div>
  );
}
