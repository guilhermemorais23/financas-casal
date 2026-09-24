// One line-icon set for the whole app (replaces emoji-as-icon in the nav,
// buttons and menus): same drawing on Windows, Mac and phones, and it takes
// the text color of whatever it sits in, so themes and active states just
// work.
const PATHS = {
  home: "M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10",
  heart: "M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z",
  plus: "M12 5v14M5 12h14",
  card: "M3 10h18M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z",
  repeat: "M17 2l3 3-3 3M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 0 1-4 4H4",
  receipt: "M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6",
  cart: "M3 4h2l2 12h11l2-8H6M9 20.5h.01M17 20.5h.01",
  target: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zM12 12h.01",
  chart: "M5 20V11M12 20V4M19 20v-6",
  trend: "M3 17l6-6 4 4 8-8M15 7h6v6",
  sliders: "M4 7h10M18 7h2M4 17h2M10 17h10M16 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM8 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
  wrench: "M14.7 6.3a4 4 0 0 0 5 5L21 12.6 12.6 21l-3.6-3.6L3 11.4 6.3 8a4 4 0 0 1 5-5l3.4 3.3z",
  trash: "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6",
  download: "M12 4v11M7 11l5 5 5-5M5 20h14",
  upload: "M12 16V5M7 9l5-5 5 5M5 20h14",
  link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  chevron: "M6 9l6 6 6-6",
  check: "M5 12l5 5 9-10",
  file: "M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6",
  bank: "M3 10l9-6 9 6M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  pencil: "M4 20h4L19 9l-4-4L4 16z",
  search: "M11 17a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM20 20l-4-4",
  x: "M6 6l12 12M18 6L6 18",
  spark: "M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z",
  moon: "M20 14A8 8 0 1 1 10 4a6 6 0 0 0 10 10z",
  sun: "M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4",
  chat: "M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0",
  logout: "M9 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h4M16 8l4 4-4 4M20 12H9",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8h.01",
  alert: "M12 3l10 18H2zM12 10v4M12 17.5h.01",
  repeatOff: "M17 2l3 3-3 3M4 11V9a4 4 0 0 1 4-4h12M4 4l16 16",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, className = "icon" }: { name: IconName; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" focusable="false">
      <path d={PATHS[name]} />
    </svg>
  );
}
