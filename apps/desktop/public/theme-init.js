// Applies the saved or system theme, and last session's theme and snippet sheets, before first paint.
(() => {
  let theme = "dark";
  const sheets = [];
  try {
    const saved = localStorage.getItem("theme");
    if (saved === "light" || saved === "dark") theme = saved;
    else if (matchMedia("(prefers-color-scheme: light)").matches) theme = "light";
    // Written by renderer/themes/appearance.ts; keep the keys and ids in step.
    sheets.push(["loam-theme", localStorage.getItem("loam:theme-css")]);
    sheets.push(["loam-snippets", localStorage.getItem("loam:snippets-css")]);
  } catch {
    // Storage can be unavailable; the system preference fallback still applies.
  }
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  root.classList.toggle("dark", theme === "dark");
  for (const [id, css] of sheets) {
    if (!css) continue;
    const style = document.createElement("style");
    style.id = id;
    style.textContent = css;
    document.head.append(style);
  }
})();
