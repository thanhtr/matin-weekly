import { describe, expect, it } from 'vitest';
import { computeWeeklyOccurrence } from '../src/worker/services/scheduler';
import { zonedDateTimeToUtc } from '../src/worker/services/timezone';
import type { ScheduleConfig } from '../src/shared/types';

const BASE_CONFIG: ScheduleConfig = {
  id: 1,
  active: true,
  title_template: 'Weekly Badminton',
  play_weekday: 3, // Wednesday
  play_start_time: '19:00',
  play_end_time: '21:00',
  venue: 'Esport Center',
  timezone: 'Europe/Helsinki',
  invite_weekday: 1, // Monday
  invite_time: '09:00',
  deadline_hours_before: 24,
  reminder_hours_before_deadline: 6,
  max_players: 12,
  updated_at: '2026-01-01T00:00:00.000Z',
};

describe('timezone & weekly scheduler', () => {
  it('converts Europe/Helsinki winter (EET, UTC+2) and summer (EEST, UTC+3) accurately', () => {
    const winter = zonedDateTimeToUtc('2026-01-14', '19:00', 'Europe/Helsinki');
    expect(winter.toISOString()).toBe('2026-01-14T17:00:00.000Z');

    const summer = zonedDateTimeToUtc('2026-07-15', '19:00', 'Europe/Helsinki');
    expect(summer.toISOString()).toBe('2026-07-15T16:00:00.000Z');
  });

  it('computes upcoming Wednesday play, Monday invite, and 24h deadline', () => {
    // Monday 2026-11-23 10:00 Helsinki (08:00 UTC)
    const now = new Date('2026-11-23T08:00:00.000Z');
    const win = computeWeeklyOccurrence(BASE_CONFIG, now);

    expect(win.occurrenceDate).toBe('2026-11-25');
    expect(win.startsAt.toISOString()).toBe('2026-11-25T17:00:00.000Z');
    expect(win.endsAt.toISOString()).toBe('2026-11-25T19:00:00.000Z');
    expect(win.deadlineAt.toISOString()).toBe('2026-11-24T17:00:00.000Z');
    expect(win.inviteAt.toISOString()).toBe('2026-11-23T07:00:00.000Z');
  });

  it('advances to next week once play session has ended on play day', () => {
    // Wednesday 2026-11-25 21:30 Helsinki (19:30 UTC) — after 21:00 end
    const now = new Date('2026-11-25T19:30:00.000Z');
    const win = computeWeeklyOccurrence(BASE_CONFIG, now);

    expect(win.occurrenceDate).toBe('2026-12-02');
  });

  it('computes a correct occurrence spanning the Helsinki DST spring-forward (last Sunday of March)', () => {
    // Monday 2026-03-23 10:00 Helsinki, still EET (UTC+2) -> 08:00 UTC.
    // Clocks spring forward to EEST (UTC+3) at 2026-03-29 03:00 local.
    // The upcoming Wednesday play date (2026-03-25) is still on the EET side,
    // but the deadline 24h before falls on Tuesday 2026-03-24 — both pre-switch,
    // so this just confirms the offset used is the one in effect on each date.
    const now = new Date('2026-03-23T08:00:00.000Z');
    const win = computeWeeklyOccurrence(BASE_CONFIG, now);

    expect(win.occurrenceDate).toBe('2026-03-25');
    expect(win.startsAt.toISOString()).toBe('2026-03-25T17:00:00.000Z'); // EET, UTC+2
    expect(win.deadlineAt.toISOString()).toBe('2026-03-24T17:00:00.000Z');
  });

  it('uses the post-switch EEST offset for an occurrence after the spring-forward', () => {
    // Monday 2026-03-30 10:00 Helsinki, now EEST (UTC+3) -> 07:00 UTC.
    const now = new Date('2026-03-30T07:00:00.000Z');
    const win = computeWeeklyOccurrence(BASE_CONFIG, now);

    expect(win.occurrenceDate).toBe('2026-04-01');
    expect(win.startsAt.toISOString()).toBe('2026-04-01T16:00:00.000Z'); // EEST, UTC+3
  });
});
