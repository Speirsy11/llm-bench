"use client";

import { useSyncExternalStore } from "react";

const THEME_STORAGE_KEY = "llmbench-theme";
const THEME_CHANGE_EVENT = "llmbench-theme-change";

type Theme = "dark" | "light";

export function ThemeControl() {
  const theme = useSyncExternalStore(
    subscribeToTheme,
    readAppliedTheme,
    readServerTheme,
  );
  const isDark = theme === "dark";
  const nextTheme: Theme = isDark ? "light" : "dark";

  return (
    <button
      aria-label="Dark theme"
      aria-pressed={isDark}
      className="border-border bg-card text-card-foreground hover:border-foreground/25 fixed right-5 bottom-5 z-50 grid size-11 place-items-center rounded-full border shadow-lg transition hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-4 sm:right-8 sm:bottom-8"
      onClick={() => {
        applyTheme(nextTheme);
      }}
      title={`Switch to ${nextTheme} theme`}
      type="button"
    >
      {isDark ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}

function applyTheme(theme: Theme): void {
  const isDark = theme === "dark";
  const root = document.documentElement;
  root.classList.toggle("dark", isDark);
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // The visual preference still applies when storage is unavailable.
  }
  window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
}

function readAppliedTheme(): Theme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function readServerTheme(): Theme {
  return "light";
}

function subscribeToTheme(listener: () => void): () => void {
  window.addEventListener(THEME_CHANGE_EVENT, listener);
  return () => window.removeEventListener(THEME_CHANGE_EVENT, listener);
}

function MoonIcon() {
  return (
    <svg aria-hidden="true" className="size-5" fill="none" viewBox="0 0 24 24">
      <path
        d="M20.2 15.5A8.5 8.5 0 0 1 8.5 3.8 8.5 8.5 0 1 0 20.2 15.5Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.75"
      />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg aria-hidden="true" className="size-5" fill="none" viewBox="0 0 24 24">
      <circle
        cx="12"
        cy="12"
        r="3.5"
        stroke="currentColor"
        strokeWidth="1.75"
      />
      <path
        d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.75"
      />
    </svg>
  );
}
