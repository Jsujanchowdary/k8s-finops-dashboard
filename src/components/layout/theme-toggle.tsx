"use client";

import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";

type Theme = "system" | "light" | "dark";

const STORAGE_KEY = "do-dashboard:theme";

const OPTIONS: { id: Theme; label: string; Icon: typeof Sun }[] = [
  { id: "system", label: "System", Icon: Monitor },
  { id: "light", label: "Light", Icon: Sun },
  { id: "dark", label: "Dark", Icon: Moon },
];

function apply(theme: Theme) {
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("system");

  // Read the saved choice after mount, from a callback. The page itself is already themed by the inline script.
  useEffect(() => {
    const id = window.setTimeout(() => {
      try {
        const saved = window.localStorage.getItem(STORAGE_KEY);
        if (saved === "light" || saved === "dark") setTheme(saved);
      } catch {
        /* storage can be unavailable; stay on System */
      }
    }, 0);
    return () => window.clearTimeout(id);
  }, []);

  const choose = (next: Theme) => {
    setTheme(next);
    apply(next);
    try {
      if (next === "system") window.localStorage.removeItem(STORAGE_KEY);
      else window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  };

  return (
    <div role="radiogroup" aria-label="Theme" className="inline-flex rounded-md border border-border bg-surface p-0.5">
      {OPTIONS.map(({ id, label, Icon }) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={theme === id}
          aria-label={label}
          title={label}
          onClick={() => choose(id)}
          className={`rounded p-1.5 transition-colors ${theme === id ? "bg-accent/20 text-text" : "text-muted hover:text-text"}`}
        >
          <Icon className="size-3.5" />
        </button>
      ))}
    </div>
  );
}
