export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <svg
      className="brand-icon"
      viewBox="0 0 94 104"
      width={size}
      height={(size * 104) / 94}
      aria-hidden="true"
    >
      <rect x="6" y="14" width="46" height="46" fill="var(--color-brand-accent)" />
      <rect x="34" y="42" width="46" height="46" fill="none" stroke="var(--color-text)" strokeWidth="8" />
    </svg>
  );
}

export function Brand() {
  return (
    <span className="brand-lockup">
      <BrandMark />
      <span className="brand">
        PAR<span className="brand-dot">.</span>
      </span>
    </span>
  );
}
