import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { activateFocusTrap, focusableDescendants } from './focus-trap.js';

function build(html: string): HTMLDivElement {
  const root = document.createElement('div');
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('focusableDescendants', () => {
  it('finds buttons, links, inputs, selects, textareas, and tabindexable elements', () => {
    const root = build(`
      <a href="#a">a</a>
      <button>b</button>
      <input />
      <select><option>x</option></select>
      <textarea></textarea>
      <div tabindex="0">d</div>
    `);
    expect(focusableDescendants(root)).toHaveLength(6);
  });

  it('skips disabled controls and tabindex=-1 elements', () => {
    const root = build(`
      <button disabled>b</button>
      <input disabled />
      <div tabindex="-1">d</div>
      <button>ok</button>
    `);
    const els = focusableDescendants(root);
    expect(els).toHaveLength(1);
    expect(els[0]!.textContent).toBe('ok');
  });
});

describe('activateFocusTrap', () => {
  let outsideButton: HTMLButtonElement;
  let trapRoot: HTMLDivElement;

  beforeEach(() => {
    document.body.innerHTML = `
      <button id="outside">outside</button>
      <div id="trap">
        <button id="first">first</button>
        <input id="middle" />
        <button id="last">last</button>
      </div>
    `;
    outsideButton = document.getElementById('outside') as HTMLButtonElement;
    trapRoot = document.getElementById('trap') as HTMLDivElement;
  });

  it('focuses the first descendant on activate', () => {
    outsideButton.focus();
    activateFocusTrap(trapRoot);
    expect(document.activeElement?.id).toBe('first');
  });

  it('cycles to the first element when Tab is pressed on the last', () => {
    activateFocusTrap(trapRoot);
    const last = document.getElementById('last') as HTMLButtonElement;
    last.focus();
    const event = new KeyboardEvent('keydown', { key: 'Tab', cancelable: true });
    document.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement?.id).toBe('first');
  });

  it('cycles to the last element when Shift+Tab is pressed on the first', () => {
    activateFocusTrap(trapRoot);
    const first = document.getElementById('first') as HTMLButtonElement;
    first.focus();
    const event = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      cancelable: true,
    });
    document.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement?.id).toBe('last');
  });

  it('restores focus to the previously-focused element on deactivate', () => {
    outsideButton.focus();
    expect(document.activeElement?.id).toBe('outside');
    const trap = activateFocusTrap(trapRoot);
    expect(document.activeElement?.id).toBe('first');
    trap.deactivate();
    expect(document.activeElement?.id).toBe('outside');
  });
});
