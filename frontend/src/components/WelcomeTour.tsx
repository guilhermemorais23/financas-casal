import { useEffect, useRef, useState, type TouchEvent } from "react";
import { useLocation } from "react-router-dom";
import { apiRequest } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { isWelcomeTourPending, markWelcomeTourShown, setWelcomeTourOpen } from "../utils/welcomeTour";
import { BrandMark } from "./Brand";
import { Icon, type IconName } from "./Icon";

interface Slide {
  icon: IconName | "brand";
  // Etiqueta pequena acima do título ("Novidade") -- marca o que mudou pra
  // quem já usa o app.
  tag?: string;
  title: string;
  text: string;
  bullets?: string[];
}

const SLIDES: Slide[] = [
  {
    icon: "brand",
    title: "Bem-vindos ao PAR.",
    text: "O app pra organizar o dinheiro junto com quem divide a vida com você -- casal, família ou amigos. Tudo num lugar só, sem planilha e sem briga.",
    bullets: ["Quem pagou e quem deve pra quem", "Contas, cartões, dívidas e metas juntos", "No celular, funciona como um app"],
  },
  {
    icon: "heart",
    title: "Como funciona",
    text: "Monte seu grupo, chame as pessoas por um link e lance os gastos pelo botão +. Ou comece importando o extrato do banco.",
    bullets: [
      "Nossa Conta e a conta pessoal de cada um",
      "Contas fixas e faturas com aviso por email",
      "Relatórios e um assistente pra tirar dúvidas",
    ],
  },
  {
    icon: "home",
    title: "Painel que avisa",
    text: "Logo no topo: quanto você tem hoje, quanto dá pra gastar por dia e o que vence nos próximos 7 dias.",
    bullets: ["Faturas, parcelas e contas fixas da semana", "Atalhos pra lançar em um toque", "Aviso por email antes de vencer"],
  },
  {
    icon: "spark",
    title: "Assistente",
    text: "Pergunte \"como está meu mês?\" ou \"o que vence essa semana?\". Também dá pra lançar escrevendo \"gastei 50 no mercado\".",
  },
];

// Routes where the tour would get in the way: the sign-in screens (including
// the "Conta criada!" moment on /register) and public pages.
const HIDDEN_ON = ["/login", "/register", "/privacidade", "/termos", "/r/", "/invite/"];

// Aparece uma vez só, pra conta recém-criada (ver utils/welcomeTour.ts): pra
// que serve o app, dá pra arrastar.
export function WelcomeTour() {
  const { user, token } = useAuth();
  const location = useLocation();
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);
  // Guardado ao abrir: a marca de "já vista" vai pro servidor na hora, e a
  // apresentação continua aberta até a pessoa fechar.
  const [shownFor, setShownFor] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const touchStartX = useRef<number | null>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);

  const hiddenHere = HIDDEN_ON.some((prefix) => location.pathname.startsWith(prefix));
  const open =
    !!user && !hiddenHere && dismissedFor !== user.id && (shownFor === user.id || isWelcomeTourPending(user));
  const isLast = index === SLIDES.length - 1;

  useEffect(() => {
    if (!open || !user || shownFor === user.id) return;
    setShownFor(user.id);
    markWelcomeTourShown(user.id);
    void apiRequest("/me/welcome-seen", { method: "POST", token }).catch(() => {
      // Sem rede: a marca local segura neste aparelho.
    });
  }, [open, user, token, shownFor]);

  useEffect(() => {
    setWelcomeTourOpen(open && user ? user.id : null);
  }, [open, user]);

  function close() {
    if (!user) return;
    setDismissedFor(user.id);
  }

  function go(delta: number) {
    setIndex((current) => Math.min(SLIDES.length - 1, Math.max(0, current + delta)));
  }

  useEffect(() => {
    if (!open) return;
    primaryRef.current?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") close();
      if (event.key === "ArrowRight") go(1);
      if (event.key === "ArrowLeft") go(-1);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // close only reads `user`, which `open` already depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const slide = SLIDES[index];

  function onTouchStart(event: TouchEvent) {
    touchStartX.current = event.touches[0].clientX;
  }

  function onTouchEnd(event: TouchEvent) {
    if (touchStartX.current === null) return;
    const dx = event.changedTouches[0].clientX - touchStartX.current;
    touchStartX.current = null;
    if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
  }

  return (
    <div className="modal-backdrop welcome-tour-backdrop">
      <div
        className="modal-panel welcome-tour"
        role="dialog"
        aria-modal="true"
        aria-labelledby="welcome-tour-title"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <button type="button" className="welcome-tour-skip link-button" onClick={close}>
          Pular
        </button>

        <div className="welcome-tour-slide" key={index}>
          <div className="welcome-tour-icon" aria-hidden="true">
            {slide.icon === "brand" ? <BrandMark size={44} /> : <Icon name={slide.icon} className="icon" />}
          </div>
          <p className="welcome-tour-step">
            {slide.tag && <span className="welcome-tour-tag">{slide.tag}</span>}
            {index + 1} de {SLIDES.length}
          </p>
          <h2 id="welcome-tour-title">{slide.title}</h2>
          <p className="welcome-tour-text">{slide.text}</p>
          {slide.bullets && (
            <ul className="welcome-tour-bullets">
              {slide.bullets.map((bullet) => (
                <li key={bullet}>
                  <Icon name="check" className="icon" />
                  <span>{bullet}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="welcome-tour-dots" role="tablist" aria-label="Passos da apresentação">
          {SLIDES.map((s, i) => (
            <button
              key={s.title}
              type="button"
              role="tab"
              aria-selected={i === index}
              aria-label={`Passo ${i + 1}`}
              className={`welcome-tour-dot${i === index ? " is-active" : ""}`}
              onClick={() => setIndex(i)}
            />
          ))}
        </div>

        <div className="modal-actions">
          {index > 0 && (
            <button type="button" className="btn btn-outline" onClick={() => go(-1)}>
              Voltar
            </button>
          )}
          <button
            ref={primaryRef}
            type="button"
            className="btn btn-primary"
            onClick={() => (isLast ? close() : go(1))}
          >
            {isLast ? "Começar" : "Próximo"}
          </button>
        </div>
      </div>
    </div>
  );
}
