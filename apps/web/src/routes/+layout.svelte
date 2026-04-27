<script lang="ts">
  let { children } = $props();
</script>

<svelte:head>
  <style>
    :root {
      --bg: #ffffff;
      --fg: #111111;
      --muted: #6b7280;
      --accent: #2563eb;
      --border: #e5e7eb;
      --code-bg: #f3f4f6;
      font-family:
        system-ui,
        -apple-system,
        'Segoe UI',
        Roboto,
        'Helvetica Neue',
        Arial,
        sans-serif;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #0b0b0d;
        --fg: #f5f5f7;
        --muted: #9ca3af;
        --accent: #60a5fa;
        --border: #27272a;
        --code-bg: #18181b;
      }
    }
    html,
    body {
      margin: 0;
      padding: 0;
      background: var(--bg);
      color: var(--fg);
    }
    body {
      min-height: 100vh;
    }
  </style>
</svelte:head>

{@render children()}
