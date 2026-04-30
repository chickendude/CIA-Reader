// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  MOBILE_RESPONSE_BUDGET_BYTES,
  jsonPayloadBytes,
  withinMobileResponseBudget,
} from './payload-budget.js';

describe('mobile payload budget helpers', () => {
  it('measures JSON payload bytes with utf-8 encoding', () => {
    expect(jsonPayloadBytes({ text: 'पाठ' })).toBeGreaterThan(
      JSON.stringify({ text: 'पाठ' }).length,
    );
  });

  it('guards the 100KB mobile response budget', () => {
    expect(withinMobileResponseBudget({ body: 'x'.repeat(1024) })).toBe(true);
    expect(
      withinMobileResponseBudget({
        body: 'x'.repeat(MOBILE_RESPONSE_BUDGET_BYTES + 1),
      }),
    ).toBe(false);
  });
});
