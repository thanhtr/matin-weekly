import { useEffect, useState, type FormEvent } from 'react';
import {
  Ban,
  CalendarPlus,
  Copy,
  LogOut,
  Mail,
  Pencil,
  Printer,
  RefreshCw,
  Send,
  Trash2,
  Undo2,
  UserCheck,
  UserX,
  Users,
} from 'lucide-react';
import { api } from '../api';
import type {
  BadmintonEvent,
  EventSignupRow,
  Player,
  ScheduleConfigWithPreview,
  SignupStatus,
} from '../../shared/types';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function formatLocal(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

function formatHHMM(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

function dayBeforeYmd(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d - 1));
  return dt.toISOString().slice(0, 10);
}

export function AdminDashboardPage({
  onLogout,
  onOpenPrint,
}: {
  onLogout: () => void;
  onOpenPrint: (eventId: string) => void;
}) {
  const [tab, setTab] = useState<'events' | 'schedule' | 'players'>('events');
  const [events, setEvents] = useState<
    Array<BadmintonEvent & { accepted_count: number; pending_count: number; cancelled_count: number }>
  >([]);
  const [selectedEventId, setSelectedEventId] = useState<string>('');
  const [eventFilter, setEventFilter] = useState('');
  const [selectedEvent, setSelectedEvent] = useState<BadmintonEvent | null>(null);
  const [signups, setSignups] = useState<EventSignupRow[]>([]);
  const [schedule, setSchedule] = useState<ScheduleConfigWithPreview | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [botInfo, setBotInfo] = useState<{ bot_username: string; pending_count: number } | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);

  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // On-demand event form state
  const [newTitle, setNewTitle] = useState('Extra Badminton Session');
  const [newDate, setNewDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [newStart, setNewStart] = useState('19:00');
  const [newEnd, setNewEnd] = useState('21:00');
  const [newDeadlineDate, setNewDeadlineDate] = useState(() => dayBeforeYmd(new Date().toISOString().slice(0, 10)));
  const [newDeadlineTime, setNewDeadlineTime] = useState('12:00');
  const [newVenue, setNewVenue] = useState('');
  const [newNotes, setNewNotes] = useState('');
  const [newMaxPlayers, setNewMaxPlayers] = useState('');
  const [newSendNow, setNewSendNow] = useState(true);

  // Edit-event form state (populated from the selected event when opened)
  const [editTitle, setEditTitle] = useState('');
  const [editDate, setEditDate] = useState('');
  const [editStart, setEditStart] = useState('');
  const [editEnd, setEditEnd] = useState('');
  const [editDeadlineDate, setEditDeadlineDate] = useState('');
  const [editDeadlineTime, setEditDeadlineTime] = useState('');
  const [editVenue, setEditVenue] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editMaxPlayers, setEditMaxPlayers] = useState('');

  async function refreshAll(keepSelectedId?: string) {
    try {
      const [evRes, schRes, plRes, botRes] = await Promise.all([
        api.listEvents(),
        api.getSchedule(),
        api.listPlayers(),
        api.getBotInfo(),
      ]);
      setEvents(evRes.events);
      setSchedule(schRes);
      setPlayers(plRes.players);
      setBotInfo(botRes);
      const nextId = keepSelectedId || selectedEventId || evRes.events[0]?.id || '';
      setSelectedEventId(nextId);
      if (nextId) {
        const detail = await api.getEvent(nextId);
        setSelectedEvent(detail.event);
        setSignups(detail.signups);
      } else {
        setSelectedEvent(null);
        setSignups([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard');
    }
  }

  useEffect(() => {
    void refreshAll();
  }, []);

  async function handleSelectEvent(id: string) {
    setSelectedEventId(id);
    if (!id) return;
    try {
      const detail = await api.getEvent(id);
      setSelectedEvent(detail.event);
      setSignups(detail.signups);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load event');
    }
  }

  async function handleSendInvites(mode: 'new' | 'pending' | 'all', isReminder: boolean) {
    if (!selectedEvent) return;
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      const res = await api.sendInvites(selectedEvent.id, { mode, isReminder });
      setNotice(`Sent ${res.sent} message(s)${res.failed ? `, ${res.failed} failed` : ''}.`);
      await refreshAll(selectedEvent.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send Telegram messages');
    } finally {
      setBusy(false);
    }
  }

  function openEditModal() {
    if (!selectedEvent) return;
    setEditTitle(selectedEvent.title);
    setEditDate(selectedEvent.occurrence_date);
    setEditStart(formatHHMM(selectedEvent.starts_at, selectedEvent.timezone));
    setEditEnd(formatHHMM(selectedEvent.ends_at, selectedEvent.timezone));
    setEditDeadlineDate(selectedEvent.deadline_at.slice(0, 10));
    setEditDeadlineTime(formatHHMM(selectedEvent.deadline_at, selectedEvent.timezone));
    setEditVenue(selectedEvent.venue);
    setEditNotes(selectedEvent.notes);
    setEditMaxPlayers(selectedEvent.max_players ? String(selectedEvent.max_players) : '');
    setShowEditModal(true);
  }

  async function handleSaveEdit(e: FormEvent) {
    e.preventDefault();
    if (!selectedEvent) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api.updateEvent(selectedEvent.id, {
        title: editTitle,
        occurrence_date: editDate,
        start_time: editStart,
        end_time: editEnd,
        deadline_date: editDeadlineDate,
        deadline_time: editDeadlineTime,
        venue: editVenue,
        notes: editNotes,
        max_players: editMaxPlayers ? Number(editMaxPlayers) : null,
      });
      setShowEditModal(false);
      setNotice('Event updated.');
      await refreshAll(selectedEvent.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update event');
    } finally {
      setBusy(false);
    }
  }

  async function handleCancelEvent() {
    if (!selectedEvent) return;
    if (!window.confirm(`Cancel "${selectedEvent.title}"? Players will no longer be able to sign up.`)) return;
    setBusy(true);
    setError(null);
    try {
      await api.updateEvent(selectedEvent.id, { status: 'cancelled' });
      setNotice('Event cancelled.');
      await refreshAll(selectedEvent.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel event');
    } finally {
      setBusy(false);
    }
  }

  async function handleReopenEvent() {
    if (!selectedEvent) return;
    setBusy(true);
    setError(null);
    try {
      await api.updateEvent(selectedEvent.id, { status: 'open' });
      setNotice('Event reopened.');
      await refreshAll(selectedEvent.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reopen event');
    } finally {
      setBusy(false);
    }
  }

  async function handleOverrideStatus(signupId: string, status: SignupStatus) {
    if (!selectedEvent) return;
    try {
      await api.overrideSignup(selectedEvent.id, signupId, status);
      await handleSelectEvent(selectedEvent.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update status');
    }
  }

  async function handleCreateOnDemand(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api.createEvent({
        title: newTitle,
        occurrence_date: newDate,
        start_time: newStart,
        end_time: newEnd,
        deadline_date: newDeadlineDate,
        deadline_time: newDeadlineTime,
        timezone: schedule?.timezone ?? 'Europe/Helsinki',
        venue: newVenue,
        notes: newNotes,
        max_players: newMaxPlayers ? Number(newMaxPlayers) : null,
        send_invites_now: newSendNow,
      });
      setShowCreateModal(false);
      setNotice(
        res.inviteResult
          ? `Created event and sent ${res.inviteResult.sent} invite(s).`
          : 'Created event.',
      );
      await refreshAll(res.event.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create event');
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveSchedule(e: FormEvent) {
    e.preventDefault();
    if (!schedule) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const updated = await api.updateSchedule({
        active: schedule.active,
        title_template: schedule.title_template,
        play_weekday: schedule.play_weekday,
        play_start_time: schedule.play_start_time,
        play_end_time: schedule.play_end_time,
        venue: schedule.venue,
        timezone: schedule.timezone,
        invite_weekday: schedule.invite_weekday,
        invite_time: schedule.invite_time,
        deadline_hours_before: schedule.deadline_hours_before,
        reminder_hours_before_deadline: schedule.reminder_hours_before_deadline,
        max_players: schedule.max_players,
      });
      setSchedule(updated);
      setNotice('Recurring schedule saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save schedule');
    } finally {
      setBusy(false);
    }
  }

  async function handleLogoutClick() {
    await api.logout();
    onLogout();
  }

  function playerLabel(player: Player): string {
    return player.telegram_username ? `@${player.telegram_username}` : player.name || 'this player';
  }

  async function handleSetPlayerStatus(player: Player, status: Player['status']) {
    setError(null);
    try {
      await api.setPlayerStatus(player.id, status);
      await refreshAll(selectedEventId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update player');
    }
  }

  async function handleRejectOrRemovePlayer(player: Player) {
    const verb = player.status === 'pending' ? 'Reject' : 'Remove';
    if (!window.confirm(`${verb} ${playerLabel(player)}? Their signup history will be deleted too.`)) {
      return;
    }
    setError(null);
    try {
      await api.deletePlayer(player.id);
      await refreshAll(selectedEventId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove player');
    }
  }

  const acceptedList = signups.filter((s) => s.status === 'accepted');
  const pendingList = signups.filter((s) => s.status === 'pending');
  const cancelledList = signups.filter((s) => s.status === 'cancelled');

  return (
    <div className="container">
      <div className="row between no-print" style={{ marginBottom: 18 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 24 }}>Matin Weekly Badminton</h1>
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>
            Manage weekly & on-demand signups, the Telegram player roster, and printable lists
          </div>
        </div>
        <div className="row">
          <button type="button" className="btn btn-primary" onClick={() => setShowCreateModal(true)}>
            <CalendarPlus size={16} /> New On-Demand Event
          </button>
          <button type="button" className="btn" onClick={() => refreshAll(selectedEventId)}>
            <RefreshCw size={16} /> Refresh
          </button>
          <button type="button" className="btn" onClick={handleLogoutClick}>
            <LogOut size={16} /> Logout
          </button>
        </div>
      </div>

      {notice && <div className="alert alert-success no-print">{notice}</div>}
      {error && <div className="alert alert-error no-print">{error}</div>}

      <div className="tabs no-print">
        <button
          type="button"
          className={`tab ${tab === 'events' ? 'active' : ''}`}
          onClick={() => setTab('events')}
        >
          Events & Attendance ({events.length})
        </button>
        <button
          type="button"
          className={`tab ${tab === 'schedule' ? 'active' : ''}`}
          onClick={() => setTab('schedule')}
        >
          Recurring Schedule
        </button>
        <button
          type="button"
          className={`tab ${tab === 'players' ? 'active' : ''}`}
          onClick={() => setTab('players')}
        >
          <span className="row" style={{ gap: 6 }}>
            <Users size={15} /> Players ({players.length})
            {botInfo && botInfo.pending_count > 0 && (
              <span className="badge badge-pending">{botInfo.pending_count} pending</span>
            )}
          </span>
        </button>
      </div>

      {tab === 'events' && (
        <div className="card">
          {events.length === 0 ? (
            <p style={{ margin: 0, color: 'var(--muted)' }}>
              No events yet. Configure a recurring schedule or click <strong>New On-Demand Event</strong>.
            </p>
          ) : (
            <>
              <div className="row between" style={{ marginBottom: 16 }}>
                <div style={{ minWidth: 280, flex: 1 }}>
                  <label className="label">Select Event / Week</label>
                  <div className="row" style={{ gap: 8, marginBottom: 6 }}>
                    <input
                      type="text"
                      className="input"
                      placeholder="Filter by title or date…"
                      value={eventFilter}
                      onChange={(e) => setEventFilter(e.target.value)}
                    />
                  </div>
                  <select
                    className="select"
                    value={selectedEventId}
                    onChange={(e) => handleSelectEvent(e.target.value)}
                  >
                    {events
                      .filter((ev) => {
                        const q = eventFilter.trim().toLowerCase();
                        if (!q) return true;
                        return ev.title.toLowerCase().includes(q) || ev.occurrence_date.includes(q);
                      })
                      .map((ev) => (
                        <option key={ev.id} value={ev.id}>
                          {ev.occurrence_date} — {ev.title} ({ev.event_type}) [{ev.accepted_count} in, {ev.pending_count} pending]
                        </option>
                      ))}
                  </select>
                </div>

                {selectedEvent && (
                  <div className="row" style={{ alignSelf: 'flex-end', flexWrap: 'wrap' }}>
                    {selectedEvent.status === 'open' && (
                      <>
                        <button
                          type="button"
                          className="btn"
                          disabled={busy}
                          onClick={() => handleSendInvites('new', false)}
                        >
                          <Send size={15} /> Send to Not-Yet-Invited
                        </button>
                        <button
                          type="button"
                          className="btn"
                          disabled={busy || pendingList.length === 0}
                          onClick={() => handleSendInvites('pending', true)}
                        >
                          <Mail size={15} /> Remind Pending ({pendingList.length})
                        </button>
                        <button
                          type="button"
                          className="btn"
                          disabled={busy}
                          onClick={() => handleSendInvites('all', false)}
                        >
                          <Send size={15} /> Resend to All
                        </button>
                      </>
                    )}
                    {selectedEvent.status !== 'cancelled' && (
                      <button type="button" className="btn" disabled={busy} onClick={openEditModal}>
                        <Pencil size={15} /> Edit
                      </button>
                    )}
                    {selectedEvent.status === 'locked' && (
                      <button type="button" className="btn" disabled={busy} onClick={handleReopenEvent}>
                        <Undo2 size={15} /> Reopen
                      </button>
                    )}
                    {selectedEvent.status !== 'cancelled' && (
                      <button type="button" className="btn btn-danger" disabled={busy} onClick={handleCancelEvent}>
                        <Ban size={15} /> Cancel Event
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => onOpenPrint(selectedEvent.id)}
                    >
                      <Printer size={15} /> Print Final List
                    </button>
                  </div>
                )}
              </div>

              {selectedEvent && (
                <>
                  <div
                    style={{
                      background: '#f8fafc',
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                      padding: 12,
                      marginBottom: 16,
                      fontSize: 14,
                    }}
                    className="row between"
                  >
                    <div>
                      <strong>Play:</strong> {formatLocal(selectedEvent.starts_at, selectedEvent.timezone)} –{' '}
                      {formatLocal(selectedEvent.ends_at, selectedEvent.timezone)}
                      {selectedEvent.venue ? ` • ${selectedEvent.venue}` : ''}
                    </div>
                    <div>
                      <strong>Deadline:</strong> {formatLocal(selectedEvent.deadline_at, selectedEvent.timezone)} •{' '}
                      <span className={`badge badge-${selectedEvent.status === 'open' ? 'accepted' : 'cancelled'}`}>
                        {selectedEvent.status}
                      </span>
                    </div>
                  </div>

                  <div className="row" style={{ marginBottom: 14 }}>
                    <span className="badge badge-accepted">Accepted: {acceptedList.length}</span>
                    <span className="badge badge-pending">Pending: {pendingList.length}</span>
                    <span className="badge badge-cancelled">Cancelled: {cancelledList.length}</span>
                  </div>

                  {pendingList.length > 0 && (
                    <div
                      style={{
                        background: '#fffbeb',
                        border: '1px solid #fde68a',
                        borderRadius: 8,
                        padding: 10,
                        marginBottom: 14,
                        fontSize: 13,
                      }}
                    >
                      <strong>Who hasn't responded ({pendingList.length}):</strong>{' '}
                      {pendingList
                        .map((s) => s.player_name || (s.telegram_username ? `@${s.telegram_username}` : 'Unknown'))
                        .join(', ')}
                    </div>
                  )}

                  <table>
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Player</th>
                        <th>Telegram</th>
                        <th>Status</th>
                        <th>Updated</th>
                        <th>Override</th>
                      </tr>
                    </thead>
                    <tbody>
                      {signups.map((s, idx) => (
                        <tr key={s.signup_id}>
                          <td>{idx + 1}</td>
                          <td>{s.player_name || '—'}</td>
                          <td>
                            {s.telegram_username ? `@${s.telegram_username}` : '—'}
                            {s.last_send_error && (
                              <span title={`Delivery failed: ${s.last_send_error}`} style={{ marginLeft: 6, cursor: 'help' }}>
                                ⚠️
                              </span>
                            )}
                          </td>
                          <td>
                            <span className={`badge badge-${s.status}`}>{s.status}</span>
                          </td>
                          <td style={{ color: 'var(--muted)', fontSize: 13 }}>
                            {s.responded_at ? formatLocal(s.responded_at, selectedEvent.timezone) : '—'}
                          </td>
                          <td>
                            <select
                              className="select"
                              style={{ width: 'auto', padding: '4px 8px', fontSize: 13 }}
                              value={s.status}
                              onChange={(e) => handleOverrideStatus(s.signup_id, e.target.value as SignupStatus)}
                            >
                              <option value="pending">pending</option>
                              <option value="accepted">accepted</option>
                              <option value="cancelled">cancelled</option>
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </>
          )}
        </div>
      )}

      {tab === 'schedule' && schedule && (
        <form className="card" onSubmit={handleSaveSchedule}>
          <h2 style={{ marginTop: 0, fontSize: 18 }}>Weekly Recurring Schedule</h2>
          <div style={{ marginBottom: 16 }}>
            <label className="row" style={{ cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={schedule.active}
                onChange={(e) => setSchedule({ ...schedule, active: e.target.checked })}
              />
              <strong>Enable automatic weekly invite emails</strong>
            </label>
          </div>

          {schedule.preview && (
            <div
              className="row"
              style={{
                background: '#f8fafc',
                border: '1px solid var(--border)',
                borderRadius: 8,
                padding: 10,
                marginBottom: 16,
                fontSize: 13,
                color: 'var(--muted)',
              }}
            >
              Next invite: <strong>{formatLocal(schedule.preview.invite_at, schedule.timezone)}</strong> · Play:{' '}
              <strong>{formatLocal(schedule.preview.starts_at, schedule.timezone)}</strong> · Deadline:{' '}
              <strong>{formatLocal(schedule.preview.deadline_at, schedule.timezone)}</strong>
            </div>
          )}

          <div className="grid-2" style={{ marginBottom: 14 }}>
            <div>
              <label className="label">Event Title</label>
              <input
                className="input"
                value={schedule.title_template}
                onChange={(e) => setSchedule({ ...schedule, title_template: e.target.value })}
                required
              />
            </div>
            <div>
              <label className="label">Venue / Court</label>
              <input
                className="input"
                value={schedule.venue}
                onChange={(e) => setSchedule({ ...schedule, venue: e.target.value })}
                placeholder="e.g. Esport Center Court 3"
              />
            </div>
            <div>
              <label className="label">Play Day</label>
              <select
                className="select"
                value={schedule.play_weekday}
                onChange={(e) => setSchedule({ ...schedule, play_weekday: Number(e.target.value) })}
              >
                {WEEKDAYS.map((d, i) => (
                  <option key={d} value={i}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
            <div className="row">
              <div style={{ flex: 1 }}>
                <label className="label">Start Hour</label>
                <input
                  type="time"
                  className="input"
                  value={schedule.play_start_time}
                  onChange={(e) => setSchedule({ ...schedule, play_start_time: e.target.value })}
                  required
                />
              </div>
              <div style={{ flex: 1 }}>
                <label className="label">End Hour</label>
                <input
                  type="time"
                  className="input"
                  value={schedule.play_end_time}
                  onChange={(e) => setSchedule({ ...schedule, play_end_time: e.target.value })}
                  required
                />
              </div>
            </div>
            <div>
              <label className="label">Send Weekly Invite On</label>
              <select
                className="select"
                value={schedule.invite_weekday}
                onChange={(e) => setSchedule({ ...schedule, invite_weekday: Number(e.target.value) })}
              >
                {WEEKDAYS.map((d, i) => (
                  <option key={d} value={i}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Invite Send Hour</label>
              <input
                type="time"
                className="input"
                value={schedule.invite_time}
                onChange={(e) => setSchedule({ ...schedule, invite_time: e.target.value })}
                required
              />
            </div>
            <div>
              <label className="label">Hard Deadline (hours before play)</label>
              <input
                type="number"
                min={0}
                max={168}
                className="input"
                value={schedule.deadline_hours_before}
                onChange={(e) => setSchedule({ ...schedule, deadline_hours_before: Number(e.target.value) })}
                required
              />
            </div>
            <div>
              <label className="label">Pending Reminder (hours before deadline, 0 = off)</label>
              <input
                type="number"
                min={0}
                max={72}
                className="input"
                value={schedule.reminder_hours_before_deadline}
                onChange={(e) =>
                  setSchedule({ ...schedule, reminder_hours_before_deadline: Number(e.target.value) })
                }
                required
              />
            </div>
            <div>
              <label className="label">Timezone</label>
              <input
                className="input"
                value={schedule.timezone}
                onChange={(e) => setSchedule({ ...schedule, timezone: e.target.value })}
                required
              />
            </div>
            <div>
              <label className="label">Max Players (optional)</label>
              <input
                type="number"
                min={1}
                className="input"
                value={schedule.max_players ?? ''}
                placeholder="Unlimited"
                onChange={(e) =>
                  setSchedule({ ...schedule, max_players: e.target.value ? Number(e.target.value) : null })
                }
              />
            </div>
          </div>

          <button type="submit" className="btn btn-primary" disabled={busy}>
            Save Recurring Schedule
          </button>
        </form>
      )}

      {tab === 'players' && (
        <>
          <div className="card" style={{ marginBottom: 16 }}>
            <h2 style={{ marginTop: 0, fontSize: 18 }}>Invite Link</h2>
            <p style={{ marginTop: 0, color: 'var(--muted)', fontSize: 14 }}>
              Share this link in your group chat. Anyone who taps it and messages the bot shows up below as a{' '}
              <strong>pending request</strong> — they can't receive invites or RSVP until you approve them.
            </p>
            {botInfo && (
              <div className="row" style={{ gap: 8 }}>
                <input className="input" readOnly value={`https://t.me/${botInfo.bot_username}`} style={{ flex: 1 }} />
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    navigator.clipboard.writeText(`https://t.me/${botInfo.bot_username}`).catch(() => {});
                    setNotice('Invite link copied.');
                  }}
                >
                  <Copy size={15} /> Copy
                </button>
              </div>
            )}
          </div>

          {players.some((p) => p.status === 'pending') && (
            <div className="card" style={{ marginBottom: 16 }}>
              <h2 style={{ marginTop: 0, fontSize: 18 }}>
                Pending Approval ({players.filter((p) => p.status === 'pending').length})
              </h2>
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Telegram</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {players
                    .filter((p) => p.status === 'pending')
                    .map((p) => (
                      <tr key={p.id}>
                        <td>{p.name || '—'}</td>
                        <td>{p.telegram_username ? `@${p.telegram_username}` : '—'}</td>
                        <td className="row">
                          <button
                            type="button"
                            className="btn btn-primary"
                            onClick={() => handleSetPlayerStatus(p, 'active')}
                          >
                            <UserCheck size={14} /> Approve
                          </button>
                          <button type="button" className="btn" onClick={() => handleRejectOrRemovePlayer(p)}>
                            <UserX size={14} /> Reject
                          </button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="card">
            <h2 style={{ marginTop: 0, fontSize: 18 }}>Roster</h2>
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Telegram</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {players
                  .filter((p) => p.status !== 'pending')
                  .map((p) => (
                    <tr key={p.id}>
                      <td>{p.name || '—'}</td>
                      <td>{p.telegram_username ? `@${p.telegram_username}` : '—'}</td>
                      <td>
                        <span className={`badge ${p.status === 'active' ? 'badge-accepted' : 'badge-cancelled'}`}>
                          {p.status}
                        </span>
                      </td>
                      <td className="row">
                        <button
                          type="button"
                          className="btn"
                          onClick={() => handleSetPlayerStatus(p, p.status === 'active' ? 'paused' : 'active')}
                        >
                          {p.status === 'active' ? 'Pause' : 'Activate'}
                        </button>
                        <button type="button" className="btn" onClick={() => handleRejectOrRemovePlayer(p)}>
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {showCreateModal && (
        <div className="modal-backdrop">
          <div className="card modal-card">
            <h2 style={{ marginTop: 0 }}>Create On-Demand Badminton Event</h2>
            <form onSubmit={handleCreateOnDemand}>
              <div className="grid-2" style={{ marginBottom: 14 }}>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label className="label">Title</label>
                  <input className="input" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} required />
                </div>
                <div>
                  <label className="label">Play Date</label>
                  <input
                    type="date"
                    className="input"
                    value={newDate}
                    onChange={(e) => {
                      setNewDate(e.target.value);
                      setNewDeadlineDate(dayBeforeYmd(e.target.value));
                    }}
                    required
                  />
                </div>
                <div className="row">
                  <div style={{ flex: 1 }}>
                    <label className="label">Start</label>
                    <input type="time" className="input" value={newStart} onChange={(e) => setNewStart(e.target.value)} required />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label className="label">End</label>
                    <input type="time" className="input" value={newEnd} onChange={(e) => setNewEnd(e.target.value)} required />
                  </div>
                </div>
                <div>
                  <label className="label">Hard Deadline Date</label>
                  <input
                    type="date"
                    className="input"
                    value={newDeadlineDate}
                    onChange={(e) => setNewDeadlineDate(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label className="label">Hard Deadline Time</label>
                  <input
                    type="time"
                    className="input"
                    value={newDeadlineTime}
                    onChange={(e) => setNewDeadlineTime(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label className="label">Venue</label>
                  <input className="input" value={newVenue} onChange={(e) => setNewVenue(e.target.value)} />
                </div>
                <div>
                  <label className="label">Max Players (optional)</label>
                  <input
                    type="number"
                    min={1}
                    className="input"
                    value={newMaxPlayers}
                    onChange={(e) => setNewMaxPlayers(e.target.value)}
                    placeholder="Unlimited"
                  />
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label className="label">Notes</label>
                  <textarea className="textarea" rows={2} value={newNotes} onChange={(e) => setNewNotes(e.target.value)} />
                </div>
              </div>
              <label className="row" style={{ marginBottom: 16, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={newSendNow}
                  onChange={(e) => setNewSendNow(e.target.checked)}
                />
                <span>Send Telegram invites to all active players immediately</span>
              </label>
              <div className="row" style={{ justifyContent: 'flex-end' }}>
                <button type="button" className="btn" onClick={() => setShowCreateModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={busy}>
                  Create Event
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showEditModal && selectedEvent && (
        <div className="modal-backdrop">
          <div className="card modal-card">
            <h2 style={{ marginTop: 0 }}>Edit Event</h2>
            <form onSubmit={handleSaveEdit}>
              <div className="grid-2" style={{ marginBottom: 14 }}>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label className="label">Title</label>
                  <input className="input" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} required />
                </div>
                <div>
                  <label className="label">Play Date</label>
                  <input type="date" className="input" value={editDate} onChange={(e) => setEditDate(e.target.value)} required />
                </div>
                <div className="row">
                  <div style={{ flex: 1 }}>
                    <label className="label">Start</label>
                    <input type="time" className="input" value={editStart} onChange={(e) => setEditStart(e.target.value)} required />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label className="label">End</label>
                    <input type="time" className="input" value={editEnd} onChange={(e) => setEditEnd(e.target.value)} required />
                  </div>
                </div>
                <div>
                  <label className="label">Hard Deadline Date</label>
                  <input
                    type="date"
                    className="input"
                    value={editDeadlineDate}
                    onChange={(e) => setEditDeadlineDate(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label className="label">Hard Deadline Time</label>
                  <input
                    type="time"
                    className="input"
                    value={editDeadlineTime}
                    onChange={(e) => setEditDeadlineTime(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label className="label">Venue</label>
                  <input className="input" value={editVenue} onChange={(e) => setEditVenue(e.target.value)} />
                </div>
                <div>
                  <label className="label">Max Players (optional)</label>
                  <input
                    type="number"
                    min={1}
                    className="input"
                    value={editMaxPlayers}
                    onChange={(e) => setEditMaxPlayers(e.target.value)}
                    placeholder="Unlimited"
                  />
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label className="label">Notes</label>
                  <textarea className="textarea" rows={2} value={editNotes} onChange={(e) => setEditNotes(e.target.value)} />
                </div>
              </div>
              <div className="row" style={{ justifyContent: 'flex-end' }}>
                <button type="button" className="btn" onClick={() => setShowEditModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={busy}>
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
