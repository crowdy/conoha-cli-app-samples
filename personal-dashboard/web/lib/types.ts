export interface ScheduleItem {
  id: string;
  source: "outlook" | "google";
  account_label: string;
  title: string;
  start_at: string; // ISO
  end_at: string;   // ISO
  all_day: boolean;
}

export interface Countdown {
  id: number;
  target_at: string; // ISO
  label: string;
  created_at: string;
}

export interface Weather {
  city_label: string;
  current_temp_c: number | null;
  current_condition: string;
  forecast_high_c: number | null;
  forecast_low_c: number | null;
  forecast_condition: string;
  fetched_at: string;
}

export interface Shortcut {
  label: string;
  icon: string;
  url: string;
}

export interface Brand {
  label: string;
}

export interface SectionEnvelope<T> {
  data: T;
  last_error?: string;
}
