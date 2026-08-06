import { useEffect, useRef, useState } from "react";

// Curated for personal-finance categories (moradia, alimentação, transporte,
// saúde, lazer, educação, compras, contas, investimentos, dívidas, trabalho,
// família, pets, viagem, presentes, metas) rather than a full emoji keyboard.
const FINANCE_EMOJIS = [
  "🏠", "🏡", "🔑", "🍔", "🍕", "🛒", "☕", "🍽️",
  "🚗", "🚌", "⛽", "✈️", "🚲", "🚕",
  "🩺", "💊", "🏥", "🦷",
  "🎮", "🎬", "🎉", "🎵", "🏖️",
  "📚", "🎓",
  "🛍️", "👗", "👟",
  "📄", "💡", "📶", "📱", "🔥",
  "📈", "💹", "🏦", "💰", "🐖",
  "💳", "🧾", "📉",
  "💼", "💵",
  "👶", "🐶", "🐱",
  "🎁", "🧳", "🗺️",
  "🎯", "✨", "🔧",
];

interface EmojiPickerProps {
  value: string;
  onChange: (emoji: string) => void;
}

export function EmojiPicker({ value, onChange }: EmojiPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  return (
    <div className="emoji-picker" ref={containerRef}>
      <button
        type="button"
        className="emoji-picker-trigger"
        onClick={() => setIsOpen((current) => !current)}
        aria-label="Escolher emoji"
        title="Escolher emoji"
      >
        {value || "🙂"}
      </button>
      {isOpen && (
        <div className="emoji-picker-panel">
          {FINANCE_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              className={`emoji-picker-option${emoji === value ? " selected" : ""}`}
              onClick={() => {
                onChange(emoji);
                setIsOpen(false);
              }}
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
