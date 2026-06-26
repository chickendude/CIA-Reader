import { describe, expect, it } from 'vitest';

import { activeCueAt, parseWebVtt } from './subtitles';

// A slice of a real Primeran episode VTT (with <c.white> tags + a two-line cue).
const SAMPLE = `WEBVTT

1
00:00:05.560 --> 00:00:10.480
<c.white>(Musika)</c>

2
00:00:42.000 --> 00:00:44.960
<c.white>Heldu gara azkenean.</c>
<c.white>Usaintzen al duzue?</c>

3
00:00:46.000 --> 00:00:47.960
<c.white>Aire garbia. Ze gozada.</c>
`;

describe('parseWebVtt', () => {
  const cues = parseWebVtt(SAMPLE);

  it('parses every cue, skipping the WEBVTT header', () => {
    expect(cues).toHaveLength(3);
  });

  it('parses timestamps to milliseconds', () => {
    expect(cues[0]).toMatchObject({ startMs: 5560, endMs: 10480 });
    expect(cues[1]!.startMs).toBe(42000);
  });

  it('strips <c.white> tags', () => {
    expect(cues[0]!.text).toBe('(Musika)');
  });

  it('joins a multi-line cue into one sentence string', () => {
    expect(cues[1]!.text).toBe('Heldu gara azkenean. Usaintzen al duzue?');
  });

  it('tolerates CRLF line endings and trailing settings', () => {
    const cues2 = parseWebVtt('WEBVTT\r\n\r\n1\r\n00:00:01.000 --> 00:00:02.000 line:90%\r\n<c>Kaixo</c>\r\n');
    expect(cues2).toEqual([{ startMs: 1000, endMs: 2000, text: 'Kaixo' }]);
  });
});

describe('activeCueAt', () => {
  const cues = parseWebVtt(SAMPLE);

  it('returns the cue whose window contains the time', () => {
    expect(activeCueAt(cues, 43000)?.text).toContain('Heldu gara');
  });

  it('returns null in a gap between cues', () => {
    expect(activeCueAt(cues, 20000)).toBeNull();
  });
});
