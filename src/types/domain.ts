export type MediaKind = 'channel' | 'movie' | 'series' | 'episode';

export interface Program {
  title: string;
  start: string;
  end: string;
  description?: string;
}

export interface MediaItem {
  id: string;
  kind: MediaKind;
  title: string;
  subtitle?: string;
  description: string;
  image: string;
  backdrop?: string;
  tags: string[];
  meta?: string;
  year?: number;
  durationMinutes?: number;
  /** 0–100. Demo/history data only; real progress comes from watch_history. */
  progress?: number;
  isLive?: boolean;
  channelNumber?: string;
  badge?: string;
  now?: Program;
  next?: Program;
}

export interface HeroSlide extends MediaItem {
  eyebrow: string;
  headline: string;
}

export interface ContentRow {
  id: string;
  title: string;
  items: MediaItem[];
}

export type PreferenceValue = string | boolean;

export interface Preferences {
  sidebarCollapsed: boolean;
  tvMode: boolean;
  density: 'comfortable' | 'compact';
  motion: 'full' | 'reduced';
  autoplay: boolean;
  autoReconnect: boolean;
  preferredPlayer: 'auto' | 'native' | 'hls' | 'shaka';
  fallbackPlayer: 'auto' | 'native' | 'hls' | 'shaka';
  language: string;
}
