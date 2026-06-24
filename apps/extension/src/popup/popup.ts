/**
 * Toolbar popup: shows auth status and a shortcut to settings. The real login
 * form lives on the options page.
 */
import { ext } from '../shared/browser';
import { sendMessage } from '../shared/messages';

async function render(): Promise<void> {
  const statusEl = document.getElementById('status');
  if (!statusEl) return;
  try {
    const auth = await sendMessage('AUTH_STATUS');
    statusEl.textContent = auth.loggedIn
      ? `Logged in${auth.email ? ` as ${auth.email}` : ''}.`
      : 'Not logged in — open settings to log in.';
  } catch (e) {
    statusEl.textContent = `Background unavailable: ${e instanceof Error ? e.message : String(e)}`;
  }
}

document.getElementById('open-options')?.addEventListener('click', () => {
  void ext.runtime.openOptionsPage();
});

void render();
