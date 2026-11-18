import type { ServerToken } from './types.js';

export interface WordTarget {
  token: ServerToken;
  el: HTMLElement;
}

export class WordPreview {
  token = $state.raw<ServerToken | null>(null);
  rect = $state.raw<DOMRect | null>(null);
  private tappedWord = $state.raw<HTMLElement | null>(null);
  private pointerType = '';

  constructor() {
    $effect(() => {
      const word = this.tappedWord;
      if (!word) return;
      const outside = (event: PointerEvent) => {
        const target = event.target;
        if (target instanceof Element && !word.contains(target) && !target.closest('[role="tooltip"]')) {
          this.close();
        }
      };
      const onScroll = (event: Event) => {
        if (!(event.target instanceof Element && event.target.closest('[role="tooltip"]'))) this.close();
      };
      document.addEventListener('pointerdown', outside, true);
      document.addEventListener('scroll', onScroll, true);
      return () => {
        document.removeEventListener('pointerdown', outside, true);
        document.removeEventListener('scroll', onScroll, true);
      };
    });
  }

  rememberPointer = (event: PointerEvent) => {
    this.pointerType = event.pointerType;
  };

  show(found: WordTarget) {
    this.token = found.token;
    this.rect = found.el.getBoundingClientRect();
  }

  // Some mobile browsers deliver the click as a MouseEvent.
  firstTap(event: MouseEvent, found: WordTarget) {
    const pointer = (event as PointerEvent).pointerType || (event.detail ? this.pointerType : '');
    if (pointer !== 'touch' || this.tappedWord === found.el) return false;
    this.tappedWord = found.el;
    this.show(found);
    return true;
  }

  close = () => {
    this.tappedWord = null;
    this.token = null;
    this.rect = null;
  };
}
