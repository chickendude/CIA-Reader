// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const completeOnboarding = vi.fn();

vi.mock('$lib/server/onboarding.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    completeOnboarding: (...a: unknown[]) => completeOnboarding(...a),
  };
});

type LoadFn = (typeof import('./+page.server.js'))['load'];
type LoadEvent = Parameters<LoadFn>[0];
type ActionsModule = (typeof import('./+page.server.js'))['actions'];
type ActionFn = NonNullable<ActionsModule[keyof ActionsModule]>;
type ActionEvent = Parameters<ActionFn>[0];

function formEvent(fields: Record<string, string>, locals: Record<string, unknown> = {}) {
  const body = new URLSearchParams(fields);
  return {
    request: new Request('http://x/onboarding', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    }),
    locals,
    url: new URL('http://x/onboarding'),
  } as unknown as ActionEvent;
}

async function loadDefaultAction() {
  const mod = await import('./+page.server.js');
  return mod.actions.default as ActionFn;
}

describe('onboarding +page.server.ts', () => {
  beforeEach(() => {
    completeOnboarding.mockReset();
  });

  afterEach(() => {
    vi.resetModules();
  });

  describe('load', () => {
    it('redirects to /login when unauthenticated', async () => {
      const { load } = await import('./+page.server.js');
      expect(() =>
        load({
          locals: {},
          url: new URL('http://x/onboarding'),
        } as unknown as LoadEvent),
      ).toThrow(expect.objectContaining({ status: 303 }));
    });

    it('redirects already-onboarded users away from the onboarding page', async () => {
      const { load } = await import('./+page.server.js');
      expect(() =>
        load({
          locals: { user: { id: 'u1', onboardedAt: new Date() } },
          url: new URL('http://x/onboarding'),
        } as unknown as LoadEvent),
      ).toThrow(expect.objectContaining({ status: 303 }));
    });

    it('returns the full language list + baseline options for first-time users', async () => {
      const { load } = await import('./+page.server.js');
      const data = await load({
        locals: { user: { id: 'u1', onboardedAt: null } },
        url: new URL('http://x/onboarding'),
      } as unknown as LoadEvent);
      if (!data) throw new Error('load returned void');
      expect(data.languages.map((l: { code: string }) => l.code)).toEqual(
        expect.arrayContaining(['hi', 'mr', 'or']),
      );
      expect(data.baselines).toEqual(['none', 'beginner', 'intermediate']);
    });
  });

  describe('default action', () => {
    it('rejects with 401 when unauthenticated', async () => {
      const action = await loadDefaultAction();
      const result = await action(formEvent({ language: 'hi', baseline: 'none' }));
      expect(result).toMatchObject({ status: 401, data: { ok: false } });
      expect(completeOnboarding).not.toHaveBeenCalled();
    });

    it('rejects an unsupported language', async () => {
      const action = await loadDefaultAction();
      const result = await action(
        formEvent(
          { language: 'xx', baseline: 'none' },
          { user: { id: 'u1', onboardedAt: null } },
        ),
      );
      expect(result).toMatchObject({ status: 400, data: { ok: false } });
      expect(completeOnboarding).not.toHaveBeenCalled();
    });

    it('rejects an invalid baseline', async () => {
      const action = await loadDefaultAction();
      const result = await action(
        formEvent(
          { language: 'hi', baseline: 'expert' },
          { user: { id: 'u1', onboardedAt: null } },
        ),
      );
      expect(result).toMatchObject({ status: 400, data: { ok: false } });
    });

    it('commits a valid choice and redirects to /', async () => {
      completeOnboarding.mockResolvedValue({});
      const action = await loadDefaultAction();
      await expect(
        action(
          formEvent(
            { language: 'or', baseline: 'beginner' },
            { user: { id: 'u1', onboardedAt: null } },
          ),
        ),
      ).rejects.toMatchObject({ status: 303, location: '/' });
      expect(completeOnboarding).toHaveBeenCalledWith('u1', 'or', 'beginner');
    });

    it('is idempotent when a user is already onboarded (returns ok without re-upserting)', async () => {
      const action = await loadDefaultAction();
      const result = await action(
        formEvent(
          { language: 'hi', baseline: 'none' },
          { user: { id: 'u1', onboardedAt: new Date() } },
        ),
      );
      expect(result).toMatchObject({ ok: true });
      expect(completeOnboarding).not.toHaveBeenCalled();
    });
  });
});
