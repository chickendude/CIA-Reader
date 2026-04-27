<!--
  Translation provenance badge (T-3.8).

  Renders one short pill per translation in the reader pop-up + on the
  /moderation/dictionary editor + anywhere else translations are shown.
  The colour, text, and tooltip are derived entirely from the
  `provenance` discriminator on `PublicTranslation` — never from the raw
  `source` column — so adding a new provenance category later (e.g.
  "promoted-override") is one switch case, not a sweep.

  Visual design is deliberately small and unobtrusive: badges sit
  inline next to the translation body, not above it. The tooltip
  (`title` attribute) carries the long form attribution for imported
  rows. Touch users get the same info via the visible badge text plus a
  longer aria-label.
-->
<script lang="ts">
  import type { TranslationProvenance } from '$lib/server/dictionary/lookups.js';
  import { provenanceDisplay } from './provenance-display.js';

  let { provenance }: { provenance: TranslationProvenance } = $props();

  const display = $derived(provenanceDisplay(provenance));
</script>

<span
  class="badge tone-{display.tone}"
  title={display.tooltip}
  aria-label={display.tooltip}
  data-testid="provenance-badge"
  data-kind={provenance.kind}
>
  {display.label}
</span>

<style>
  .badge {
    display: inline-block;
    padding: 0.05rem 0.45rem;
    font-size: 0.72rem;
    font-weight: 500;
    line-height: 1.6;
    border-radius: 999px;
    border: 1px solid var(--color-border);
    color: var(--color-fg-muted);
    background: var(--color-bg);
    /* Long imported attributions (e.g. "Hindi WordNet (CFILT, IIT-Bombay)")
       can wrap awkwardly inside the inline pill — clip them so the badge
       always stays a single line. */
    max-width: 14rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    vertical-align: baseline;
  }
  .tone-personal {
    border-color: color-mix(in srgb, var(--color-accent) 60%, transparent);
    color: var(--color-accent);
    background: color-mix(in srgb, var(--color-accent) 10%, transparent);
  }
  .tone-curator {
    border-color: color-mix(in srgb, #197a2f 60%, transparent);
    color: #197a2f;
    background: color-mix(in srgb, #197a2f 10%, transparent);
  }
  .tone-imported {
    /* Tonally neutral so a long attribution doesn't dominate the pop-up. */
    border-color: var(--color-border);
    color: var(--color-fg-muted);
  }
  .tone-community {
    border-color: color-mix(in srgb, #b07a31 60%, transparent);
    color: #b07a31;
    background: color-mix(in srgb, #b07a31 10%, transparent);
  }
</style>
