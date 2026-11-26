import { describe, expect, it } from 'vitest';
import { diffEventFields, inviteButtons, parseInviteCallbackData } from '../src/worker/services/telegram';
import type { BadmintonEvent } from '../src/shared/types';

const BASE_EVENT: BadmintonEvent = {
  id: 'ev-1',
  title: 'Wednesday Badminton',
  event_type: 'on_demand',
  occurrence_date: '2099-06-10',
  starts_at: '2099-06-10T17:00:00.000Z',
  ends_at: '2099-06-10T19:00:00.000Z',
  deadline_at: '2099-06-09T17:00:00.000Z',
  timezone: 'Europe/Helsinki',
  venue: 'Arena 1',
  notes: 'Courts 3 and 4',
  max_players: null,
  status: 'open',
  invites_sent_at: null,
  reminder_sent_at: null,
  created_at: '2026-01-01T00:00:00.000Z',
};

describe('diffEventFields', () => {
  it('returns no lines when nothing meaningful changed', () => {
    expect(diffEventFields(BASE_EVENT, { ...BASE_EVENT, title: 'Renamed' })).toEqual([]);
  });

  it('reports a time change with both the new and old time', () => {
    const after = { ...BASE_EVENT, starts_at: '2099-06-10T18:00:00.000Z', ends_at: '2099-06-10T20:00:00.000Z' };
    const [line] = diffEventFields(BASE_EVENT, after);
    expect(line).toContain('When');
    expect(line).toContain('was');
  });

  it('reports venue and notes changes independently', () => {
    const after = { ...BASE_EVENT, venue: 'Arena 2', notes: 'Courts 5 and 6' };
    const lines = diffEventFields(BASE_EVENT, after);
    expect(lines.some((l) => l.includes('Venue') && l.includes('Arena 2') && l.includes('Arena 1'))).toBe(true);
    expect(lines.some((l) => l.includes('Notes') && l.includes('Courts 5 and 6') && l.includes('Courts 3 and 4'))).toBe(
      true,
    );
  });

  it('reports a deadline change', () => {
    const after = { ...BASE_EVENT, deadline_at: '2099-06-09T15:00:00.000Z' };
    const lines = diffEventFields(BASE_EVENT, after);
    expect(lines.some((l) => l.includes('Hard deadline'))).toBe(true);
  });
});

describe('inviteButtons', () => {
  it('shows both actions before a response', () => {
    const rows = inviteButtons('sid-1');
    expect(rows).toHaveLength(1);
    expect(rows[0].map((b) => b.callback_data)).toEqual(['rsvp:sid-1:accept', 'rsvp:sid-1:cancel']);
  });

  it('collapses to just Cancel once accepted', () => {
    const rows = inviteButtons('sid-1', 'accepted');
    expect(rows).toEqual([[{ text: '❌ Cancel signup', callback_data: 'rsvp:sid-1:cancel' }]]);
  });

  it('collapses to just Accept once cancelled', () => {
    const rows = inviteButtons('sid-1', 'cancelled');
    expect(rows).toEqual([[{ text: '✅ Accept', callback_data: 'rsvp:sid-1:accept' }]]);
  });

  it('shows both again if a pending status is passed explicitly', () => {
    const rows = inviteButtons('sid-1', 'pending');
    expect(rows[0]).toHaveLength(2);
  });
});

describe('parseInviteCallbackData', () => {
  it('parses a well-formed accept/cancel callback', () => {
    expect(parseInviteCallbackData('rsvp:abc-123:accept')).toEqual({ signupId: 'abc-123', action: 'accept' });
    expect(parseInviteCallbackData('rsvp:abc-123:cancel')).toEqual({ signupId: 'abc-123', action: 'cancel' });
  });

  it('rejects malformed data', () => {
    expect(parseInviteCallbackData('nope')).toBeNull();
    expect(parseInviteCallbackData('rsvp:abc:maybe')).toBeNull();
  });
});
