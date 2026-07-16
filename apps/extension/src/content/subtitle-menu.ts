/**
 * Picking the "Euskara" option in Primeran's subtitle/audio settings panel.
 *
 * The panel shows one column per setting — "Azpidatziak" (subtitles) and
 * "Audioak" (audio) — and both can offer an "Euskara" button. The subtitle
 * options vary per episode ("Ez", then any of Ingelesa / Gaztelania /
 * Frantsesa / Euskara …), so a positional XPath clicks the wrong language
 * whenever more than one subtitle track exists. Pick the button by its label,
 * scoped to the subtitles column, instead.
 */

const SUBTITLES_COLUMN_TITLE = 'Azpidatziak';
const BASQUE_LABEL = 'Euskara';

/** Structural view of the panel, so the picker is testable without a DOM. */
export type MenuButton<T = unknown> = { label: string; pressed: boolean; el: T };
export type MenuColumn<T = unknown> = { title: string; buttons: MenuButton<T>[] };

export function pickEuskaraSubtitleButton<T>(columns: MenuColumn<T>[]): MenuButton<T> | null {
  for (const column of columns) {
    if (!column.title.includes(SUBTITLES_COLUMN_TITLE)) continue;
    const btn = column.buttons.find((b) => b.label === BASQUE_LABEL);
    if (btn) return btn;
  }
  // No recognizable subtitles column (markup drift): fall back to any
  // unpressed "Euskara" button — the audio column's is already pressed.
  return (
    columns.flatMap((c) => c.buttons).find((b) => b.label === BASQUE_LABEL && !b.pressed) ?? null
  );
}

/** Read the live panel and return the "Euskara" subtitle button to click. */
export function findEuskaraSubtitleButton(root: ParentNode = document): HTMLElement | null {
  const columnEls: ParentNode[] = Array.from(root.querySelectorAll('.column'));
  // If the column wrappers are gone, treat the whole panel as one untitled
  // column so the unpressed-button fallback still applies.
  const scopes = columnEls.length > 0 ? columnEls : [root];
  const columns = scopes.map((col) => ({
    title: col.querySelector('.title')?.textContent?.trim() ?? '',
    buttons: Array.from(col.querySelectorAll('button')).map((b) => ({
      label: b.textContent?.trim() ?? '',
      pressed: b.getAttribute('aria-pressed') === 'true',
      el: b as HTMLElement,
    })),
  }));
  return pickEuskaraSubtitleButton(columns)?.el ?? null;
}
