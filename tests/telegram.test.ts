import { describe, expect, it } from 'vitest';
import { inviteButtons, parseInviteCallbackData } from '../src/worker/services/telegram';

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
