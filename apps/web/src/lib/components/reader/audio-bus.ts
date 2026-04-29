/**
 * Audio playback event bus (T-9.2).
 *
 * The audio player publishes (currentTimeMs, isPlaying) and the
 * reader components subscribe to it for karaoke highlighting
 * (T-9.3) and tap-to-seek (T-9.4). Using a tiny pub/sub instead
 * of Svelte stores keeps the dependency direction one-way: the
 * reader doesn't need to import the player.
 */
export type AudioState = {
  currentTimeMs: number;
  isPlaying: boolean;
  /** Currently-loaded audio file id; null when no audio. */
  audioFileId: string | null;
};

type Listener = (state: AudioState) => void;

let state: AudioState = {
  currentTimeMs: 0,
  isPlaying: false,
  audioFileId: null,
};
const listeners = new Set<Listener>();

export function getAudioState(): AudioState {
  return state;
}

/**
 * Replace the current state and notify subscribers. Producers (the
 * audio player) call this on `timeupdate`, `play`, `pause`, and
 * audio-file-change events.
 */
export function setAudioState(next: Partial<AudioState>): void {
  state = { ...state, ...next };
  for (const fn of listeners) fn(state);
}

export function subscribeAudio(fn: Listener): () => void {
  listeners.add(fn);
  // Push the current state synchronously so a late subscriber
  // doesn't have to wait for the next event to render.
  fn(state);
  return () => {
    listeners.delete(fn);
  };
}

/** Test seam: clear the bus between unit-test runs. */
export function _resetAudioBus(): void {
  state = { currentTimeMs: 0, isPlaying: false, audioFileId: null };
  listeners.clear();
  alignmentByTokenId = new Map();
  controller = null;
}

/**
 * The audio player exposes a small imperative handle to the rest
 * of the reader so T-9.4's tap-to-seek can ask the player to jump
 * to a specific time without coupling that code to the
 * <audio> element directly.
 */
export type AudioController = {
  seekMs(ms: number): void;
  play(): void;
  pause(): void;
};

let controller: AudioController | null = null;

export function setAudioController(c: AudioController | null): void {
  controller = c;
}

export function getAudioController(): AudioController | null {
  return controller;
}

// ---------------------------------------------------------------
// Alignment cache (T-9.4)
// ---------------------------------------------------------------

/**
 * The active audio file's tokenId → startMs map. Populated by
 * AlignmentHighlighter (which already loads the timeline) and
 * consumed by ChapterBody's click handler to seek the player to
 * the tapped word.
 */
let alignmentByTokenId = new Map<string, number>();

export function setAlignmentMap(map: Map<string, number>): void {
  alignmentByTokenId = map;
}

export function getAlignmentStartMs(tokenId: string): number | null {
  return alignmentByTokenId.get(tokenId) ?? null;
}
