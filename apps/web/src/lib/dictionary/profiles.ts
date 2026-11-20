import type { LanguageCode } from '@ciareader/shared-types';
import { hindiReviewHref } from './hindi-review-link';
import { hindiPatterns, normalizeHindiForm } from './hindi-patterns';
import { partsOfSpeech, type Inventory } from './workshop';

export interface DictionaryPattern {
  id: string;
  label: string;
  applies: (lemma: string, pos: string) => boolean;
  forms: (lemma: string) => string[];
  slots?: (lemma: string) => { id: string; label: string; forms?: string[] }[];
}

interface DictionaryProfile {
  patterns: (lemma: string, pos: string, current: string) => { id: string; label: string }[];
  normalize: (word: string) => string;
  partsOfSpeech: Record<string, string>;
  caseSensitive: boolean;
  strictPartsOfSpeech: boolean;
  requiresStoredEntry: boolean;
  slotSource?: string;
  sources: { id: string; name: string; domain: string }[];
  phraseWord: RegExp;
  verbHint?: (word: string) => boolean;
  negativeVariants?: readonly string[];
  reviewHref?: typeof hindiReviewHref;
  preferenceKey?: string;
  initialView?: 'review' | 'entries';
  inventory: (lemma: string, pos: string, paradigm: string) => Inventory;
  generate: (lemma: string, pos: string, paradigm: string) => string[];
}

export function savedFormProfile(rules: DictionaryPattern[] = []): DictionaryProfile {
  return {
    caseSensitive: false,
    strictPartsOfSpeech: false,
    requiresStoredEntry: false,
    sources: [],
    phraseWord: /^[\p{L}][\p{L}\p{M}\u200c\u200d]*(?:[-'’־׳״][\p{L}][\p{L}\p{M}\u200c\u200d]*)*$/u,
    normalize: (word) => word.trim().replace(/\s+/gu, ' ').normalize('NFC'),
    partsOfSpeech: Object.fromEntries(
      Object.entries(partsOfSpeech).filter(([pos]) => pos !== 'VBASE' && pos !== 'ONOM'),
    ),
    patterns: (lemma, pos, current) => [
      { id: 'invariant', label: 'No generated forms' },
      ...rules.filter((rule) => rule.id === current || rule.applies(lemma, pos)),
    ],
    inventory: (lemma, pos, paradigm) => ({
      version: '1',
      lemma,
      pos,
      paradigm,
      slots: (
        rules.find((rule) => rule.id === paradigm && rule.applies(lemma, pos))?.slots?.(lemma) ?? []
      ).map(({ id, label, forms = [] }) => ({
        id,
        label,
        forms,
        include: false,
        applicability: 'unknown',
      })),
    }),
    generate: (lemma, pos, paradigm) => {
      if (paradigm === 'invariant') return [];
      const rule = rules.find((rule) => rule.id === paradigm && rule.applies(lemma, pos));
      if (!rule) throw new Error('Choose a pattern for this part of speech and spelling');
      return rule.forms(lemma);
    },
  };
}

const savedForms = savedFormProfile();
const profiles: Partial<Record<LanguageCode, DictionaryProfile>> = {
  hi: {
    ...savedForms,
    caseSensitive: true,
    strictPartsOfSpeech: true,
    requiresStoredEntry: true,
    slotSource: 'Wiktionary',
    sources: [
      { id: 'hindwi', name: 'Hindwi', domain: 'hindwidictionary.com' },
      { id: 'rekhta', name: 'Rekhta', domain: 'rekhtadictionary.com' },
    ],
    phraseWord: /^(?=.*\p{L})[\p{Script_Extensions=Devanagari}\p{M}\p{N}]+$/u,
    verbHint: (word) => word.endsWith('ना'),
    negativeVariants: ['न', 'नहीं'],
    reviewHref: hindiReviewHref,
    preferenceKey: 'hindi',
    initialView: 'review',
    normalize: normalizeHindiForm,
    partsOfSpeech,
    patterns: hindiPatterns,
  },
};

export function dictionaryProfile(language: LanguageCode) {
  return profiles[language] ?? savedForms;
}

export function workshopPath(language: LanguageCode) {
  return `/dictionary/${language}/workshop`;
}
