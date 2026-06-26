/**
 * Toolbar popup: auth + dictionary status, a controls cheatsheet, and quick
 * option toggles. The full login/backend/Anki settings live on the options page.
 */
import { ext } from '../shared/browser';
import { loadConfig, saveConfig, type ExtensionConfig } from '../shared/config';
import { sendMessage } from '../shared/messages';

const LANGUAGE = 'eu';

async function renderStatus(): Promise<void> {
  const auth = document.getElementById('auth-status');
  if (auth) {
    try {
      const a = await sendMessage('AUTH_STATUS');
      auth.textContent = a.loggedIn
        ? `Logged in${a.email ? ` as ${a.email}` : ''}.`
        : 'Not logged in — open Settings to log in.';
    } catch {
      auth.textContent = 'Background unavailable.';
    }
  }

  const dict = document.getElementById('dict-status');
  if (dict) {
    const s = await sendMessage('DICT_STATUS', { language: LANGUAGE }).catch(() => ({
      ready: false,
      count: 0,
    }));
    dict.textContent = s.ready
      ? `${s.count.toLocaleString()} ${LANGUAGE} words cached.`
      : 'Dictionary not downloaded — see Settings.';
  }
}

const TOGGLES: (keyof ExtensionConfig)[] = [
  'pauseOnLookup',
  'autoEnableSubtitles',
  'autoPauseAtLineEnd',
  'captureMedia',
];

async function renderOptions(): Promise<void> {
  const cfg = await loadConfig();
  for (const key of TOGGLES) {
    const box = document.getElementById(key);
    if (box instanceof HTMLInputElement) {
      box.checked = Boolean(cfg[key]);
      box.addEventListener('change', () => {
        void saveConfig({ [key]: box.checked });
      });
    }
  }
}

document.getElementById('open-options')?.addEventListener('click', () => {
  void ext.runtime.openOptionsPage();
});

void renderStatus();
void renderOptions();
