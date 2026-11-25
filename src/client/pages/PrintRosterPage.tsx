import { useEffect, useState } from 'react';
import { ArrowLeft, Printer } from 'lucide-react';
import { api } from '../api';
import type { BadmintonEvent, EventSignupRow } from '../../shared/types';

function formatLocal(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

function formatTime(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

export function PrintRosterPage({
  eventId,
  onBack,
}: {
  eventId: string;
  onBack: () => void;
}) {
  const [event, setEvent] = useState<BadmintonEvent | null>(null);
  const [signups, setSignups] = useState<EventSignupRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getEvent(eventId)
      .then((res) => {
        setEvent(res.event);
        setSignups(res.signups);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load roster'));
  }, [eventId]);

  if (error) {
    return (
      <div className="container">
        <div className="alert alert-error">{error}</div>
      </div>
    );
  }

  if (!event) {
    return <div className="container">Loading printable roster...</div>;
  }

  const confirmed = signups.filter((s) => s.status === 'accepted');
  const cancelled = signups.filter((s) => s.status === 'cancelled');
  const pending = signups.filter((s) => s.status === 'pending');

  return (
    <div className="container">
      <div className="row between no-print" style={{ marginBottom: 16 }}>
        <button type="button" className="btn" onClick={onBack}>
          <ArrowLeft size={16} /> Back to Dashboard
        </button>
        <button type="button" className="btn btn-primary" onClick={() => window.print()}>
          <Printer size={16} /> Print / Save PDF
        </button>
      </div>

      <div className="print-sheet">
        <div style={{ borderBottom: '2px solid #000', paddingBottom: 12, marginBottom: 18 }}>
          <h1 style={{ margin: 0, fontSize: 24 }}>{event.title} — Final Player List</h1>
          <div style={{ marginTop: 6, fontSize: 14 }}>
            <strong>Date & Time:</strong> {formatLocal(event.starts_at, event.timezone)} –{' '}
            {formatTime(event.ends_at, event.timezone)} ({event.timezone})
          </div>
          {event.venue && (
            <div style={{ fontSize: 14 }}>
              <strong>Venue:</strong> {event.venue}
            </div>
          )}
          {event.notes && (
            <div style={{ fontSize: 14 }}>
              <strong>Notes:</strong> {event.notes}
            </div>
          )}
          <div style={{ fontSize: 14 }}>
            <strong>Hard Deadline:</strong> {formatLocal(event.deadline_at, event.timezone)} •{' '}
            <strong>Total Confirmed:</strong> {confirmed.length}
            {event.max_players !== null ? ` / ${event.max_players}` : ''}
          </div>
        </div>

        <h2 style={{ fontSize: 16, margin: '0 0 10px' }}>Confirmed Players ({confirmed.length})</h2>
        <table>
          <thead>
            <tr>
              <th style={{ width: 42 }}>#</th>
              <th>Name</th>
              <th style={{ width: 80 }}></th>
            </tr>
          </thead>
          <tbody>
            {confirmed.length === 0 ? (
              <tr>
                <td colSpan={3} style={{ color: '#475569' }}>
                  No confirmed players yet.
                </td>
              </tr>
            ) : (
              confirmed.map((p, idx) => (
                <tr key={p.signup_id}>
                  <td>{idx + 1}</td>
                  <td>{p.player_name || '—'}</td>
                  <td style={{ textAlign: 'center' }}>
                    <span className="checkbox-box" />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        <div style={{ marginTop: 22, fontSize: 12, color: '#334155' }}>
          <strong>Summary:</strong> {confirmed.length} confirmed • {cancelled.length} cancelled •{' '}
          {pending.length} no response • Printed {formatLocal(new Date().toISOString(), event.timezone)}
        </div>
      </div>
    </div>
  );
}
