<svelte:head>
  <title>Client API Guide - CIA Reader</title>
  <meta
    name="description"
    content="Day-one CIA Reader API reference for mobile and external clients."
  />
</svelte:head>

<script lang="ts">
  const authEnvelope = `{
  "user": {
    "id": "user-id",
    "email": "reader@example.com",
    "displayName": "Reader",
    "role": "user"
  },
  "accessToken": "eyJ...",
  "refreshToken": "opaque-refresh-token",
  "expiresIn": 900
}`;

  const fetchExample = `const api = async (path, options = {}) => {
  const res = await fetch(\`/api/v1\${path}\`, {
    ...options,
    headers: {
      accept: 'application/json',
      authorization: \`Bearer \${accessToken}\`,
      ...(options.headers ?? {}),
    },
  });

  if (res.status === 401) {
    await refreshAccessToken();
    return api(path, options);
  }

  if (!res.ok) throw await res.json();
  return res.json();
};`;

  const errorEnvelope = `{
  "message": "Unauthorized"
}`;

  const rateLimitEnvelope = `{
  "error": "rate_limited",
  "message": "Too many translations submitted. Try again later.",
  "limit": 30,
  "retryAfterSeconds": 3600
}`;

  const paginationEnvelope = `{
  "lemmas": [],
  "totalCount": 1234,
  "limit": 50,
  "offset": 100
}`;
</script>

