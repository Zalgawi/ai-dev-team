// Light / dark (night) theme logic. Pure, DOM-free helpers are used by app.js
// and covered by unit tests. The tiny inline script in index.html <head>
// repeats resolveTheme() (it must run before any module loads, to avoid a
// flash of the wrong theme) and uses the same storage key and attribute.

export const THEME_STORAGE_KEY = 'trail100_theme';
// Attribute set on <html>: <html data-theme="dark">.
export const THEME_ATTRIBUTE = 'data-theme';
export const DARK_SCHEME_QUERY = '(prefers-color-scheme: dark)';
// Browser UI colour (<meta name="theme-color">) for each theme.
export const THEME_COLORS = { light: '#1f3d2b', dark: '#0b1610' };

export function isTheme(value) {
    return value === 'light' || value === 'dark';
}

// A saved value from localStorage, or null if missing / not a known theme.
export function parseStoredTheme(raw) {
    return isTheme(raw) ? raw : null;
}

// Effective theme: a saved choice wins; otherwise follow the device setting.
export function resolveTheme(savedTheme, systemPrefersDark) {
    return isTheme(savedTheme) ? savedTheme : (systemPrefersDark ? 'dark' : 'light');
}

// Theme selected by pressing the toggle while `current` is shown.
export function nextTheme(current) {
    return current === 'dark' ? 'light' : 'dark';
}

// Accessible name of the toggle: says what pressing it will do.
export function themeToggleLabel(current) {
    return `Switch to ${nextTheme(current)} theme`;
}

// Short visible text of the toggle (contained in its accessible name).
export function themeToggleText(current) {
    return nextTheme(current) === 'dark' ? 'Dark theme' : 'Light theme';
}

// Read the saved theme. `storage` may be null (unavailable) or throw.
export function readSavedTheme(storage) {
    try {
        return storage ? parseStoredTheme(storage.getItem(THEME_STORAGE_KEY)) : null;
    } catch {
        return null;
    }
}

// Save the theme; returns false (without throwing) if storage is unavailable.
export function saveTheme(storage, theme) {
    if (!storage || !isTheme(theme)) return false;
    try {
        storage.setItem(THEME_STORAGE_KEY, theme);
        return true;
    } catch {
        return false;
    }
}
