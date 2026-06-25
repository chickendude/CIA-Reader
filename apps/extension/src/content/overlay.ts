/**
 * On-page UI: a caption bar with hover-able words (in a shadow root so the page
 * CSS can't leak) and a definition popup. On hover it shows the offline internal
 * dictionary immediately, then loads the external reference dictionaries
 * (Elhuyar eu-es/eu-en + Euskaltzaindia) asynchronously. An EN/ES/EU filter
 * controls which definition languages are shown.
 */
import type { ExportedLemma } from '../shared/api-types';
import type { DefinitionLang, LookupResult, ReferenceEntry } from '../shared/lookup';
import { referenceSourceLang } from '../shared/lookup';
import { splitCueWords } from './tokenize';

type Deps = {
  lookup: (surface: string) => Promise<LookupResult>;
  reference: (word: string) => Promise<ReferenceEntry[]>;
};

type RefState = 'idle' | 'loading' | 'done' | 'error';
type PopupState = {
  surface: string;
  lookup: LookupResult | null;
  reference: ReferenceEntry[];
  refState: RefState;
  error: string | null;
};

const STYLE = `
:host { all: initial; }
* { box-sizing: border-box; }
.bar {
  position: fixed; left: 50%; bottom: 9%; transform: translateX(-50%);
  max-width: 84vw; z-index: 2147483000; text-align: center; pointer-events: none;
  font-family: system-ui, -apple-system, sans-serif;
}
.cue {
  display: inline-block; background: rgba(0,0,0,0.8); color: #fff;
  padding: 6px 14px; border-radius: 10px; font-size: 26px; line-height: 1.4;
  pointer-events: auto; white-space: pre-wrap;
}
.w { cursor: pointer; border-radius: 4px; padding: 0 1px; transition: background 60ms; }
.w:hover { background: #ffd54a; color: #000; }
.popup {
  position: fixed; z-index: 2147483001; width: 380px; max-width: 92vw; max-height: 64vh;
  overflow: auto; background: #1d1f23; color: #e8e8e8; border: 1px solid #3a3d44;
  border-radius: 12px; padding: 12px 14px; box-shadow: 0 10px 34px rgba(0,0,0,0.55);
  font: 14px/1.45 system-ui, -apple-system, sans-serif; pointer-events: auto;
}
.popup .hd { display: flex; align-items: baseline; gap: 8px; }
.popup h2 { margin: 0; font-size: 18px; }
.popup .lemma { color: #8ab4ff; font-size: 13px; }
.popup .x { margin-left: auto; cursor: pointer; color: #9aa; font-size: 18px; line-height: 1; }
.popup .chips { display: flex; gap: 6px; margin: 8px 0 4px; }
.popup .chip {
  cursor: pointer; font-size: 12px; font-weight: 600; padding: 2px 9px; border-radius: 999px;
  border: 1px solid #3a3d44; color: #aab; user-select: none;
}
.popup .chip.on { background: #2b6cb0; border-color: #2b6cb0; color: #fff; }
.popup .grp { margin-top: 8px; padding-top: 8px; border-top: 1px solid #2e3138; }
.popup .grp-label { color: #9fb; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; margin-bottom: 3px; }
.popup .head { font-weight: 600; }
.popup .pos { color: #8fce8f; font-size: 12px; margin-left: 6px; }
.popup .def { margin: 2px 0; }
.popup .ex { color: #b9b9b9; font-style: italic; font-size: 13px; margin: 1px 0 1px 8px; }
.popup .muted { color: #9a9a9a; font-size: 13px; }
`;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

const LANGS: DefinitionLang[] = ['en', 'es', 'eu'];

export class Overlay {
  private host: HTMLElement;
  private root: ShadowRoot;
  private bar: HTMLElement;
  private cueEl: HTMLElement;
  private popup: HTMLElement | null = null;

  private openTimer: ReturnType<typeof setTimeout> | null = null;
  private closeTimer: ReturnType<typeof setTimeout> | null = null;
  private anchor: HTMLElement | null = null;
  private state: PopupState | null = null;
  private selected = new Set<DefinitionLang>(LANGS);

