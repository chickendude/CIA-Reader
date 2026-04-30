export const STABLE_API_PREFIX = '/api/v1';
export const NEXT_BREAKING_API_PREFIX = '/api/v2';
export const API_DEPRECATION_HEADER = 'API-Deprecation';
export const API_DEPRECATION_MIN_SUPPORT_MONTHS = 6;

export type ApiDeprecationNotice = {
  since: string;
  sunset: string;
  replacement?: string;
  message?: string;
};

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function parseDateOnly(value: string): Date {
  if (!DATE_ONLY.test(value)) {
    throw new Error(`Expected YYYY-MM-DD date, got "${value}"`);
  }

  const [year, month, day] = value.split('-').map(Number) as [
    number,
    number,
    number,
  ];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error(`Invalid date "${value}"`);
  }
  return date;
}

function formatDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function lastDayOfUtcMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

function quoteHeaderParam(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export function minimumDeprecationSunsetDate(since: string): string {
  const date = parseDateOnly(since);
  const targetMonth = date.getUTCMonth() + API_DEPRECATION_MIN_SUPPORT_MONTHS;
  const targetYear = date.getUTCFullYear() + Math.floor(targetMonth / 12);
  const normalizedMonth = targetMonth % 12;
  const clampedDay = Math.min(
    date.getUTCDate(),
    lastDayOfUtcMonth(targetYear, normalizedMonth),
  );

  return formatDateOnly(
    new Date(Date.UTC(targetYear, normalizedMonth, clampedDay)),
  );
}

export function isStableApiPath(path: string): boolean {
  return path === STABLE_API_PREFIX || path.startsWith(`${STABLE_API_PREFIX}/`);
}

export function buildApiDeprecationHeaders(
  notice: ApiDeprecationNotice,
): Record<string, string> {
  const minimumSunset = minimumDeprecationSunsetDate(notice.since);
  const sunset = parseDateOnly(notice.sunset);
  if (sunset < parseDateOnly(minimumSunset)) {
    throw new Error(
      `Deprecated v1 API routes must remain supported until at least ${minimumSunset}`,
    );
  }

  const parts = [
    'deprecated',
    `since=${quoteHeaderParam(notice.since)}`,
    `sunset=${quoteHeaderParam(notice.sunset)}`,
  ];
  if (notice.replacement) {
    parts.push(`replacement=${quoteHeaderParam(notice.replacement)}`);
  }
  if (notice.message) parts.push(`message=${quoteHeaderParam(notice.message)}`);

  const headers: Record<string, string> = {
    [API_DEPRECATION_HEADER]: parts.join('; '),
    Sunset: new Date(`${notice.sunset}T23:59:59.000Z`).toUTCString(),
  };
  if (notice.replacement) {
    headers.Link = `<${notice.replacement}>; rel="successor-version"`;
  }

  return headers;
}
