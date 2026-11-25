export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  weekday: number; // 0 = Sun .. 6 = Sat
  hour: number;
  minute: number;
  second: number;
}

const WEEKDAY_MAP: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export function getZonedParts(date: Date, timeZone: string): ZonedParts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = fmt.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? '';

  const hourRaw = Number(get('hour'));
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    weekday: WEEKDAY_MAP[get('weekday')] ?? 0,
    hour: hourRaw === 24 ? 0 : hourRaw,
    minute: Number(get('minute')),
    second: Number(get('second')),
  };
}

export function formatYmd(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function addDaysToYmd(ymd: string, deltaDays: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays));
  return formatYmd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

/**
 * Converts a wall-clock date (YYYY-MM-DD) and time (HH:MM) in `timeZone`
 * into an exact UTC Date using iterative offset refinement (handles DST cleanly).
 */
export function zonedDateTimeToUtc(ymd: string, hhmm: string, timeZone: string): Date {
  const [year, month, day] = ymd.split('-').map(Number);
  const [hour, minute] = hhmm.split(':').map(Number);
  const targetUtcApprox = Date.UTC(year, month - 1, day, hour, minute, 0, 0);

  let guess = targetUtcApprox;
  for (let i = 0; i < 3; i++) {
    const p = getZonedParts(new Date(guess), timeZone);
    const seenAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, 0, 0);
    const diffMs = targetUtcApprox - seenAsUtc;
    if (diffMs === 0) break;
    guess += diffMs;
  }
  return new Date(guess);
}

export function formatLocalDateTime(isoUtc: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(isoUtc));
}

export function formatLocalTime(isoUtc: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(isoUtc));
}
