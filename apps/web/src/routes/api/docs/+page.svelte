<svelte:head>
  <title>API Docs — CIA Reader</title>
  <meta
    name="description"
    content="CIA Reader OpenAPI 3.1 reference for v1 web/mobile clients."
  />
  <link
    rel="stylesheet"
    href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css"
  />
</svelte:head>

<script lang="ts">
  import { onMount } from 'svelte';

  const specUrl = '/api/openapi.json';
  const swaggerScriptUrl =
    'https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js';

  type SwaggerUIBundle = (config: {
    url: string;
    dom_id: string;
    deepLinking: boolean;
    layout: string;
  }) => unknown;

  type ApiOperation = {
    operationId?: string;
    summary?: string;
    tags?: string[];
  };

  type ApiSpec = {
    paths: Record<string, Record<string, ApiOperation>>;
  };

  type Row = {
    method: string;
    path: string;
    summary: string;
    tag: string;
  };

  let rows = $state<Row[]>([]);
  let error = $state<string | null>(null);
  let swaggerMounted = $state(false);

  function loadScript(src: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${src}"]`);
      if (existing) {
        resolve();
        return;
      }

      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.addEventListener('load', () => resolve(), { once: true });
      script.addEventListener(
        'error',
        () => reject(new Error('Swagger UI failed to load')),
        { once: true },
      );
      document.head.append(script);
    });
  }

  async function loadFallbackRows() {
    const res = await fetch(specUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const spec = (await res.json()) as ApiSpec;
    rows = Object.entries(spec.paths)
      .flatMap(([path, methods]) =>
        Object.entries(methods).map(([method, op]) => ({
          method: method.toUpperCase(),
          path,
          summary: op.summary ?? op.operationId ?? path,
          tag: op.tags?.[0] ?? 'API',
        })),
      )
      .sort(
        (a, b) =>
          a.path.localeCompare(b.path) || a.method.localeCompare(b.method),
      );
  }

  onMount(() => {
    void (async () => {
      try {
        await loadScript(swaggerScriptUrl);
        const swaggerWindow = window as typeof globalThis & {
          SwaggerUIBundle?: SwaggerUIBundle;
        };
        swaggerWindow.SwaggerUIBundle?.({
          url: specUrl,
          dom_id: '#swagger-ui',
          deepLinking: true,
          layout: 'BaseLayout',
        });
        swaggerMounted = true;
      } catch (e) {
        try {
          await loadFallbackRows();
        } catch (fallbackError) {
          error =
            fallbackError instanceof Error
              ? fallbackError.message
              : (e as Error).message;
        }
      }
    })();
  });
</script>

<main class="api-docs">
  <header>
    <div>
      <p class="eyebrow">OpenAPI 3.1</p>
      <h1>CIA Reader API</h1>
    </div>
    <nav aria-label="API documentation links">
      <a href="/docs/api/">Client guide</a>
      <a href={specUrl}>JSON</a>
    </nav>
  </header>

  <section class="viewer" aria-label="OpenAPI reference">
    <div id="swagger-ui" class:mounted={swaggerMounted}></div>

    {#if swaggerMounted}
      <span class="sr-only">Swagger UI loaded</span>
    {:else if error}
      <p class="empty">Could not load OpenAPI spec: {error}</p>
    {:else if rows.length === 0}
      <p class="empty">Loading…</p>
    {:else}
      <table>
        <thead>
          <tr>
            <th>Method</th>
            <th>Path</th>
            <th>Area</th>
            <th>Summary</th>
          </tr>
        </thead>
        <tbody>
          {#each rows as row (`${row.method}-${row.path}`)}
            <tr>
              <td><span class="method">{row.method}</span></td>
              <td><code>{row.path}</code></td>
              <td>{row.tag}</td>
              <td>{row.summary}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </section>
</main>

<style>
  .api-docs {
    min-height: 100vh;
    background: var(--paper, var(--color-bg));
    color: var(--ink, var(--color-fg));
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 1rem 1.25rem;
    border-bottom: 1px solid var(--rule, var(--color-border));
  }
  h1 {
    margin: 0.1rem 0 0;
    font-size: 1.25rem;
    font-family: var(--font-serif, system-ui);
  }
  .eyebrow {
    margin: 0;
    font-size: 0.68rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--ink-3, var(--color-fg-muted));
  }
  nav {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
    justify-content: flex-end;
  }
  a {
    color: inherit;
    text-decoration: none;
    border: 1px solid var(--rule, var(--color-border));
    border-radius: 7px;
    padding: 0.4rem 0.65rem;
    font-size: 0.82rem;
  }
  .viewer {
    padding: 0 0 2rem;
    overflow-x: auto;
  }
  #swagger-ui {
    display: none;
  }
  #swagger-ui.mounted {
    display: block;
  }
  table {
    margin: 1rem 1.25rem 0;
    width: calc(100% - 2.5rem);
    border-collapse: collapse;
    background: var(--card, var(--color-bg));
    border: 1px solid var(--rule, var(--color-border));
  }
  th,
  td {
    padding: 0.55rem 0.7rem;
    border-bottom: 1px solid var(--rule-2, var(--color-border));
    text-align: left;
    font-size: 0.84rem;
    vertical-align: top;
  }
  th {
    font-size: 0.72rem;
    color: var(--ink-3, var(--color-fg-muted));
    text-transform: uppercase;
    letter-spacing: 0.06em;
    background: color-mix(in oklch, var(--ink, var(--color-fg)) 4%, transparent);
  }
  code {
    font-family: var(--font-mono-display, var(--font-mono));
    font-size: 0.78rem;
    white-space: nowrap;
  }
  .method {
    display: inline-flex;
    min-width: 4.2rem;
    justify-content: center;
    border-radius: 7px;
    border: 1px solid var(--rule, var(--color-border));
    padding: 0.15rem 0.35rem;
    font-family: var(--font-mono-display, var(--font-mono));
    font-size: 0.7rem;
  }
  .empty {
    color: var(--ink-3, var(--color-fg-muted));
    padding: 1rem 1.25rem;
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
</style>
