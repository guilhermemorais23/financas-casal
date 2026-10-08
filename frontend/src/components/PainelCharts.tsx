import { useMemo, useRef, useState } from "react";
import { formatCurrency } from "../utils/format";

const MONTH_SHORT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

function compact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1000) return `${value < 0 ? "−" : ""}${(abs / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;
  return `${value < 0 ? "−" : ""}${Math.round(abs)}`;
}

// Escala "bonita" pro eixo: 0 e 2-3 linhas de grade em valores redondos.
function niceTicks(min: number, max: number): number[] {
  const span = Math.max(1, max - min);
  const raw = span / 3;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => span / s <= 4) ?? pow * 10;
  const ticks: number[] = [];
  for (let v = Math.floor(min / step) * step; v <= max + step / 2; v += step) ticks.push(Math.round(v * 100) / 100);
  return ticks;
}

// ---------------------------------------------------------------------------
// Saldo do mês dia a dia (uma série: o próprio título diz o que é)
// ---------------------------------------------------------------------------

export function BalanceLineChart({ points, todayDay }: { points: { day: string; balance: number }[]; todayDay: number | null }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  // Mês atual: a linha vai até hoje. Mês passado: o mês inteiro.
  const shown = useMemo(() => (todayDay ? points.slice(0, todayDay) : points), [points, todayDay]);
  const W = 640;
  const H = 170;
  const L = 46;
  const R = 18;
  const T = 14;
  const B = 22;
  const days = Math.max(points.length, 28);
  const values = shown.map((p) => p.balance);
  const ticks = niceTicks(Math.min(0, ...values), Math.max(0, ...values));
  const min = ticks[0];
  const max = ticks[ticks.length - 1];
  const x = (index: number) => L + (index / (days - 1)) * (W - L - R);
  const y = (value: number) => T + (1 - (value - min) / (max - min || 1)) * (H - T - B);

  if (shown.length === 0) return null;
  const line = shown.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.balance).toFixed(1)}`).join(" ");
  const area = `${line} L${x(shown.length - 1).toFixed(1)},${y(0).toFixed(1)} L${x(0).toFixed(1)},${y(0).toFixed(1)} Z`;
  const last = shown[shown.length - 1];
  const hovered = hover !== null ? shown[hover] : null;
  const dayTicks = [1, 8, 15, 22, points.length].filter((d, i, arr) => arr.indexOf(d) === i);

  function onMove(clientX: number) {
    const box = wrapRef.current?.getBoundingClientRect();
    if (!box) return;
    const px = ((clientX - box.left) / box.width) * W;
    const index = Math.round(((px - L) / (W - L - R)) * (days - 1));
    setHover(Math.max(0, Math.min(shown.length - 1, index)));
  }

  return (
    <div
      className="painel-chart"
      ref={wrapRef}
      onMouseMove={(e) => onMove(e.clientX)}
      onMouseLeave={() => setHover(null)}
      onTouchStart={(e) => onMove(e.touches[0].clientX)}
      onTouchMove={(e) => onMove(e.touches[0].clientX)}
      onTouchEnd={() => setHover(null)}
    >
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Saldo do mês dia a dia, hoje ${formatCurrency(last.balance)}`}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={L}
              x2={W - R}
              y1={y(t)}
              y2={y(t)}
              stroke={t === 0 ? "var(--color-text-muted)" : "var(--gridline)"}
              strokeDasharray={t === 0 ? "3 3" : undefined}
              strokeWidth={1}
            />
            <text x={L - 8} y={y(t) + 4} textAnchor="end" className="painel-axis">
              {compact(t)}
            </text>
          </g>
        ))}
        {dayTicks.map((d) => (
          <text key={d} x={x(d - 1)} y={H - 4} textAnchor="middle" className="painel-axis">
            {d}
          </text>
        ))}
        <path d={area} fill="var(--series-1)" fillOpacity={0.1} />
        <path d={line} fill="none" stroke="var(--series-1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={x(shown.length - 1)} cy={y(last.balance)} r={4.5} fill="var(--series-1)" stroke="var(--color-card)" strokeWidth={2} />
        {hovered && hover !== null && (
          <>
            <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} stroke="var(--color-text-muted)" strokeWidth={1} />
            <circle cx={x(hover)} cy={y(hovered.balance)} r={4} fill="var(--series-1)" stroke="var(--color-card)" strokeWidth={2} />
          </>
        )}
      </svg>
      {hovered && hover !== null && (
        <div className="painel-tip" style={{ left: `${(x(hover) / W) * 100}%`, top: `${(y(hovered.balance) / H) * 100}%` }}>
          <strong>
            {Number(hovered.day.slice(8, 10))} de {MONTH_SHORT[Number(hovered.day.slice(5, 7)) - 1]}
          </strong>
          <span>Saldo {formatCurrency(hovered.balance)}</span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Entrou e saiu, últimos 6 meses (duas séries: legenda + rótulo no último mês)
// ---------------------------------------------------------------------------

export function InOutMonthsChart({ months }: { months: { month: string; income: number; expense: number }[] }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const W = 520;
  const H = 200;
  const L = 44;
  const R = 8;
  const T = 20;
  const B = 22;
  const ticks = niceTicks(0, Math.max(1, ...months.flatMap((m) => [m.income, m.expense])));
  const max = ticks[ticks.length - 1];
  const y = (value: number) => T + (1 - value / max) * (H - T - B);
  const slot = (W - L - R) / Math.max(1, months.length);
  const bw = Math.min(22, slot * 0.28);
  const gap = 2;

  const bar = (x0: number, value: number) => {
    const top = y(value);
    const r = Math.min(4, Math.max(0, y(0) - top));
    return `M${x0},${y(0)} V${top + r} Q${x0},${top} ${x0 + r},${top} H${x0 + bw - r} Q${x0 + bw},${top} ${x0 + bw},${top + r} V${y(0)} Z`;
  };

  const label = (month: string) => MONTH_SHORT[Number(month.slice(5, 7)) - 1];
  const hovered = hover !== null ? months[hover] : null;

  return (
    <div className="painel-chart" ref={wrapRef} onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Entrou e saiu nos últimos 6 meses">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke={t === 0 ? "var(--color-text-muted)" : "var(--gridline)"} strokeWidth={1} />
            <text x={L - 8} y={y(t) + 4} textAnchor="end" className="painel-axis">
              {compact(t)}
            </text>
          </g>
        ))}
        {months.map((m, i) => {
          const cx = L + slot * i + slot / 2;
          const dim = hover !== null && hover !== i ? 0.55 : 1;
          const isLast = i === months.length - 1;
          return (
            <g key={m.month}>
              <path d={bar(cx - bw - gap / 2, m.income)} fill="var(--series-1)" opacity={dim} />
              <path d={bar(cx + gap / 2, m.expense)} fill="var(--series-2)" opacity={dim} />
              <text x={cx} y={H - 4} textAnchor="middle" className="painel-axis">
                {label(m.month)}
              </text>
              {isLast && (
                <>
                  <text x={cx - bw / 2 - gap / 2} y={y(m.income) - 5} textAnchor="middle" className="painel-bar-label">
                    {compact(m.income)}
                  </text>
                  <text x={cx + bw / 2 + gap / 2} y={y(m.expense) - 5} textAnchor="middle" className="painel-bar-label">
                    {compact(m.expense)}
                  </text>
                </>
              )}
              <rect
                x={L + slot * i}
                y={T}
                width={slot}
                height={H - T - B}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
                onClick={() => setHover(hover === i ? null : i)}
              />
            </g>
          );
        })}
      </svg>
      {hovered && hover !== null && (
        <div
          className="painel-tip"
          style={{ left: `${((L + slot * hover + slot / 2) / W) * 100}%`, top: `${(y(Math.max(hovered.income, hovered.expense)) / H) * 100}%` }}
        >
          <strong>{label(hovered.month)}</strong>
          <span>Entrou {formatCurrency(hovered.income)}</span>
          <span>Saiu {formatCurrency(hovered.expense)}</span>
          <span>
            {hovered.income - hovered.expense >= 0 ? "Sobrou" : "Faltou"} {formatCurrency(Math.abs(hovered.income - hovered.expense))}
          </span>
        </div>
      )}
    </div>
  );
}
