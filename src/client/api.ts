import type {
  BadmintonEvent,
  EventSignupRow,
  Player,
  PlayerStatus,
  ScheduleConfig,
  ScheduleConfigWithPreview,
  SignupStatus,
} from '../shared/types';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: 'include',
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
  }
  return data as T;
}

export const api = {
  checkAuth() {
    return request<{ authenticated: boolean }>('/api/auth/me');
  },
  login(password: string) {
    return request<{ ok: boolean }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ password }),
    });
  },
  logout() {
    return request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' });
  },
  getSchedule() {
    return request<ScheduleConfigWithPreview>('/api/admin/schedule');
  },
  updateSchedule(config: Omit<ScheduleConfig, 'id' | 'updated_at'>) {
    return request<ScheduleConfigWithPreview>('/api/admin/schedule', {
      method: 'PUT',
      body: JSON.stringify(config),
    });
  },
  getBotInfo() {
    return request<{ bot_username: string; pending_count: number }>('/api/admin/bot-info');
  },
  listPlayers() {
    return request<{ players: Player[] }>('/api/admin/players');
  },
  setPlayerStatus(id: string, status: PlayerStatus) {
    return request<{ ok: boolean }>(`/api/admin/players/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
  },
  setPlayerName(id: string, name: string) {
    return request<{ ok: boolean }>(`/api/admin/players/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    });
  },
  deletePlayer(id: string) {
    return request<{ ok: boolean }>(`/api/admin/players/${id}`, { method: 'DELETE' });
  },
  listEvents() {
    return request<{
      events: Array<
        BadmintonEvent & { accepted_count: number; pending_count: number; cancelled_count: number }
      >;
    }>('/api/admin/events');
  },
  getEvent(id: string) {
    return request<{ event: BadmintonEvent; signups: EventSignupRow[] }>(`/api/admin/events/${id}`);
  },
  createEvent(payload: {
    title: string;
    occurrence_date: string;
    start_time: string;
    end_time: string;
    deadline_date: string;
    deadline_time: string;
    timezone: string;
    venue: string;
    notes: string;
    max_players: number | null;
    send_invites_now: boolean;
  }) {
    return request<{ event: BadmintonEvent; inviteResult: { sent: number; failed: number } | null }>(
      '/api/admin/events',
      { method: 'POST', body: JSON.stringify(payload) },
    );
  },
  updateEvent(
    id: string,
    patch: Partial<
      Pick<BadmintonEvent, 'title' | 'venue' | 'notes' | 'max_players' | 'status'> & {
        occurrence_date: string;
        start_time: string;
        end_time: string;
        deadline_date: string;
        deadline_time: string;
        notify: boolean;
      }
    >,
  ) {
    return request<{ event: BadmintonEvent; notifyResult: { sent: number; failed: number } | null }>(
      `/api/admin/events/${id}`,
      { method: 'PATCH', body: JSON.stringify(patch) },
    );
  },
  sendInvites(id: string, options: { mode?: 'new' | 'pending' | 'all'; isReminder?: boolean } = {}) {
    return request<{ ok: boolean; sent: number; failed: number }>(
      `/api/admin/events/${id}/send-invites`,
      { method: 'POST', body: JSON.stringify(options) },
    );
  },
  overrideSignup(eventId: string, signupId: string, status: SignupStatus) {
    return request<{ ok: boolean }>(`/api/admin/events/${eventId}/signups/${signupId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
  },
};
