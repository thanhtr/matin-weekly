export type SignupStatus = 'pending' | 'accepted' | 'cancelled';
export type EventType = 'recurring' | 'on_demand';
export type EventStatus = 'open' | 'locked' | 'cancelled';

export interface ScheduleConfig {
  id: number;
  active: boolean;
  title_template: string;
  play_weekday: number; // 0 = Sun .. 6 = Sat
  play_start_time: string; // HH:MM
  play_end_time: string; // HH:MM
  venue: string;
  timezone: string;
  invite_weekday: number; // 0 = Sun .. 6 = Sat
  invite_time: string; // HH:MM
  deadline_hours_before: number;
  reminder_hours_before_deadline: number;
  max_players: number | null;
  updated_at: string;
}

export type PlayerStatus = 'pending' | 'active' | 'paused';

export interface Player {
  id: string;
  telegram_chat_id: string;
  telegram_username: string | null;
  name: string;
  status: PlayerStatus;
  created_at: string;
}

export interface BadmintonEvent {
  id: string;
  title: string;
  event_type: EventType;
  occurrence_date: string;
  starts_at: string;
  ends_at: string;
  deadline_at: string;
  timezone: string;
  venue: string;
  notes: string;
  max_players: number | null;
  status: EventStatus;
  invites_sent_at: string | null;
  reminder_sent_at: string | null;
  created_at: string;
}

export interface EventSignupRow {
  signup_id: string;
  player_id: string;
  player_name: string;
  telegram_chat_id: string;
  telegram_username: string | null;
  status: SignupStatus;
  responded_at: string | null;
  updated_at: string;
  invited_at: string | null;
  last_send_error: string | null;
}

export interface ScheduleConfigWithPreview extends ScheduleConfig {
  preview: {
    occurrence_date: string;
    starts_at: string;
    ends_at: string;
    deadline_at: string;
    invite_at: string;
  } | null;
}
