import { getContext, setContext } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
import type { ServerToken } from './types';

const key = Symbol('ignored reader occurrences');

export function readerOccurrenceIgnores() {
  const existing = getContext<SvelteMap<string, boolean> | undefined>(key);
  return existing ?? setContext(key, new SvelteMap<string, boolean>());
}

export function isIgnoredHere(token: ServerToken, changes: SvelteMap<string, boolean>) {
  return changes.get(token.id) ?? token.ignoredHere ?? false;
}
