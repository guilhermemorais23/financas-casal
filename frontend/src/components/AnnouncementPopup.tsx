import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { apiRequest } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { isWelcomeTourOpen, isWelcomeTourPending, subscribeWelcomeTour } from "../utils/welcomeTour";
import { Icon, type IconName } from "./Icon";

export interface Announcement {
  id: string;
  icon: IconName;
  tag: string;
  title: string;
  text: string;
  bullets: string[];
  ctaLabel: string | null;
  ctaPath: string | null;
  audience: "all" | "user";
  targetUserId: string | null;
  targetName: string | null;
  active: boolean;
  seenCount: number;
  createdAt: number;
}

// Conteúdo do pop-up -- o mesmo no app e na prévia do Admin > Novidades.
export function AnnouncementContent({ announcement }: { announcement: Pick<Announcement, "icon" | "tag" | "title" | "text" | "bullets"> }) {
  return (
    <div className="welcome-tour-slide announcement-slide">
      <div className="welcome-tour-icon" aria-hidden="true">
        <Icon name={announcement.icon} className="icon" />
      </div>
      {announcement.tag && (
        <p className="welcome-tour-step">
          <span className="welcome-tour-tag">{announcement.tag}</span>
        </p>
      )}
      <h2 id="announcement-title">{announcement.title}</h2>
      <p className="welcome-tour-text">{announcement.text}</p>
      {announcement.bullets.length > 0 && (
        <ul className="welcome-tour-bullets">
          {announcement.bullets.map((bullet) => (
            <li key={bullet}>
              <Icon name="check" className="icon" />
              <span>{bullet}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Mesmas telas onde a apresentação de boas-vindas não aparece.
const HIDDEN_ON = ["/login", "/register", "/privacidade", "/termos", "/r/", "/invite/", "/group-setup"];

// Pop-ups mandados pelo Admin > Novidades: um de cada vez, cada um aparece
// uma vez só pra cada pessoa (o "já vi" fica no servidor, vale pra todos os
// aparelhos). Espera a apresentação de boas-vindas terminar pra não
// empilhar duas janelas.
export function AnnouncementPopup() {
  const { user, token } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [queue, setQueue] = useState<Announcement[]>([]);
  const fetchedFor = useRef<string | null>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);

  const hiddenHere = HIDDEN_ON.some((prefix) => location.pathname.startsWith(prefix));
  const tourOpen = useSyncExternalStore(subscribeWelcomeTour, () => !!user && isWelcomeTourOpen(user.id));
  const tourPending = !!user && (tourOpen || isWelcomeTourPending(user));

  // Busca uma vez por conta, na primeira tela em que o pop-up pode aparecer
  // (e depois que a apresentação de boas-vindas foi fechada).
  useEffect(() => {
    if (!user || !token || hiddenHere || tourPending || fetchedFor.current === user.id) return;
    fetchedFor.current = user.id;
    apiRequest<{ announcements: Announcement[] }>("/announcements/pending", { token })
      .then((res) => setQueue(res.announcements))
      .catch(() => {
        // Sem pop-up agora; tenta de novo quando o app abrir outra vez.
      });
  }, [user, token, hiddenHere, tourPending, location.pathname]);

  const current = !hiddenHere && !tourPending ? queue[0] : undefined;

  function done(goTo?: string | null) {
    if (!current) return;
    void apiRequest(`/announcements/${current.id}/seen`, { method: "POST", token }).catch(() => {});
    setQueue((prev) => prev.slice(1));
    if (goTo) navigate(goTo);
  }

  useEffect(() => {
    if (!current) return;
    primaryRef.current?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") done();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // done só lê `current`, que já é a dependência.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  if (!current) return null;

  return (
    <div className="modal-backdrop welcome-tour-backdrop">
      <div className="modal-panel welcome-tour" role="dialog" aria-modal="true" aria-labelledby="announcement-title" key={current.id}>
        <button type="button" className="welcome-tour-skip link-button" onClick={() => done()}>
          Fechar
        </button>
        <AnnouncementContent announcement={current} />
        {queue.length > 1 && <p className="announcement-count">Mais {queue.length - 1} depois deste</p>}
        <div className="modal-actions">
          {current.ctaPath && current.ctaLabel ? (
            <>
              <button type="button" className="btn btn-outline" onClick={() => done()}>
                Agora não
              </button>
              <button ref={primaryRef} type="button" className="btn btn-primary" onClick={() => done(current.ctaPath)}>
                {current.ctaLabel}
              </button>
            </>
          ) : (
            <button ref={primaryRef} type="button" className="btn btn-primary" onClick={() => done()}>
              Entendi
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
