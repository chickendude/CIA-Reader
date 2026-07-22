import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  // WEB_PORT overrides the dev/preview port (default 5173) for machines
  // where another project already claims it. Read via loadEnv so a
  // gitignored apps/web/.env works, not just shell exports. The
  // project-wide default stays 5173 — README, CI, the extension's
  // default apiBaseUrl, and the Docker-internal prod port all assume
  // it. APP_BASE_URL (magic-link emails) derives from the same
  // variable in src/lib/server/env.ts, so one setting moves both.
  const env = loadEnv(mode, process.cwd(), '');
  const port = Number(env.WEB_PORT ?? 5173);

  return {
    plugins: [sveltekit()],
    server: {
      host: '0.0.0.0',
      port,
      strictPort: true,
      watch: {
        // Work across bind-mounts from the host into the container.
        usePolling: true,
        interval: 300,
      },
    },
    preview: {
      host: '0.0.0.0',
      port,
      strictPort: true,
    },
  };
});
