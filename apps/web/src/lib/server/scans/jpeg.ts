/**
 * Minimal JPEG dimension reader for the scan-ingestion CLI.
 *
 * `pdftoppm -jpeg` gives us the page image but not its pixel size, and
 * the `scan_pages` row needs width/height so the workbench can compute
 * aspect ratio and normalize crop boxes. Parsing the SOF header is ~30
 * lines; pulling in an image library (sharp et al.) for two integers is
 * not worth the native dependency.
 */

/**
 * Returns {width, height} from a JPEG's Start-Of-Frame marker, or null
 * when the buffer isn't a parseable JPEG. Walks the marker chain:
 * segments are [0xFF, marker, len_hi, len_lo, ...payload]; SOF0–SOF15
 * (excluding DHT/JPG/DAC 0xC4/0xC8/0xCC) carry dimensions at payload
 * offset 1 (height) and 3 (width), big-endian.
 */
export function jpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1]!;
    // Standalone markers without a length payload.
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      offset += 2;
      continue;
    }
    const length = (bytes[offset + 2]! << 8) | bytes[offset + 3]!;
    if (length < 2) return null;
    const isSof =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      const height = (bytes[offset + 5]! << 8) | bytes[offset + 6]!;
      const width = (bytes[offset + 7]! << 8) | bytes[offset + 8]!;
      return width > 0 && height > 0 ? { width, height } : null;
    }
    if (marker === 0xda) return null; // Start of scan — no SOF seen, malformed.
    offset += 2 + length;
  }
  return null;
}
