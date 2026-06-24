/**
 * The on-page UI: a caption bar with clickable words (rendered in a shadow root
 * so Primeran's CSS can't leak in) and a definition popup. Lookups are performed
 * by an injected callback (the content script wires it to the background LOOKUP
 * message), keeping this module free of extension-API coupling.
 */
import type { LookupResult } from '../shared/lookup';
import { splitCueWords } from './tokenize';

type LookupFn = (surface: string) => Promise<LookupResult>;
type Hooks = { onOpen?: () => void; onClose?: () => void };

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
  position: fixed; z-index: 2147483001; width: 360px; max-width: 92vw; max-height: 60vh;
  overflow: auto; background: #1d1f23; color: #e8e8e8; border: 1px solid #3a3d44;
  border-radius: 12px; padding: 12px 14px; box-shadow: 0 10px 34px rgba(0,0,0,0.55);
  font: 14px/1.45 system-ui, -apple-system, sans-serif; pointer-events: auto;
}
.popup .hd { display: flex; align-items: baseline; gap: 8px; }
.popup h2 { margin: 0; font-size: 18px; }
.popup .lemma { color: #8ab4ff; font-size: 13px; }
.popup .x { margin-left: auto; cursor: pointer; color: #9aa; font-size: 18px; line-height: 1; }
.popup .entry { margin-top: 8px; padding-top: 8px; border-top: 1px solid #2e3138; }
.popup .head { font-weight: 600; }
.popup .pos { color: #8fce8f; font-size: 12px; margin-left: 6px; }
.popup .tr { margin: 3px 0; }
.popup .src { color: #888; font-size: 11px; margin-left: 6px; }
.popup .ex { color: #b9b9b9; font-style: italic; font-size: 13px; margin: 2px 0 2px 8px; }
.popup .muted { color: #9a9a9a; }
.popup .links { margin-top: 10px; padding-top: 8px; border-top: 1px solid #2e3138; }
.popup .links a { color: #7cc0ff; text-decoration: none; margin-right: 12px; white-space: nowrap; }
.popup .links a:hover { text-decoration: underline; }
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

export class Overlay {
  private host: HTMLElement;
  private root: ShadowRoot;
  private bar: HTMLElement;
  private cueEl: HTMLElement;
  private popup: HTMLElement | null = null;

  constructor(
    private lookup: LookupFn,
    private hooks: Hooks = {},
  ) {
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
      if (e.key === 'Escape') this.closePopup();
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
        span.addEventListener('click', (e) => {
          e.stopPropagation();
          void this.onWordClick(part.text, span);
        });
        this.cueEl.append(span);
      } else {
        this.cueEl.append(document.createTextNode(part.text));
      }
    }
    this.bar.style.display = '';
  }

  private async onWordClick(surface: string, anchor: HTMLElement): Promise<void> {
    this.hooks.onOpen?.();
    this.openPopup(anchor, el('div', 'muted', `Looking up “${surface}”…`));
    try {
      const result = await this.lookup(surface);
      this.openPopup(anchor, this.renderResult(result));
    } catch (e) {
      this.openPopup(
        anchor,
        el('div', 'muted', `Lookup failed: ${e instanceof Error ? e.message : String(e)}`),
      );
    }
  }

  private renderResult(r: LookupResult): HTMLElement {
    const frag = el('div');

    const hd = el('div', 'hd');
    hd.append(el('h2', undefined, r.surface));
    if (r.lemmas.length && r.lemmas[0] !== r.surface) {
      hd.append(el('span', 'lemma', `→ ${r.lemmas.join(', ')}`));
    }
    const close = el('span', 'x', '×');
    close.addEventListener('click', () => this.closePopup());
    hd.append(close);
    frag.append(hd);

    if (r.entries.length === 0 && r.reference.length === 0) {
      frag.append(el('div', 'muted', 'No built-in entry — try the external dictionaries below.'));
    }

    for (const entry of r.entries) {
      const e = el('div', 'entry');
      const head = el('div');
      head.append(el('span', 'head', entry.headword));
      if (entry.pos) head.append(el('span', 'pos', entry.pos.toLowerCase()));
      e.append(head);
      const defs = entry.translations.length
        ? entry.translations.map((t) => ({ body: t.body, tag: t.kind }))
        : entry.gloss
          ? [{ body: entry.gloss, tag: 'dictionary' }]
          : [];
      if (defs.length === 0) {
        e.append(el('div', 'muted', '(no translation in the built-in dictionary)'));
      }
      for (const d of defs) {
        const tr = el('div', 'tr', d.body);
        tr.append(el('span', 'src', d.tag));
        e.append(tr);
      }
      frag.append(e);
    }

    for (const ref of r.reference) {
      const e = el('div', 'entry');
      const head = el('div');
      head.append(el('span', 'head', ref.headword || r.surface));
      if (ref.pos) head.append(el('span', 'pos', ref.pos));
      head.append(el('span', 'src', ref.label));
      e.append(head);
      if (ref.definition) e.append(el('div', 'tr', ref.definition));
      for (const ex of ref.examples) e.append(el('div', 'ex', ex));
      frag.append(e);
    }

    if (r.links.length) {
      const links = el('div', 'links');
      for (const link of r.links) {
        const a = el('a', undefined, link.label);
        a.href = link.url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        links.append(a);
      }
      frag.append(links);
    }

    return frag;
  }

  private openPopup(anchor: HTMLElement, content: HTMLElement): void {
    this.removePopup();
    const popup = el('div', 'popup');
    popup.append(content);
    this.root.append(popup);
    this.popup = popup;

    // Position above the clicked word, clamped to the viewport.
    const a = anchor.getBoundingClientRect();
    const pw = popup.offsetWidth;
    const ph = popup.offsetHeight;
    const margin = 8;
    let left = a.left + a.width / 2 - pw / 2;
    left = Math.max(margin, Math.min(left, window.innerWidth - pw - margin));
    let top = a.top - ph - 10;
    if (top < margin) top = a.bottom + 10; // flip below if no room above
    popup.style.left = `${left}px`;
    popup.style.top = `${top}px`;
  }

  private removePopup(): void {
    this.popup?.remove();
    this.popup = null;
  }

  closePopup(): void {
    if (!this.popup) return;
    this.removePopup();
    this.hooks.onClose?.();
  }
}
