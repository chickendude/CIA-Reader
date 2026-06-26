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
import { splitCueWords } from '../shared/tokenize';

type Deps = {
  lookup: (surface: string) => Promise<LookupResult>;
  reference: (word: string) => Promise<ReferenceEntry[]>;
  /** Called when a word popup opens / fully closes (e.g. pause-on-lookup). */
  onOpen?: () => void;
  onClose?: () => void;
  /** Episode occurrence count for a word (resolves async; 0 if none/unknown). */
  frequency?: (lemma: string, surface: string) => Promise<number>;
  /** Add a card to Anki via AnkiConnect (the background builds the HTML). */
  addAnki?: (card: {
    front: string;
    surface: string;
    sentence: string | null;
    defs: { body: string; lang: DefinitionLang }[];
  }) => Promise<{ added: boolean; duplicate: boolean; note?: string }>;
  /** Whether a card for this word already exists in Anki. */
  ankiHas?: (front: string) => Promise<boolean>;
};

type RefState = 'idle' | 'loading' | 'done' | 'error';
type PopupState = {
  surface: string;
  lookup: LookupResult | null;
  reference: ReferenceEntry[];
  refState: RefState;
  error: string | null;
  frequency: number | null;
  inAnki: boolean;
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
.popup .freq { color: #d6b25e; font-size: 13px; font-weight: 600; }
.popup .inanki { color: #4bbd7a; font-size: 12px; font-weight: 600; }
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
.popup .footer { margin-top: 10px; padding-top: 9px; border-top: 1px solid #2e3138; display: flex; align-items: center; gap: 10px; }
.popup .anki { font: inherit; font-size: 13px; cursor: pointer; background: #2b6cb0; color: #fff; border: none; border-radius: 6px; padding: 5px 12px; }
.popup .anki:hover { background: #3a7bc8; }
.popup .anki:disabled { opacity: .6; cursor: default; }
.popup .anki-status { color: #9a9a9a; font-size: 12px; }
.toolbar { position: fixed; left: 50%; top: 14px; transform: translateX(-50%);
  z-index: 2147482999; display: flex; gap: 3px; background: rgba(0,0,0,.6); border-radius: 9px;
  padding: 4px; pointer-events: auto; opacity: .4; transition: opacity .15s;
  font-family: system-ui, -apple-system, sans-serif; }
.toolbar:hover { opacity: 1; }
.tbtn { cursor: pointer; color: #fff; background: transparent; border: none; font-size: 15px;
  line-height: 1; padding: 5px 9px; border-radius: 6px; }
.tbtn:hover { background: rgba(255,255,255,.18); }
.tbtn.on { background: #1f9c57; }
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
  /** The subtitle line currently shown — captured for Anki cards. */
  private currentSentence: string | null = null;
  private toolbar: HTMLElement | null = null;
  private autoPauseBtn: HTMLButtonElement | null = null;
  private listeningBtn: HTMLButtonElement | null = null;
  private captionHidden = false;
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

  /** Show the playback-controls toolbar (repeat / prev / next / auto-pause). */
  enableControls(h: {
    repeat: () => void;
    prev: () => void;
    next: () => void;
    toggleAutoPause: () => void;
    toggleListening: () => void;
    enableSubtitles: () => void;
  }): void {
    if (this.toolbar) return;
    const tb = el('div', 'toolbar');
    const btn = (label: string, title: string, fn: () => void): HTMLButtonElement => {
      const b = el('button', 'tbtn', label);
      b.title = title;
      b.addEventListener('click', fn);
      return b;
    };
    tb.append(
      btn('⏮', 'Previous line (← / S)', h.prev),
      btn('↻', 'Repeat line (A)', h.repeat),
      btn('⏭', 'Next line (→ / D)', h.next),
    );
    this.autoPauseBtn = btn('⏸', 'Auto-pause at line end (W)', h.toggleAutoPause);
    this.listeningBtn = btn('🎧', 'Listening mode: hide subtitle, pause + reveal at line end (E)', h.toggleListening);
    tb.append(
      this.autoPauseBtn,
      this.listeningBtn,
      btn('💬', 'Turn on Basque subtitles', h.enableSubtitles),
    );
    this.toolbar = tb;
    this.root.append(tb);
  }

  setAutoPause(on: boolean): void {
    this.autoPauseBtn?.classList.toggle('on', on);
  }

  /** Hide/show the whole overlay (used to keep it out of card screenshots). */
  setVisible(visible: boolean): void {
    this.host.style.visibility = visible ? '' : 'hidden';
  }

  setListening(on: boolean): void {
    this.listeningBtn?.classList.toggle('on', on);
  }

  setCaptionHidden(hidden: boolean): void {
    this.captionHidden = hidden;
    this.bar.style.display = this.currentSentence && !hidden ? '' : 'none';
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
    this.currentSentence = text;
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
    this.bar.style.display = this.captionHidden ? 'none' : '';
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
      inAnki: false,
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
        .frequency(word, surface)
        .then((count) => {
          if (this.state?.surface === surface) {
            this.state.frequency = count;
            this.render();
          }
        })
        .catch(() => {});
    }

    if (this.deps.ankiHas) {
      void this.deps
        .ankiHas(word)
        .then((exists) => {
          if (this.state?.surface === surface && exists) {
            this.state.inAnki = true;
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
    if (s.frequency && s.frequency > 0) hd.append(el('span', 'freq', `${s.frequency}×`));
    if (s.inAnki) hd.append(el('span', 'inanki', '✓ in Anki'));
    const close = el('span', 'x', '×');
    close.addEventListener('click', () => this.close());
    hd.append(close);
    content.append(hd);

    if (s.error) {
      content.append(el('div', 'muted', `Lookup failed: ${s.error}`));
    }

    // Languages that have any content (internal translations or reference). The
    // shown tab defaults to the user's pick, falling back to the first language
    // that actually has something for this word.
    const langsWithContent = new Set<DefinitionLang>();
    for (const entry of s.lookup?.entries ?? []) {
      for (const d of this.entryDefs(entry)) langsWithContent.add(d.lang);
    }
    for (const r of s.reference) langsWithContent.add(referenceSourceLang(r.source));
    if (!langsWithContent.has(this.displayLang)) {
      const first = LANGS.find((l) => langsWithContent.has(l));
      if (first) this.displayLang = first;
    }
    const lang = this.displayLang;

    // Tabs drive BOTH internal and external definitions (the tab is the language
    // label, so individual lines don't repeat it).
    const tabs = el('div', 'tabs');
    for (const l of LANGS) {
      const tab = el('span', `tab${lang === l ? ' on' : ''}`, l.toUpperCase());
      tab.addEventListener('click', () => {
        this.selectedLang = l;
        this.displayLang = l;
        this.render();
      });
      tabs.append(tab);
    }
    content.append(tabs);

    let shown = 0;

    // Internal dictionary, filtered to the selected language (no per-line pill).
    for (const entry of s.lookup?.entries ?? []) {
      const defs = this.entryDefs(entry).filter((d) => d.lang === lang);
      if (defs.length === 0) continue;
      const grp = el('div', 'grp');
      const head = el('div');
      head.append(el('span', 'head', entry.headword));
      if (entry.pos) head.append(el('span', 'pos', entry.pos.toLowerCase()));
      grp.append(head);
      for (const d of defs) grp.append(el('div', 'def', d.body));
      content.append(grp);
      shown += 1;
    }

    // External reference dictionaries for the selected language.
    const refByLabel = new Map<string, ReferenceEntry[]>();
    for (const r of s.reference) {
      if (referenceSourceLang(r.source) !== lang) continue;
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
      shown += 1;
    }

    if (s.refState === 'loading') content.append(el('div', 'muted', 'Loading dictionaries…'));
    else if (shown === 0) content.append(el('div', 'muted', `No ${lang.toUpperCase()} definitions.`));

    if (this.deps.addAnki && s.lookup) {
      const footer = el('div', 'footer');
      const btn = el('button', 'anki', s.inAnki ? 'Add to Anki again' : 'Add to Anki');
      const status = el('span', 'anki-status');
      btn.addEventListener('click', () => void this.addToAnki(btn, status));
      footer.append(btn, status);
      content.append(footer);
    }

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

  // ---- Anki ----

  private buildCard(): {
    front: string;
    surface: string;
    sentence: string | null;
    defs: { body: string; lang: DefinitionLang }[];
  } | null {
    const s = this.state;
    if (!s) return null;
    const front = s.lookup?.lemmas[0] ?? s.surface;

    const defs: { body: string; lang: DefinitionLang }[] = [];
    const seen = new Set<string>();
    for (const entry of s.lookup?.entries ?? []) {
      for (const d of this.entryDefs(entry)) {
        if (!seen.has(d.body)) {
          seen.add(d.body);
          defs.push(d);
        }
      }
    }
    for (const r of s.reference) {
      if (referenceSourceLang(r.source) === this.displayLang && !seen.has(r.definition)) {
        seen.add(r.definition);
        defs.push({ body: r.definition, lang: this.displayLang });
      }
    }

    return { front, surface: s.surface, sentence: this.currentSentence, defs };
  }

  private async addToAnki(btn: HTMLButtonElement, status: HTMLElement): Promise<void> {
    const card = this.buildCard();
    if (!card || !this.deps.addAnki) return;
    btn.disabled = true;
    status.textContent = 'Adding…';
    try {
      const r = await this.deps.addAnki(card);
      if (r.added || r.duplicate) {
        btn.textContent = r.added ? 'Added ✓' : 'Already in deck';
        if (this.state) this.state.inAnki = true;
      }
      status.textContent = r.note ?? '';
    } catch (e) {
      status.textContent = e instanceof Error ? e.message : String(e);
    } finally {
      btn.disabled = false;
    }
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
