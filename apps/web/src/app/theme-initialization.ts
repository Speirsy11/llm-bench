export function initializeTheme(): void {
  let preference: string | null = null;
  let systemPrefersDark = false;

  try {
    preference = localStorage.getItem("llmbench-theme");
  } catch {
    // Storage can be disabled; the system preference remains a safe fallback.
  }
  try {
    systemPrefersDark = matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    // Browsers without matchMedia receive the light theme.
  }

  const theme =
    preference === "dark" || (preference !== "light" && systemPrefersDark)
      ? "dark"
      : "light";
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
}

export const themeInitializationScript = `(${initializeTheme.toString()})();`;
