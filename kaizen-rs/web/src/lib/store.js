// App-wide state: the signed-in user, theme, and toasts.
import { createRoot, createSignal } from 'solid-js';
import { api, setUnauthorizedHandler } from './api';

function createSession() {
  const [me, setMe] = createSignal(undefined); // undefined = loading, null = signed out
  const refresh = async () => {
    try {
      const data = await api('/me');
      setMe(data.user ? data : null);
      // New accounts start in UTC; adopt the browser's zone once.
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (data.user && data.user.timezone === 'UTC' && tz && tz !== 'UTC') {
        api('/me', { method: 'PUT', body: { timezone: tz } }).then(refresh).catch(() => {});
      }
    } catch {
      setMe(null);
    }
  };
  setUnauthorizedHandler(() => setMe(null));
  return { me, setMe, refresh };
}
export const session = createRoot(createSession);

function createTheme() {
  const read = () => { try { return localStorage.getItem('kaizen.theme') ?? 'system'; } catch { return 'system'; } };
  const [theme, setThemeSignal] = createSignal(read());
  const apply = (value) => {
    if (value === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = value;
  };
  const setTheme = (value) => {
    setThemeSignal(value);
    apply(value);
    try { localStorage.setItem('kaizen.theme', value); } catch { /* private mode */ }
  };
  apply(theme());
  return { theme, setTheme };
}
export const themeStore = createRoot(createTheme);

function createToasts() {
  const [toasts, setToasts] = createSignal([]);
  let id = 0;
  const dismiss = (key) => setToasts((t) => t.filter((x) => x.id !== key));
  const push = (message, tone = 'info', ms = 4200) => {
    const key = ++id;
    setToasts((t) => [...t, { id: key, message, tone }]);
    if (ms) setTimeout(() => dismiss(key), ms);
    return key;
  };
  return { toasts, push, dismiss };
}
export const toastStore = createRoot(createToasts);
export const toast = (message, tone) => toastStore.push(message, tone);

/** Run an async action with a toast on failure (and optionally success). */
export async function attempt(fn, success) {
  try {
    const result = await fn();
    if (success) toast(typeof success === 'function' ? success(result) : success, 'good');
    return result;
  } catch (err) {
    toast(err.message || 'Something went wrong.', 'bad');
    return undefined;
  }
}
