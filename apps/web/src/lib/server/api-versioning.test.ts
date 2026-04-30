// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  API_DEPRECATION_HEADER,
  buildApiDeprecationHeaders,
  isStableApiPath,
  minimumDeprecationSunsetDate,
} from './api-versioning.js';

describe('API versioning policy', () => {
  it('treats only /api/v1 paths as stable public API paths', () => {
    expect(isStableApiPath('/api/v1')).toBe(true);
    expect(isStableApiPath('/api/v1/texts')).toBe(true);
    expect(isStableApiPath('/api/v10/texts')).toBe(false);
    expect(isStableApiPath('/api/openapi.json')).toBe(false);
  });

  it('calculates the six-month minimum support date', () => {
    expect(minimumDeprecationSunsetDate('2026-04-30')).toBe('2026-10-30');
    expect(minimumDeprecationSunsetDate('2026-08-31')).toBe('2027-02-28');
  });

  it('builds API-Deprecation headers for deprecated v1 endpoints', () => {
    const headers = buildApiDeprecationHeaders({
      since: '2026-04-30',
      sunset: '2026-10-30',
      replacement: '/api/v2/texts',
      message: 'Use the v2 text payload shape.',
    });

    expect(headers[API_DEPRECATION_HEADER]).toContain('deprecated');
    expect(headers[API_DEPRECATION_HEADER]).toContain('since="2026-04-30"');
    expect(headers[API_DEPRECATION_HEADER]).toContain('sunset="2026-10-30"');
    expect(headers[API_DEPRECATION_HEADER]).toContain(
      'replacement="/api/v2/texts"',
    );
    expect(headers.Sunset).toBe('Fri, 30 Oct 2026 23:59:59 GMT');
    expect(headers.Link).toBe('</api/v2/texts>; rel="successor-version"');
  });

  it('rejects deprecation windows shorter than six months', () => {
    expect(() =>
      buildApiDeprecationHeaders({
        since: '2026-04-30',
        sunset: '2026-10-29',
      }),
    ).toThrow('at least 2026-10-30');
  });
});
