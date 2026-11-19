import { Readable } from 'node:stream';

import { db, schema } from '../db/index.js';
import type { TextChapter } from '../db/schema.js';
import { getPdfStorage, MAX_PAGE_IMAGE_BYTES, pageImageStorageKey } from '../pdf/storage.js';
import { EpubParseError, type EpubImage } from './epub.js';

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type WritePages = (
  textId: string, images: EpubImage[], title: string, now: Date,
) => Promise<TextChapter[]>;

async function readPage(image: EpubImage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of new Readable().wrap(image.file.nodeStream())) {
    const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    size += bytes.length;
    if (size > MAX_PAGE_IMAGE_BYTES) throw new EpubParseError('EPUB page image exceeds 8 MB');
    chunks.push(bytes);
  }
  const bytes = Buffer.concat(chunks);
  const valid = image.mime === 'image/jpeg' ? bytes[0] === 255 && bytes[1] === 216
    : image.mime === 'image/png' ? bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a'
    : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  if (!valid) throw new EpubParseError('EPUB page image does not match its declared format');
  return bytes;
}

// Roll back page files alongside the rows that refer to them.
export async function chapterBookTransaction<T>(
  run: (tx: Transaction, writePages: WritePages) => Promise<T>,
): Promise<T> {
  const keys: string[] = [];
  const storage = getPdfStorage();
  let totalBytes = 0;
  try {
    return await db.transaction(async (tx) => {
      const writePages: WritePages = async (textId, images, title, now) => {
        const pages = [];
        for (const [idx, image] of images.entries()) {
          const key = pageImageStorageKey(textId, idx, image.mime);
          const bytes = await readPage(image);
          totalBytes += bytes.length;
          if (totalBytes > 256 * 1024 * 1024 || keys.length >= 2000) {
            throw new EpubParseError('EPUB exceeds the illustrated page import limit');
          }
          keys.push(key);
          await storage.put(key, bytes, image.mime);
          pages.push({
            textId, idx, title, body: '', tokenCount: 0, createdAt: now,
            pageImageKey: key, pageImageMime: image.mime,
          });
        }
        return tx.insert(schema.textChapters).values(pages).returning();
      };
      return run(tx, writePages);
    });
  } catch (err) {
    await Promise.allSettled(keys.map((key) => storage.delete(key)));
    throw err;
  }
}
