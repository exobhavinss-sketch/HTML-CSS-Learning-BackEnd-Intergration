/**
 * Centralized Theme Management System for Tailwind Lab
 * Handles Light Mode, Dark Mode, OS preference detection, persistence, and toggle button.
 */

const THEME_KEY = 'theme';

// High-fidelity SVG icons for theme toggle
const SUN_ICON_SVG = `
<svg class="theme-icon theme-icon-sun" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <circle cx="12" cy="12" r="5"></circle>
  <line x1="12" y1="1" x2="1" y2="3"></line>
  <line x1="12" y1="21" x2="12" y2="23"></line>
  <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
  <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
  <line x1="1" y1="12" x2="3" y2="12"></line>
  <line x1="21" y1="12" x2="23" y2="12"></line>
  <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
  <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
</svg>`;

const MOON_ICON_SVG = `
<svg class="theme-icon theme-icon-moon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
</svg>`;

/**
 * Checks system-level OS color scheme preference.
 * @returns {'dark' | 'light'}
 */
export function getSystemPreference() {
  if (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }
  return 'light';
}

/**
 * Returns the currently active theme ('dark' or 'light').
 * @returns {'dark' | 'light'}
 */
export function getTheme() {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'dark' || saved === 'light') {
      return saved;
    }
  } catch (e) {
    console.warn('[Theme] Could not read localStorage:', e);
  }
  return getSystemPreference();
}

/**
 * Applies the specified theme to the document and optionally saves preference.
 * @param {'dark' | 'light'} theme
 * @param {boolean} [persist=true]
 */
export function setTheme(theme, persist = true) {
  const isDark = theme === 'dark';
  const root = document.documentElement;

  // Set class for Tailwind class-based dark mode
  root.classList.toggle('dark', isDark);
  root.classList.toggle('light', !isDark);

  // Set data-theme for existing CSS variables
  root.setAttribute('data-theme', theme);

  if (persist) {
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch (e) {
      console.warn('[Theme] Could not save theme preference to localStorage:', e);
    }
  }

  // Update toggle button DOM
  updateToggleButton(theme);

  // Dispatch custom event for any listening components
  window.dispatchEvent(new CustomEvent('themechange', { detail: { theme } }));
}

/**
 * Toggles the current theme between 'dark' and 'light'.
 * @returns {'dark' | 'light'} The newly active theme.
 */
export function toggleTheme() {
  const current = getTheme();
  const next = current === 'dark' ? 'light' : 'dark';
  setTheme(next, true);
  return next;
}

/**
 * Updates the theme toggle button DOM element.
 * @param {'dark' | 'light'} theme
 */
function updateToggleButton(theme) {
  const btn = document.querySelector('#theme-toggle-btn');
  if (!btn) return;

  const isDark = theme === 'dark';
  const label = isDark ? 'Switch to light mode' : 'Switch to dark mode';

  btn.setAttribute('aria-label', label);
  btn.setAttribute('title', label);
  btn.setAttribute('aria-pressed', String(isDark));
  btn.innerHTML = isDark ? SUN_ICON_SVG : MOON_ICON_SVG;
}

/**
 * Mounts and initializes the theme toggle button in the header.
 * @param {string} rootSelector
 */
export function initTheme(rootSelector = '#theme-root') {
  const root = document.querySelector(rootSelector);
  if (root) {
    const currentTheme = getTheme();
    const isDark = currentTheme === 'dark';
    const label = isDark ? 'Switch to light mode' : 'Switch to dark mode';

    root.innerHTML = `
      <button type="button" class="theme-toggle-btn" id="theme-toggle-btn" aria-label="${label}" title="${label}" aria-pressed="${String(isDark)}">
        ${isDark ? SUN_ICON_SVG : MOON_ICON_SVG}
      </button>
    `;

    const btn = root.querySelector('#theme-toggle-btn');
    if (btn) {
      btn.addEventListener('click', () => {
        toggleTheme();
      });
    }
  }

  // Sync initial theme on DOM load
  setTheme(getTheme(), false);

  // Listen to OS theme changes if user hasn't explicitly set a preference
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
      try {
        const saved = localStorage.getItem(THEME_KEY);
        // Only adapt automatically if user hasn't chosen manually
        if (!saved) {
          setTheme(e.matches ? 'dark' : 'light', false);
        }
      } catch (err) {}
    });
  }
}

// Auto-initialize in browser environment
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => initTheme());
  } else {
    initTheme();
  }
}
