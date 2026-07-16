import { describe, expect, it } from 'vitest';

import { pickEuskaraSubtitleButton, type MenuColumn } from './subtitle-menu';

let nextId = 0;
function btn(label: string, pressed = false) {
  nextId += 1;
  return { label, pressed, el: `${label}#${nextId}` };
}

function panel(subtitleLabels: string[], enabled?: string): MenuColumn<string>[] {
  return [
    {
      title: 'Azpidatziak',
      buttons: subtitleLabels.map((l) => btn(l, l === enabled)),
    },
    { title: 'Audioak', buttons: [btn('Euskara', true)] },
  ];
}

describe('pickEuskaraSubtitleButton', () => {
  it('picks Euskara when it is the only subtitle track', () => {
    const columns = panel(['Ez', 'Euskara']);
    expect(pickEuskaraSubtitleButton(columns)?.el).toBe(columns[0]!.buttons[1]!.el);
  });

  it('picks Euskara (not the 2nd option) when several tracks exist', () => {
    // Real menu from an episode with four tracks: the old positional lookup
    // landed on "Ingelesa" here.
    const columns = panel(['Ez', 'Ingelesa', 'Gaztelania', 'Frantsesa', 'Euskara']);
    expect(pickEuskaraSubtitleButton(columns)?.label).toBe('Euskara');
    expect(pickEuskaraSubtitleButton(columns)?.el).toBe(columns[0]!.buttons[4]!.el);
  });

  it('never picks the audio column Euskara when the subtitles column has one', () => {
    const columns = panel(['Ez', 'Ingelesa', 'Euskara']);
    const picked = pickEuskaraSubtitleButton(columns);
    expect(picked?.el).toBe(columns[0]!.buttons[2]!.el);
    expect(picked?.el).not.toBe(columns[1]!.buttons[0]!.el);
  });

  it('still finds Euskara when it is already enabled (pressed)', () => {
    const columns = panel(['Ez', 'Ingelesa', 'Euskara'], 'Euskara');
    expect(pickEuskaraSubtitleButton(columns)?.el).toBe(columns[0]!.buttons[2]!.el);
  });

  it('returns null when there is no Basque subtitle track', () => {
    expect(pickEuskaraSubtitleButton(panel(['Ez', 'Ingelesa', 'Gaztelania']))).toBeNull();
  });

  it('falls back to an unpressed Euskara button when no subtitles column is recognized', () => {
    const columns: MenuColumn<string>[] = [
      { title: '', buttons: [btn('Euskara', true), btn('Ez'), btn('Ingelesa'), btn('Euskara')] },
    ];
    const picked = pickEuskaraSubtitleButton(columns);
    expect(picked?.label).toBe('Euskara');
    expect(picked?.pressed).toBe(false);
  });

  it('fallback returns null when the only Euskara button is already pressed (audio)', () => {
    const columns: MenuColumn<string>[] = [{ title: '', buttons: [btn('Euskara', true), btn('Ez')] }];
    expect(pickEuskaraSubtitleButton(columns)).toBeNull();
  });
});
