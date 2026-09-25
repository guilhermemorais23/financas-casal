import { useEffect, useRef, useState } from "react";
import { Icon, type IconName } from "./Icon";

interface ExportMenuProps {
  monthLabel: string;
  disabled?: boolean;
  busy?: boolean;
  onPdf: () => void;
  onCsvMonth: () => void;
  onCsvAll: () => void;
  onShare: () => void;
}

interface Item {
  key: string;
  icon: IconName;
  title: string;
  hint: string;
  run: () => void;
  requiresData?: boolean;
}

// One "Exportar" button instead of a growing row of "⬇ CSV", "⬇ Tudo"...:
// every way of getting data out lives in one menu, each with a verb and a
// one-line hint. Importar tem botão próprio (ImportButton), fora daqui.
export function ExportMenu(props: ExportMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const items: Item[] = [
    {
      key: "pdf",
      icon: "file",
      title: `PDF de ${props.monthLabel}`,
      hint: "Resumo pronto pra imprimir ou mandar",
      run: props.onPdf,
      requiresData: true,
    },
    {
      key: "csv",
      icon: "download",
      title: "Planilha do mês (CSV)",
      hint: "Abre no Excel ou Google Planilhas",
      run: props.onCsvMonth,
      requiresData: true,
    },
    { key: "csv-all", icon: "download", title: "Planilha de tudo (CSV)", hint: "Todos os meses de uma vez", run: props.onCsvAll },
    {
      key: "share",
      icon: "link",
      title: "Copiar link do extrato",
      hint: "Só leitura, expira em 7 dias, sem lançamentos privados",
      run: props.onShare,
      requiresData: true,
    },
  ];

  return (
    <div className="export-menu" ref={rootRef}>
      <button
        type="button"
        className="btn btn-outline btn-sm"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        disabled={props.busy}
      >
        <Icon name="download" />
        {props.busy ? "Preparando..." : "Exportar"}
        <Icon name="chevron" />
      </button>
      {open && (
        <div className="export-menu-panel" role="menu">
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              className="export-menu-item"
              disabled={item.requiresData && props.disabled}
              onClick={() => {
                setOpen(false);
                item.run();
              }}
            >
              <Icon name={item.icon} />
              <span>
                <strong>{item.title}</strong>
                <small>{item.hint}</small>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
