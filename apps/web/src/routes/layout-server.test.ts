// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { load } from './+layout.server.js';

type LoadEvent = Parameters<typeof load>[0];

describe('root +layout.server.ts load', () => {
  it('returns a null user when nobody is signed in', async () => {
    const data = await load({ locals: {} } as unknown as LoadEvent);
    expect(data).toEqual({ user: null });
  });

  it('serializes only the four public user fields when signed in', async () => {
    const data = await load({
      locals: {
        user: {
          id: 'u1',
          email: 'a@b.c',
          displayName: 'Alex',
          role: 'user',
          // Fields that must NOT leak via the layout loader — these live on
          // the full User type but are not safe to send to every page.
          passwordHash: 'secret',
          themePreference: 'dark',
        },
      },
    } as unknown as LoadEvent);
    if (!data) throw new Error('load returned void');
    expect(data.user).toEqual({
      id: 'u1',
      email: 'a@b.c',
      displayName: 'Alex',
      role: 'user',
    });
  });
});