<main class="api-reference">
  <article>
    <header class="hero">
      <p class="eyebrow">Client reference</p>
      <h1>CIA Reader API</h1>
      <p>
        A practical first read for mobile clients and external integrations using
        the stable <code>/api/v1/*</code> API.
      </p>
      <nav aria-label="API documentation links">
        <a href="/api/docs">OpenAPI UI</a>
        <a href="/api/openapi.json">OpenAPI JSON</a>
        <a href="/docs/api-versioning.md">Versioning policy</a>
      </nav>
    </header>

    <section aria-labelledby="quick-start">
      <h2 id="quick-start">Quick Start</h2>
      <div class="facts">
        <div>
          <strong>Base path</strong>
          <span><code>/api/v1</code></span>
        </div>
        <div>
          <strong>Format</strong>
          <span>JSON requests and responses</span>
        </div>
        <div>
          <strong>Access token TTL</strong>
          <span>900 seconds</span>
        </div>
        <div>
          <strong>Stable contract</strong>
          <span><code>/api/v1/*</code> only</span>
        </div>
      </div>

      <p>
        Send <code>Accept: application/json</code> on every request. Mutating
        requests should also send <code>Content-Type: application/json</code>.
        Browser clients may rely on the session cookie set by login, but mobile
        clients should use bearer access tokens.
      </p>
    </section>

    <section aria-labelledby="auth-flow">
      <h2 id="auth-flow">Auth Flow</h2>
      <p>
        Create an account with <code>POST /auth/register</code> or sign in with
        <code>POST /auth/login</code>. Both endpoints return the same auth
        envelope and also set the web session cookie for browser clients.
      </p>

      <pre><code>{authEnvelope}</code></pre>

      <p>
        Store refresh tokens in device-secure storage. Keep access tokens in
        memory when possible, and send them as
        <code>Authorization: Bearer &lt;accessToken&gt;</code>. Use
        <code>GET /auth/me</code> to verify the current credential and retrieve
        the public user object.
      </p>

      <p>
        Personal API keys generated from the profile screen are long-lived
        service credentials. Send them as <code>X-API-Key: ciar_pk_...</code>
        or <code>Authorization: Bearer ciar_pk_...</code>. They do not use the
        refresh endpoint.
      </p>
    </section>

    <section aria-labelledby="token-refresh">
      <h2 id="token-refresh">Token Refresh</h2>
      <p>
        When an access token expires, call <code>POST /auth/refresh</code> with
        the current refresh token. The response returns a new access token and a
        new refresh token; replace the stored refresh token immediately.
      </p>

      <table>
        <thead>
          <tr>
            <th>Endpoint</th>
            <th>Body</th>
            <th>Client behavior</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>POST /auth/refresh</code></td>
            <td><code>{'{ "refreshToken": "..." }'}</code></td>
            <td>Rotate tokens and retry the original request once.</td>
          </tr>
          <tr>
            <td><code>POST /auth/logout</code></td>
            <td><code>{'{ "refreshToken": "..." }'}</code>, optional</td>
            <td>Revoke the refresh token and clear local credentials.</td>
          </tr>
        </tbody>
      </table>

      <p>
        If refresh returns <code>401</code>, clear local credentials and ask the
        user to sign in again. A presented but invalid bearer token never falls
        back to cookie authentication, which keeps broken clients visible.
      </p>

      <pre><code>{fetchExample}</code></pre>
    </section>

    <section aria-labelledby="errors">
      <h2 id="errors">Errors</h2>
      <p>
        Most API errors use a JSON object with at least a <code>message</code>
        property. Validation errors produced by Zod are folded into that
        message, so clients should display <code>message</code> and preserve any
        additional fields for diagnostics.
      </p>

      <pre><code>{errorEnvelope}</code></pre>

      <table>
        <thead>
          <tr>
            <th>Status</th>
            <th>Meaning</th>
            <th>Client behavior</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>400</code></td>
            <td>Invalid JSON, path parameter, query parameter, or body.</td>
            <td>Fix the request before retrying.</td>
          </tr>
          <tr>
            <td><code>401</code></td>
            <td>Missing, expired, or invalid authentication.</td>
            <td>Refresh once, then require sign-in.</td>
          </tr>
          <tr>
            <td><code>403</code></td>
            <td>The user is authenticated but not allowed.</td>
            <td>Do not retry automatically.</td>
          </tr>
          <tr>
            <td><code>404</code></td>
            <td>Resource not found, or intentionally hidden from this user.</td>
            <td>Remove stale local references.</td>
          </tr>
          <tr>
            <td><code>409</code></td>
            <td>Conflict with existing state.</td>
            <td>Reload the affected resource.</td>
          </tr>
          <tr>
            <td><code>429</code></td>
            <td>Rate limit exceeded.</td>
            <td>Respect <code>Retry-After</code>.</td>
          </tr>
        </tbody>
      </table>

      <p>
        Rate-limited mutation endpoints include
        <code>Retry-After</code>, <code>X-RateLimit-Limit</code>,
        <code>X-RateLimit-Remaining</code>, and
        <code>X-RateLimit-Subject</code>. Some endpoints add the richer body:
      </p>

      <pre><code>{rateLimitEnvelope}</code></pre>
    </section>

    <section aria-labelledby="pagination">
      <h2 id="pagination">Pagination</h2>
      <p>
        List endpoints use offset pagination unless their route documentation
        says otherwise. Send <code>limit</code> and <code>offset</code>, then
        advance by adding the returned <code>limit</code> to the returned
        <code>offset</code>. Stop when <code>offset + limit &gt;= totalCount</code>
        or when the returned item array is empty.
      </p>

      <pre><code>{paginationEnvelope}</code></pre>

      <p>
        Endpoints enforce caps to protect mobile payloads and the database.
        Treat the response values as authoritative because the server may clamp
        or reject out-of-range input.
      </p>
    </section>

    <section aria-labelledby="mobile-payloads">
      <h2 id="mobile-payloads">Mobile Payloads</h2>
      <p>
        Reader pages and chapter APIs are shaped so clients can avoid loading a
        whole book at once. Fetch the text/status surface first, then request
        chapter token payloads only for the active chapter.
      </p>

      <table>
        <thead>
          <tr>
            <th>Use case</th>
            <th>Endpoint</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Polling a processing text</td>
            <td><code>GET /texts/:id/status</code></td>
            <td>Small status and latest job fields.</td>
          </tr>
          <tr>
            <td>Dictionary browsing</td>
            <td><code>GET /dictionary/:language/lemmas</code></td>
            <td>Paginated lemma search with <code>limit</code>/<code>offset</code>.</td>
          </tr>
          <tr>
            <td>Chapter reading</td>
            <td><code>GET /texts/:id/chapters/:idx/tokens</code></td>
            <td>Returns one chapter body and token list.</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section aria-labelledby="contract">
      <h2 id="contract">Contract Stability</h2>
      <p>
        The OpenAPI spec is generated from SvelteKit routes and backed by
        contract tests for representative response shapes. Backward-compatible
        additions stay under <code>/api/v1</code>. Breaking changes require a
        later major prefix and the deprecation policy.
      </p>
    </section>
  </article>
</main>

<style>
  .api-reference {
    min-height: 100vh;
    background: var(--paper, var(--color-bg));
    color: var(--ink, var(--color-fg));
  }

  article {
    width: min(100% - 2rem, 74rem);
    margin: 0 auto;
    padding: 2rem 0 4rem;
  }

  .hero {
    padding: 2rem 0 2.5rem;
    border-bottom: 1px solid var(--rule, var(--color-border));
  }

  .eyebrow {
    margin: 0 0 0.4rem;
    color: var(--ink-3, var(--color-fg-muted));
    font-size: 0.75rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  h1,
  h2 {
    font-family: var(--font-serif, system-ui);
    letter-spacing: 0;
  }

  h1 {
    margin: 0;
    font-size: 3rem;
    line-height: 1;
  }

  h2 {
    margin: 0 0 1rem;
    font-size: 1.45rem;
  }

  p {
    max-width: 68ch;
    margin: 0.85rem 0 0;
    line-height: 1.65;
    color: var(--ink-2, var(--color-fg));
  }

  nav {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
    margin-top: 1.25rem;
  }

  a {
    color: inherit;
    text-decoration: none;
    border: 1px solid var(--rule, var(--color-border));
    border-radius: 7px;
    padding: 0.45rem 0.7rem;
    font-size: 0.88rem;
  }

  a:hover {
    background: color-mix(in oklch, var(--ink, var(--color-fg)) 6%, transparent);
  }

  section {
    padding: 2rem 0;
    border-bottom: 1px solid var(--rule, var(--color-border));
  }

  .facts {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 0.75rem;
    margin: 1rem 0 1.25rem;
  }

  .facts div {
    border: 1px solid var(--rule, var(--color-border));
    border-radius: 7px;
    padding: 0.8rem;
  }

  strong,
  .facts span {
    display: block;
  }

  strong {
    font-size: 0.72rem;
    color: var(--ink-3, var(--color-fg-muted));
    text-transform: uppercase;
  }

  .facts span {
    margin-top: 0.3rem;
  }

  code {
    font-family: var(--font-mono-display, var(--font-mono));
    font-size: 0.9em;
  }

  pre {
    overflow-x: auto;
    margin: 1rem 0 0;
    padding: 1rem;
    border: 1px solid var(--rule, var(--color-border));
    border-radius: 7px;
    background: color-mix(in oklch, var(--ink, var(--color-fg)) 5%, transparent);
  }

  pre code {
    font-size: 0.82rem;
    line-height: 1.55;
  }

  table {
    width: 100%;
    margin-top: 1rem;
    border-collapse: collapse;
    border: 1px solid var(--rule, var(--color-border));
  }

  th,
  td {
    padding: 0.65rem 0.75rem;
    border-bottom: 1px solid var(--rule-2, var(--color-border));
    text-align: left;
    vertical-align: top;
  }

  th {
    color: var(--ink-3, var(--color-fg-muted));
    font-size: 0.72rem;
    text-transform: uppercase;
  }

  @media (max-width: 800px) {
    article {
      width: min(100% - 1.25rem, 74rem);
      padding-top: 1rem;
    }

    .facts {
      grid-template-columns: 1fr 1fr;
    }

    h1 {
      font-size: 2.35rem;
    }

    table {
      display: block;
      overflow-x: auto;
    }
  }

  @media (max-width: 520px) {
    .facts {
      grid-template-columns: 1fr;
    }

    h1 {
      font-size: 2rem;
    }
  }
</style>
