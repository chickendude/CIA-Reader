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
  /** Called when a word popup opens / fully closes (e.g. pause-on-lookup). */
  onOpen?: () => void;
  onClose?: () => void;
  /** Episode occurrence count for a lemma (resolves async; 0 if none/unknown). */
  frequency?: (lemma: string) => Promise<number>;
};

type RefState = 'idle' | 'loading' | 'done' | 'error';
type PopupState = {
  surface: string;
  lookup: LookupResult | null;
  reference: ReferenceEntry[];
  refState: RefState;
  error: string | null;
  frequency: number | null;
};

const STYLE = `
:host { all: initial; }
* { box-sizing: border-box; }
.bar {
  position: fixed; left: 50%; bottom: 13%; transform: translateX(-50%);
  max-width: 84vw; z-index: 2147483000; text-align: center; pointer-events: none;
  font-family: system-ui, -apple-system, sans-serif;
}
.cue {
  display: inline-block; background: rgba(0,0,0,0.8); color: #fff;
  padding: 6px 14px; border-radius: 10px; font-size: 26px; line-height: 1.4;
  /* none on the box so the seek bar / controls underneath stay clickable; only
     the words re-enable pointer events. */
  pointer-events: none; white-space: pre-wrap;
}
.w { cursor: pointer; border-radius: 4px; padding: 0 1px; transition: background 60ms; pointer-events: auto; }
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
.popup .freq { color: #d6b25e; font-size: 12px; margin-top: 2px; }
.popup .x { margin-left: auto; cursor: pointer; color: #9aa; font-size: 18px; line-height: 1; }
.popup .tabs { display: flex; gap: 2px; margin: 10px 0 2px; border-bottom: 1px solid #2e3138; }
.popup .tab {
  cursor: pointer; font-size: 12px; font-weight: 700; padding: 5px 13px; color: #9aa;
  user-select: none; border-bottom: 2px solid transparent; margin-bottom: -1px;
}
.popup .tab.on { color: #fff; border-bottom-color: #4a90e2; }
.popup .grp { margin-top: 8px; padding-top: 8px; border-top: 1px solid #2e3138; }
.popup .grp-label { color: #9fb; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; margin-bottom: 3px; }
.popup .head { font-weight: 600; }
.popup .pos { color: #8fce8f; font-size: 12px; margin-left: 6px; }
.popup .def { margin: 2px 0; }
.popup .pill {
  display: inline-block; font-size: 9px; font-weight: 600; letter-spacing: .02em; line-height: 1.6;
  padding: 0 5px; border-radius: 3px; background: #2a2d33; color: #7e858f;
  margin-right: 7px; vertical-align: middle;
}
.popup .more {
  display: inline-block; cursor: pointer; font-weight: 700; font-size: 12px; line-height: 1.3;
  color: #7cc0ff; border: 1px solid #3a6ea5; border-radius: 999px; padding: 0 7px; margin-left: 8px;
}
.popup .more:hover { background: #2b6cb0; color: #fff; }
.popup .muted { color: #9a9a9a; font-size: 13px; }
.tooltip {
  position: fixed; z-index: 2147483002; max-width: 340px; background: #15171a; color: #ddd;
  border: 1px solid #444; border-radius: 8px; padding: 8px 11px; pointer-events: auto;
  font: 13px/1.45 system-ui, -apple-system, sans-serif; box-shadow: 0 8px 26px rgba(0,0,0,0.6);
}
.tooltip .ex { font-style: italic; margin: 3px 0; color: #d2d2d2; }
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
  private exTip: HTMLElement | null = null;
  private exTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingCue: { text: string | null } | null = null;
  private anchor: HTMLElement | null = null;
  private state: PopupState | null = null;
  /** The tab the user last picked — the default for the next word. */
  private selectedLang: DefinitionLang = 'en';
  /** The tab actually shown (falls back to the first with content). */
  private displayLang: DefinitionLang = 'en';

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

    // Capture phase + stopImmediatePropagation so Escape only closes our popup
    // and doesn't also reach Primeran (which would exit the player/page). When
    // no popup is open we leave Escape alone (fullscreen exit etc. still work).
    document.addEventListener(
      'keydown',
      (e) => {
        if (e.key === 'Escape' && this.popup) {
          e.stopImmediatePropagation();
          e.preventDefault();
          this.close();
        }
      },
      true,
    );
  }

  setCue(text: string | null): void {
    // While a popup is open (or about to open) freeze the caption so the word
    // under the cursor isn't rebuilt out from under the user; buffer the latest
    // subtitle and apply it once the popup closes.
    if (this.popup || this.openTimer) {
      this.pendingCue = { text };
      return;
    }
    this.renderCue(text);
  }

  private renderCue(text: string | null): void {
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

  private flushPending(): void {
    if (this.pendingCue && !this.popup && !this.openTimer) {
      const { text } = this.pendingCue;
      this.pendingCue = null;
      this.renderCue(text);
    }
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
    this.flushPending(); // a pending-open that never opened unfreezes the caption
  }

  private close(): void {
    if (this.openTimer) clearTimeout(this.openTimer);
    if (this.closeTimer) clearTimeout(this.closeTimer);
    this.openTimer = this.closeTimer = null;
    this.hideExamples();
    this.popup?.remove();
    this.popup = null;
    this.state = null;
    this.anchor = null;
    this.deps.onClose?.();
    this.flushPending(); // apply the most recent subtitle now that we're unfrozen
  }

  // ---- example-sentence tooltip (Elhuyar/Euskaltzaindia) ----

  private showExamples(anchor: HTMLElement, examples: string[]): void {
    if (this.exTimer) clearTimeout(this.exTimer);
    this.hideExamples();
    const tip = el('div', 'tooltip');
    for (const ex of examples) tip.append(el('div', 'ex', ex));
    tip.addEventListener('mouseenter', () => {
      if (this.exTimer) clearTimeout(this.exTimer);
      if (this.closeTimer) clearTimeout(this.closeTimer); // keep the popup open too
    });
    tip.addEventListener('mouseleave', () => {
      this.scheduleHideExamples();
      this.scheduleClose();
    });
    this.root.append(tip);
    this.exTip = tip;

    const a = anchor.getBoundingClientRect();
    const left = Math.min(a.left, window.innerWidth - tip.offsetWidth - 8);
    let top = a.bottom + 6;
    if (top + tip.offsetHeight > window.innerHeight) top = a.top - tip.offsetHeight - 6;
    tip.style.left = `${Math.max(8, left)}px`;
    tip.style.top = `${top}px`;
  }

  private scheduleHideExamples(): void {
    if (this.exTimer) clearTimeout(this.exTimer);
    this.exTimer = setTimeout(() => this.hideExamples(), 200);
  }

  private hideExamples(): void {
    if (this.exTimer) clearTimeout(this.exTimer);
    this.exTimer = null;
    this.exTip?.remove();
    this.exTip = null;
  }

  private async openFor(surface: string, anchor: HTMLElement): Promise<void> {
    this.deps.onOpen?.();
    this.anchor = anchor;
    this.displayLang = this.selectedLang; // start from the user's preferred tab
    this.state = {
      surface,
      lookup: null,
      reference: [],
      refState: 'idle',
      error: null,
      frequency: null,
    };
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

    if (this.deps.frequency) {
      void this.deps
        .frequency(word)
        .then((count) => {
          if (this.state?.surface === surface) {
            this.state.frequency = count;
            this.render();
          }
        })
        .catch(() => {});
    }

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
    this.hideExamples(); // drop any stale tooltip from a previous render
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

    if (s.frequency && s.frequency > 0) {
      content.append(el('div', 'freq', `${s.frequency}× in this episode`));
    }

    if (s.error) {
      content.append(el('div', 'muted', `Lookup failed: ${s.error}`));
    }

    // --- Internal dictionary: always shown, all languages ---
    for (const entry of s.lookup?.entries ?? []) {
      const defs = this.entryDefs(entry);
      if (defs.length === 0) continue;
      const grp = el('div', 'grp');
      const head = el('div');
      head.append(el('span', 'head', entry.headword));
      if (entry.pos) head.append(el('span', 'pos', entry.pos.toLowerCase()));
      grp.append(head);
      for (const d of defs) {
        const def = el('div', 'def');
        def.append(el('span', 'pill', d.lang.toUpperCase()));
        def.append(document.createTextNode(d.body));
        grp.append(def);
      }
      content.append(grp);
    }

    // --- External reference dictionaries: tabbed, one language at a time ---
    // The shown tab defaults to the user's pick, but falls back to the first
    // language that actually has results for this word.
    const refLangs = new Set(s.reference.map((r) => referenceSourceLang(r.source)));
    if (!refLangs.has(this.displayLang)) {
      const first = LANGS.find((l) => refLangs.has(l));
      if (first) this.displayLang = first;
    }

    const tabs = el('div', 'tabs');
    for (const lang of LANGS) {
      const tab = el('span', `tab${this.displayLang === lang ? ' on' : ''}`, lang.toUpperCase());
      tab.addEventListener('click', () => {
        this.selectedLang = lang;
        this.displayLang = lang;
        this.render();
      });
      tabs.append(tab);
    }
    content.append(tabs);

    const refByLabel = new Map<string, ReferenceEntry[]>();
    for (const r of s.reference) {
      if (referenceSourceLang(r.source) !== this.displayLang) continue;
      const list = refByLabel.get(r.label);
      if (list) list.push(r);
      else refByLabel.set(r.label, [r]);
    }
    for (const [label, entries] of refByLabel) {
      const grp = el('div', 'grp');
      grp.append(el('div', 'grp-label', label));
      for (const r of entries) {
        const def = el('div', 'def');
        def.append(document.createTextNode(r.definition));
        if (r.examples.length > 0) {
          const more = el('span', 'more', '+');
          more.title = `${r.examples.length} example${r.examples.length > 1 ? 's' : ''}`;
          more.addEventListener('mouseenter', () => this.showExamples(more, r.examples));
          more.addEventListener('mouseleave', () => this.scheduleHideExamples());
          def.append(more);
        }
        grp.append(def);
      }
      content.append(grp);
    }

    if (s.refState === 'loading') content.append(el('div', 'muted', 'Loading dictionaries…'));
    else if (refByLabel.size === 0)
      content.append(el('div', 'muted', `No ${this.displayLang.toUpperCase()} dictionary entry.`));

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
