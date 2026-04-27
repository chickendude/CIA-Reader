/**
 * Visual mapping for the translation `provenance` discriminator (T-3.8).
 *
 * Lifted out of `ProvenanceBadge.svelte` so the label / tooltip / tone
 * decisions are unit-testable without spinning up jsdom. The component
 * is a thin renderer over this — adding a new provenance category is
 * one switch case here, no template work.
 */
import type { TranslationProvenance } from '$lib/server/dictionary/lookups.js';

export type ProvenanceDisplay = {
  label: string;
  tooltip: string;
  tone: 'personal' | 'curator' | 'imported' | 'community';
};

export function provenanceDisplay(
  provenance: TranslationProvenance,
): ProvenanceDisplay {
  switch (provenance.kind) {
    case 'personal':
      return {
        label: 'yours',
        tooltip: 'Your customization — only visible to you.',
        tone: 'personal',
      };
    case 'curator':
      return {
        label: provenance.attribution ?? 'curator',
        tooltip: provenance.attribution
          ? `Curator-edited (${provenance.attribution}).`
          : 'Curator-edited entry.',
        tone: 'curator',
      };
    case 'imported':
      return {
        label: provenance.attribution ?? 'imported',
        tooltip: provenance.attribution
          ? `Imported from ${provenance.attribution}.`
          : 'Imported from an open-source dictionary.',
        tone: 'imported',
      };
    case 'community':
      return {
        label: 'community',
        tooltip: 'Submitted by another reader.',
        tone: 'community',
      };
  }
}