  constructor(private deps: Deps) {
    this.host = el('div');
    this.host.id = 'primeran-miner-overlay';
    this.root = this.host.attachShadow({ mode: 'open' });
    const style = el('style');
    style.textContent = STYLE;
    this.bar = el('div', 'bar');
    this.cueEl = el('div', 'cue');
    this.bar.append(this.cueEl);
    this.bar.style.display = 'none';
    this.root.append(style, this.bar);
    document.documentElement.append(this.host);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.close();
    });
  }

  setCue(text: string | null): void {
    this.cueEl.textContent = '';
    if (!text) {
      this.bar.style.display = 'none';
      return;
    }
    for (const part of splitCueWords(text)) {
      if (part.word) {
        const span = el('span', 'w', part.text);
        span.addEventListener('mouseenter', () => this.scheduleOpen(part.text, span));
        span.addEventListener('mouseleave', () => this.scheduleClose());
        this.cueEl.append(span);
      } else {
        this.cueEl.append(document.createTextNode(part.text));
      }
    }
    this.bar.style.display = '';
  }

  // ---- hover lifecycle ----

  private scheduleOpen(surface: string, anchor: HTMLElement): void {
    if (this.closeTimer) {
      clearTimeout(this.closeTimer);
      this.closeTimer = null;
    }
    if (this.popup && this.state?.surface === surface) return; // already showing it
    if (this.openTimer) clearTimeout(this.openTimer);
    this.openTimer = setTimeout(() => void this.openFor(surface, anchor), 120);
  }

  private scheduleClose(): void {
    if (this.openTimer) {
      clearTimeout(this.openTimer);
      this.openTimer = null;
    }
    if (this.closeTimer) clearTimeout(this.closeTimer);
    this.closeTimer = setTimeout(() => this.close(), 250);
  }

  private close(): void {
    if (this.openTimer) clearTimeout(this.openTimer);
    if (this.closeTimer) clearTimeout(this.closeTimer);
    this.openTimer = this.closeTimer = null;
    this.popup?.remove();
    this.popup = null;
    this.state = null;
    this.anchor = null;
  }

  private async openFor(surface: string, anchor: HTMLElement): Promise<void> {
    this.anchor = anchor;
    this.state = { surface, lookup: null, reference: [], refState: 'idle', error: null };
    this.render();

    let result: LookupResult;
    try {
      result = await this.deps.lookup(surface);
    } catch (e) {
      if (this.state?.surface !== surface) return;
      this.state.error = e instanceof Error ? e.message : String(e);
      this.render();
      return;
    }
    if (this.state?.surface !== surface) return; // hovered elsewhere meanwhile
    this.state.lookup = result;
    this.state.refState = 'loading';
    this.render();

    const word = result.lemmas[0] ?? surface;
    try {
      const reference = await this.deps.reference(word);
      if (this.state?.surface !== surface) return;
      this.state.reference = reference;
      this.state.refState = 'done';
    } catch {
      if (this.state?.surface !== surface) return;
      this.state.refState = 'error';
    }
    this.render();
  }

  // ---- rendering ----

  private render(): void {
    if (!this.state || !this.anchor) return;
    const s = this.state;
    const content = el('div');

    const hd = el('div', 'hd');
    hd.append(el('h2', undefined, s.surface));
    const lemma = s.lookup?.lemmas[0];
    if (lemma && lemma !== s.surface) hd.append(el('span', 'lemma', `→ ${s.lookup!.lemmas.join(', ')}`));
    const close = el('span', 'x', '×');
    close.addEventListener('click', () => this.close());
    hd.append(close);
    content.append(hd);

    const chips = el('div', 'chips');
    for (const lang of LANGS) {
      const chip = el('span', `chip${this.selected.has(lang) ? ' on' : ''}`, lang.toUpperCase());
      chip.addEventListener('click', () => {
        if (this.selected.has(lang)) this.selected.delete(lang);
        else this.selected.add(lang);
        this.render();
      });
      chips.append(chip);
    }
    content.append(chips);

    if (s.error) {
      content.append(el('div', 'muted', `Lookup failed: ${s.error}`));
    }

    // Internal dictionary
    for (const entry of s.lookup?.entries ?? []) {
      const defs = this.entryDefs(entry).filter((d) => this.selected.has(d.lang));
      if (defs.length === 0 && (s.lookup?.entries.length ?? 0) > 1) continue; // hide empty extras
      const grp = el('div', 'grp');
      const head = el('div');
      head.append(el('span', 'head', entry.headword));
      if (entry.pos) head.append(el('span', 'pos', entry.pos.toLowerCase()));
      grp.append(head);
      if (defs.length === 0) grp.append(el('div', 'muted', '(no built-in translation)'));
      for (const d of defs) grp.append(el('div', 'def', d.body));
      content.append(grp);
    }

    // External reference dictionaries, grouped by label
    const refByLabel = new Map<string, ReferenceEntry[]>();
    for (const r of s.reference) {
      if (!this.selected.has(referenceSourceLang(r.source))) continue;
      (refByLabel.get(r.label) ?? refByLabel.set(r.label, []).get(r.label)!).push(r);
    }
    for (const [label, entries] of refByLabel) {
      const grp = el('div', 'grp');
      grp.append(el('div', 'grp-label', label));
      for (const r of entries) {
        grp.append(el('div', 'def', r.definition));
        for (const ex of r.examples.slice(0, 2)) grp.append(el('div', 'ex', ex));
      }
      content.append(grp);
    }

    if (s.refState === 'loading') content.append(el('div', 'muted', 'Loading dictionaries…'));
    else if (s.refState === 'error') content.append(el('div', 'muted', 'External dictionaries unavailable.'));

    this.paint(content);
  }

  /** Displayable definitions for an internal entry, tagged with language. */
  private entryDefs(entry: ExportedLemma): { body: string; lang: DefinitionLang }[] {
    const out: { body: string; lang: DefinitionLang }[] = [];
    const seen = new Set<string>();
    for (const t of entry.translations) {
      const lang = (t.lang === 'es' ? 'es' : t.lang === 'eu' ? 'eu' : 'en') as DefinitionLang;
      if (!seen.has(t.body)) {
        seen.add(t.body);
        out.push({ body: t.body, lang });
      }
    }
    if (entry.gloss && !seen.has(entry.gloss)) out.push({ body: entry.gloss, lang: 'en' });
    return out;
  }

  private paint(content: HTMLElement): void {
    if (!this.popup) {
      this.popup = el('div', 'popup');
      this.popup.addEventListener('mouseenter', () => {
        if (this.closeTimer) {
          clearTimeout(this.closeTimer);
          this.closeTimer = null;
        }
      });
      this.popup.addEventListener('mouseleave', () => this.scheduleClose());
      this.root.append(this.popup);
    }
    this.popup.replaceChildren(content);
    this.position();
  }

  private position(): void {
    if (!this.popup || !this.anchor) return;
    const a = this.anchor.getBoundingClientRect();
    const pw = this.popup.offsetWidth;
    const ph = this.popup.offsetHeight;
    const margin = 8;
    let left = a.left + a.width / 2 - pw / 2;
    left = Math.max(margin, Math.min(left, window.innerWidth - pw - margin));
    let top = a.top - ph - 10;
    if (top < margin) top = a.bottom + 10;
    this.popup.style.left = `${left}px`;
    this.popup.style.top = `${top}px`;
  }
}
