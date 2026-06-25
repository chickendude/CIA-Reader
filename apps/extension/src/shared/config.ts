/**
 * User-editable settings, persisted in `storage.local`.
 *
 * `apiBaseUrl` points at the CIA Reader backend (the only thing the extension
 * needs the network for — lemmatization + the one-time dictionary snapshot).
 * Everything else (internal dictionary, external dictionaries, Anki) is local.
 */
import { ext } from './browser';

export type ExtensionConfig = {
  /** CIA Reader backend origin. Default = local dev stack. */
  apiBaseUrl: string;
  /** Target language for parsing + dictionary (Primeran is Basque). */
  language: string;
  /** Anki deck new cards land in. */
  deckName: string;
  /** AnkiConnect endpoint (local Anki + add-on). */
  ankiConnectUrl: string;
  /** Start with auto-pause at the end of each subtitle line enabled. */
  autoPauseAtLineEnd: boolean;
  /** Pause playback while a word look-up popup is open (pause-on-hover). */
  pauseOnLookup: boolean;
  /** Turn on Basque subtitles automatically if none are showing. */
  autoEnableSubtitles: boolean;
};

export const DEFAULT_CONFIG: ExtensionConfig = {
  // 127.0.0.1 (IPv4), not `localhost`: on macOS `localhost` resolves to IPv6
  // (::1) first, which can land on a different dev server bound to [::1]:5173.
  apiBaseUrl: 'http://127.0.0.1:5173',
  language: 'eu',
  deckName: 'Primeran',
  ankiConnectUrl: 'http://127.0.0.1:8765',
  autoPauseAtLineEnd: false,
  pauseOnLookup: true,
  autoEnableSubtitles: true,
};

const CONFIG_KEY = 'config';

export async function loadConfig(): Promise<ExtensionConfig> {
  const stored = await ext.storage.local.get(CONFIG_KEY);
  const saved = stored[CONFIG_KEY] as Partial<ExtensionConfig> | undefined;
  return { ...DEFAULT_CONFIG, ...saved };
}

export async function saveConfig(patch: Partial<ExtensionConfig>): Promise<ExtensionConfig> {
  const next = { ...(await loadConfig()), ...patch };
  await ext.storage.local.set({ [CONFIG_KEY]: next });
  return next;
}
