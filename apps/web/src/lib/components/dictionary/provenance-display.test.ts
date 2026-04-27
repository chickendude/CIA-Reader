import { describe, expect, it } from 'vitest';
import { provenanceDisplay } from './provenance-display.js';

describe('provenanceDisplay (T-3.8)', () => {
  it('renders "yours" for the personal kind', () => {
    expect(provenanceDisplay({ kind: 'personal', attribution: null })).toEqual({
      label: 'yours',
      tooltip: 'Your customization — only visible to you.',
      tone: 'personal',
    });
  });

  it('uses the curator attribution as the label when present', () => {
    const d = provenanceDisplay({ kind: 'curator', attribution: 'CIA Reader curators' });
    expect(d.label).toBe('CIA Reader curators');
    expect(d.tone).toBe('curator');
    expect(d.tooltip).toContain('CIA Reader curators');
  });

  it('falls back to "curator" when no attribution is set', () => {
    const d = provenanceDisplay({ kind: 'curator', attribution: null });
    expect(d.label).toBe('curator');
    expect(d.tooltip).toBe('Curator-edited entry.');
  });

  it('uses the upstream attribution verbatim for imported rows', () => {
    const d = provenanceDisplay({
      kind: 'imported',
      attribution: 'Hindi WordNet (CFILT, IIT-Bombay)',
    });
    expect(d.label).toBe('Hindi WordNet (CFILT, IIT-Bombay)');
    expect(d.tooltip).toBe('Imported from Hindi WordNet (CFILT, IIT-Bombay).');
    expect(d.tone).toBe('imported');
  });

  it('falls back to "imported" when no attribution is set', () => {
    const d = provenanceDisplay({ kind: 'imported', attribution: null });
    expect(d.label).toBe('imported');
  });

  it('renders "community" for unattributed user submissions', () => {
    const d = provenanceDisplay({ kind: 'community', attribution: null });
    expect(d.label).toBe('community');
    expect(d.tone).toBe('community');
  });
});
