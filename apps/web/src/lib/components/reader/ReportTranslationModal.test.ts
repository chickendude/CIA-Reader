/**
 * Component tests for ReportTranslationModal (T-11.1).
 *
 * Verifies the modal's submit flow against a stubbed fetch:
 *   - 201 → onReported({ kind: 'reported' }) + onClose
 *   - 409 → onReported({ kind: 'duplicate' }) + onClose
 *   - 429 → onReported({ kind: 'rate_limited', retryAfterSeconds })
 *   - other → form-level error message
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';

import ReportTranslationModal from './ReportTranslationModal.svelte';

beforeEach(() => {
  // Ensure the fetch global is a fresh spy each test.
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function jsonResponse(status: number, body: unknown = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('ReportTranslationModal', () => {
  it('submits with the selected reason + note and reports a 201 outcome', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse(201, { report: {} }),
    );
    const onReported = vi.fn();
    const onClose = vi.fn();
    render(ReportTranslationModal, {
      open: true,
      translationId: 'tr-1',
      onClose,
      onReported,
    });

    // Pick a non-default reason so we exercise the bind:value branch.
    const radio = document.body.querySelector(
      'input[type="radio"][value="spam"]',
    ) as HTMLInputElement;
    expect(radio).not.toBeNull();
    await fireEvent.click(radio);

    const textarea = document.body.querySelector('textarea') as HTMLTextAreaElement;
    await fireEvent.input(textarea, { target: { value: '  bad word  ' } });

    const form = document.body.querySelector(
      '[data-testid="report-translation-form"]',
    ) as HTMLFormElement;
    await fireEvent.submit(form);

    await waitFor(() => expect(onReported).toHaveBeenCalled());

    const fetchSpy = globalThis.fetch as ReturnType<typeof vi.fn>;
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/v1/translations/tr-1/report',
      expect.objectContaining({ method: 'POST' }),
    );
    const body = JSON.parse(fetchSpy.mock.calls[0]![1]!.body as string);
    expect(body).toEqual({ reason: 'spam', note: 'bad word' });

    expect(onReported).toHaveBeenCalledWith({ kind: 'reported' });
    expect(onClose).toHaveBeenCalled();
  });

  it('emits a duplicate outcome on 409', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse(409, { message: 'already reported' }),
    );
    const onReported = vi.fn();
    render(ReportTranslationModal, {
      open: true,
      translationId: 'tr-1',
      onClose: vi.fn(),
      onReported,
    });
    await fireEvent.submit(
      document.body.querySelector(
        '[data-testid="report-translation-form"]',
      ) as HTMLFormElement,
    );
    await waitFor(() => expect(onReported).toHaveBeenCalled());
    expect(onReported).toHaveBeenCalledWith({ kind: 'duplicate' });
  });

  it('emits a rate_limited outcome on 429 with retryAfterSeconds', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse(429, { retryAfterSeconds: 86400 }),
    );
    const onReported = vi.fn();
    render(ReportTranslationModal, {
      open: true,
      translationId: 'tr-1',
      onClose: vi.fn(),
      onReported,
    });
    await fireEvent.submit(
      document.body.querySelector(
        '[data-testid="report-translation-form"]',
      ) as HTMLFormElement,
    );
    await waitFor(() => expect(onReported).toHaveBeenCalled());
    expect(onReported).toHaveBeenCalledWith({
      kind: 'rate_limited',
      retryAfterSeconds: 86400,
    });
  });

  it('renders a form-level error on unexpected status', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response('Boom', { status: 500 }),
    );
    const onReported = vi.fn();
    render(ReportTranslationModal, {
      open: true,
      translationId: 'tr-1',
      onClose: vi.fn(),
      onReported,
    });
    await fireEvent.submit(
      document.body.querySelector(
        '[data-testid="report-translation-form"]',
      ) as HTMLFormElement,
    );
    await waitFor(() => {
      const el = document.body.querySelector(
        '[data-testid="report-form-error"]',
      );
      expect(el).not.toBeNull();
    });
    expect(onReported).not.toHaveBeenCalled();
    expect(
      document.body.querySelector('[data-testid="report-form-error"]')!
        .textContent,
    ).toContain('Boom');
  });

  it('does nothing when translationId is null', async () => {
    render(ReportTranslationModal, {
      open: true,
      translationId: null,
      onClose: vi.fn(),
      onReported: vi.fn(),
    });
    await fireEvent.submit(
      document.body.querySelector(
        '[data-testid="report-translation-form"]',
      ) as HTMLFormElement,
    );
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
