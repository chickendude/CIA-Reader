/**
 * Settings page: edit + persist the extension config. The login form is added
 * with the auth/token client; for now this handles the backend URL + Anki
 * settings.
 */
import { loadConfig, saveConfig } from '../shared/config';
import { sendMessage } from '../shared/messages';

function input(id: string): HTMLInputElement | null {
  const el = document.getElementById(id);
  return el instanceof HTMLInputElement ? el : null;
}

async function renderAuth(): Promise<void> {
  const status = document.getElementById('auth-status');
  const loginForm = document.getElementById('login-form');
  const logoutBtn = document.getElementById('logout');
  const auth = await sendMessage('AUTH_STATUS').catch(
    (): { loggedIn: boolean; email?: string } => ({ loggedIn: false }),
  );
  if (status) {
    status.textContent = auth.loggedIn
      ? `Logged in${auth.email ? ` as ${auth.email}` : ''}.`
      : 'Not logged in.';
  }
  if (loginForm) loginForm.hidden = auth.loggedIn;
  if (logoutBtn) logoutBtn.hidden = !auth.loggedIn;
}

async function render(): Promise<void> {
  const cfg = await loadConfig();
  const set = (id: string, value: string) => {
    const el = input(id);
    if (el) el.value = value;
  };
  set('apiBaseUrl', cfg.apiBaseUrl);
  set('deckName', cfg.deckName);
  set('ankiConnectUrl', cfg.ankiConnectUrl);
  await renderAuth();
  await renderDict(cfg.language);
}

async function renderDict(language: string): Promise<void> {
  const el = document.getElementById('dict-status');
  if (!el) return;
  const status = await sendMessage('DICT_STATUS', { language }).catch(() => ({
    ready: false,
    count: 0,
  }));
  el.textContent = status.ready
    ? `${status.count.toLocaleString()} ${language} words cached locally.`
    : 'Not downloaded yet.';
}

document.getElementById('dict-refresh')?.addEventListener('click', async () => {
  const el = document.getElementById('dict-status');
  const { language } = await loadConfig();
  if (el) el.textContent = 'Downloading…';
  try {
    const res = await sendMessage('DICT_REFRESH', { language });
    if (el) el.textContent = `${res.count.toLocaleString()} ${language} words cached locally.`;
  } catch (e) {
    if (el) el.textContent = `Download failed: ${e instanceof Error ? e.message : String(e)}`;
  }
});

document.getElementById('login')?.addEventListener('click', async () => {
  const msg = document.getElementById('login-msg');
  const email = input('email')?.value.trim() ?? '';
  const password = input('password')?.value ?? '';
  if (!email || !password) {
    if (msg) msg.textContent = 'Enter email and password.';
    return;
  }
  if (msg) msg.textContent = 'Logging in…';
  const result = await sendMessage('LOGIN', { email, password });
  if (msg) msg.textContent = result.loggedIn ? '' : (result.error ?? 'Login failed.');
  await renderAuth();
});

document.getElementById('logout')?.addEventListener('click', async () => {
  await sendMessage('LOGOUT');
  await renderAuth();
});

document.getElementById('save')?.addEventListener('click', async () => {
  await saveConfig({
    apiBaseUrl: input('apiBaseUrl')?.value.trim() || undefined,
    deckName: input('deckName')?.value.trim() || undefined,
    ankiConnectUrl: input('ankiConnectUrl')?.value.trim() || undefined,
  });
  const msg = document.getElementById('msg');
  if (msg) {
    msg.textContent = 'Saved.';
    setTimeout(() => (msg.textContent = ''), 1500);
  }
});

void render();
