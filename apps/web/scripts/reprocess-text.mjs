// Run the reader's chapter reprocessor without starting the web app.
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const textId = process.argv[2];
if (!textId) {
  console.error('Usage: node apps/web/scripts/reprocess-text.mjs <textId>');
  process.exit(1);
}

process.chdir(fileURLToPath(new URL('../', import.meta.url)));
const server = await createServer({
  server: { middlewareMode: true, hmr: false, watch: null },
  appType: 'custom',
});
const { db } = await server.ssrLoadModule('/src/lib/server/db/index.ts');
try {
  const text = await db.query.texts.findFirst({
    columns: { sourceType: true },
    where: (texts, { eq }) => eq(texts.id, textId),
  });
  if (text) {
    const run = text.sourceType === 'pdf'
      ? (await server.ssrLoadModule('/src/lib/server/texts/pdf-page.ts')).reprocessPdfText
      : (await server.ssrLoadModule('/src/lib/server/texts/in-process-dispatcher.ts')).processTextNow;
    const count = await run(textId, (done, total) => console.log(`Chapters: ${done}/${total}`));
    console.log(`Saved ${count} tokens.`);
  } else {
    console.error(`Text ${textId} not found.`);
    process.exitCode = 2;
  }
} catch (error) {
  console.error(error);
  process.exitCode = 3;
} finally {
  await server.close();
  await db.$client.end();
}
