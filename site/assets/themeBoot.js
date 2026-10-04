/* =========================================================
   Theme boot — prevents the white flash
   =========================================================
   templates/note.html ships `<html data-theme="light">` and the theme is only
   applied by src/themeSwitcher.js at the very end of <body>. So a visitor who
   picked the dark (or any other) theme sees a light page first and a flash when
   the script switches the theme.

   This script runs in <head> — before the stylesheets, therefore before the
   first paint — and applies the stored theme straight away. Same localStorage
   key as src/themeSwitcher.js, so the two always agree.
*/

const BASHLIGH_VALID_THEMES = [
    "light",
    "dark",
    "forest",
    "paperLike",
    "neon"
];

(function applyStoredThemeBeforeFirstPaint() {
    let storedTheme = null;

    try {
        storedTheme = window.localStorage.getItem("noteTheme");
    } catch {
        // Storage disabled (private mode, blocked cookies) — keep the default.
        storedTheme = null;
    }

    if (!storedTheme || !BASHLIGH_VALID_THEMES.includes(storedTheme)) {
        return;
    }

    document.documentElement.dataset.theme = storedTheme;
})();