/**
 * Object-storage abstraction for audio blobs (T-9.1).
 *
 * Two backends:
 *
 *   - 'local' (default in dev): writes to a directory under the
 *     repo root (or wherever AUDIO_LOCAL_ROOT points). Useful in
 *     CI + local without standing up a real S3.
 *   - 's3' (prod): Hetzner Object Storage / any S3-compatible
 *     service. Reads AUDIO_S3_* env vars at startup.
 *
 * The interface is intentionally small (`put`, `delete`, `url`) so
 * a route handler doesn't have to reason about which backend is
 * active. The default export is a singleton wired from the
 * environment.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';

export interface AudioStorage {
  /** Writes the blob and returns the storage key. */
  put(key: string, body: Uint8Array, mime: string): Promise<void>;
  delete(key: string): Promise<void>;
  /** Returns the URL the player should fetch. May be a local
   *  /audio/<key> path (dev) or a presigned S3 URL (prod). */
  urlFor(key: string): string;
}

const LOCAL_ROOT =
  process.env.AUDIO_LOCAL_ROOT ?? '/tmp/ciareader-audio';

class LocalAudioStorage implements AudioStorage {
  async put(key: string, body: Uint8Array, mime: string): Promise<void> {
    // mime is captured by the listing endpoint; the local backend
    // doesn't tag the on-disk blob with its content type (the
    // /audio/<key> route picks Content-Type from the extension).
    void mime;
    const file = path.join(LOCAL_ROOT, key);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, body);
  }
  async delete(key: string): Promise<void> {
    const file = path.join(LOCAL_ROOT, key);
    try {
      await fs.unlink(file);
    } catch {
      // Idempotent — missing key is not an error.
    }
  }
  urlFor(key: string): string {
    // The /audio/[key] route serves these in dev. Object storage
    // backends override with a presigned URL.
    return `/audio/${key}`;
  }
}

let singleton: AudioStorage | null = null;

export function getAudioStorage(): AudioStorage {
  if (!singleton) {
    // S3 wiring lives in the deployment ticket (T-13.x). For
    // dev + tests the local backend is the only branch.
    singleton = new LocalAudioStorage();
  }
  return singleton;
}

export function setAudioStorage(s: AudioStorage): void {
  singleton = s;
}

/**
 * Compose a storage key for a new upload. Includes a uuid so two
 * uploads with the same filename don't collide; the original
 * extension is preserved so the served file's Content-Type still
 * matches what the player expects.
 */
export function newAudioStorageKey(textId: string, originalName: string, randomId: string): string {
  // Strip path traversal + non-portable chars from the extension.
  const ext = (path.extname(originalName).match(/^\.[A-Za-z0-9]{1,5}$/)?.[0] ?? '').toLowerCase();
  return `texts/${textId}/${randomId}${ext}`;
}

const ALLOWED_MIME = new Set([
  'audio/mpeg',
  'audio/mp3',
  'audio/mp4',
  'audio/m4a',
  'audio/x-m4a',
  'audio/ogg',
  'audio/oga',
  'audio/webm',
]);

export function isAllowedAudioMime(mime: string): boolean {
  return ALLOWED_MIME.has(mime.toLowerCase());
}

/** Hard cap on the upload body size (T-9.1). 80MB covers a typical
 * 60-minute MP3 at 192kbps with margin; larger files almost
 * always indicate uncompressed WAV that we want the user to
 * re-encode before uploading. */
export const MAX_AUDIO_BYTES = 80 * 1024 * 1024;
