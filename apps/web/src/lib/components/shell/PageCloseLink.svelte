<script lang="ts">
  let { href, label }: { href: string; label: string } = $props();
</script>

<a {href} aria-label={label} title={label}>
  <svg
    viewBox="0 0 24 24"
    width="14"
    height="14"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    aria-hidden="true"
  >
    <path d="M6 6l12 12" />
    <path d="M18 6L6 18" />
  </svg>
</a>

<style>
  a {
    width: 32px;
    height: 32px;
    display: grid;
    place-items: center;
    color: var(--ink-3, var(--color-fg-muted));
    text-decoration: none;
    border: 1px solid transparent;
    border-radius: 8px;
    transition:
      background 150ms ease,
      color 150ms ease,
      border-color 150ms ease;
  }
  a:hover {
    color: var(--ink, var(--color-fg));
    background: color-mix(in oklch, var(--ink, var(--color-fg)) 6%, transparent);
    border-color: var(--rule, var(--color-border));
  }
  @media (max-width: 639px) {
    a {
      width: 44px;
      height: 44px;
    }
  }
</style>
