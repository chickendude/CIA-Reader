<script lang="ts">
  import { buildDeckTree, type DeckNode } from '$lib/anki-connect';

  let { decks, chosen, onSelect }: {
    decks: string[];
    chosen: string[];
    onSelect: (next: string[]) => void;
  } = $props();
  const roots = $derived(buildDeckTree(decks));
  const selected = $derived(new Set(chosen));
  let expanded = $state<string[]>([]);

  function toggleBranch(path: string) {
    expanded = expanded.includes(path) ? expanded.filter((p) => p !== path) : [...expanded, path];
  }

  function select(node: DeckNode, checked: boolean) {
    const next = new Set(chosen);
    for (const deck of node.decks) {
      if (checked) next.add(deck);
      else next.delete(deck);
    }
    onSelect([...next]);
  }
</script>

{#snippet branch(nodes: DeckNode[])}
  <ul>
    {#each nodes as node (node.path)}
      {@const count = node.decks.filter((deck) => selected.has(deck)).length}
      {@const isOpen = expanded.includes(node.path)}
      <li>
        <div class="deck-row">
          {#if node.children.length}
            <button type="button" aria-expanded={isOpen} aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${node.path}`}
              onclick={() => toggleBranch(node.path)}><span aria-hidden="true">{isOpen ? '−' : '+'}</span></button>
          {/if}
          <label>
            <input type="checkbox" aria-label={node.path} checked={count === node.decks.length}
              indeterminate={count > 0 && count < node.decks.length} onchange={(e) => select(node, e.currentTarget.checked)} />
            {node.name}
          </label>
        </div>
        {#if node.children.length && isOpen}{@render branch(node.children)}{/if}
      </li>
    {/each}
  </ul>
{/snippet}

{@render branch(roots)}

<style>
  ul { list-style: none; margin: 0; padding: 0; }
  ul ul { padding-inline-start: 1.25rem; }
  .deck-row { display: grid; grid-template-columns: 2rem minmax(0, 1fr); align-items: center; }
  label { grid-column: 2; display: flex; align-items: center; gap: .45rem; padding: .35rem 0; overflow-wrap: anywhere; cursor: pointer; }
  button { display: grid; place-items: center; width: 2rem; height: 2rem; padding: 0; border: 0; border-radius: .3rem; background: transparent; color: var(--ink-2); font-size: 1rem; cursor: pointer; }
  button:hover, button:focus-visible { background: var(--paper-2); }
</style>
