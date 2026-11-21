import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Preferences } from '../types/domain';

const STORAGE_KEY = 'veyro.preferences.v1';

const defaults: Preferences = {
  sidebarCollapsed: false,
  tvMode: false,
  density: 'comfortable',
  motion: 'full',
  autoplay: true,
  autoReconnect: true,
  preferredPlayer: 'auto',
  fallbackPlayer: 'auto',
  language: 'en',
};

function load(): Preferences {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return defaults;
    return { ...defaults, ...(JSON.parse(stored) as Partial<Preferences>) };
  } catch {
    return defaults;
  }
}

interface PreferencesContextValue {
  preferences: Preferences;
  update: <K extends keyof Preferences>(key: K, value: Preferences[K]) => void;
  reset: () => void;
}

const PreferencesContext = createContext<PreferencesContextValue | null>(null);

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState<Preferences>(load);

  const update = useCallback(<K extends keyof Preferences>(key: K, value: Preferences[K]) => {
    setPreferences((current) => ({ ...current, [key]: value }));
  }, []);

  const reset = useCallback(() => setPreferences(defaults), []);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
    } catch {
      // Preferences are a convenience; storage may be unavailable in private mode.
    }
    const root = document.documentElement;
    root.dataset.density = preferences.density;
    root.dataset.motion = preferences.motion;
    root.dataset.tv = preferences.tvMode ? 'true' : 'false';
    root.dataset.sidebar = preferences.sidebarCollapsed ? 'collapsed' : 'expanded';
  }, [preferences]);

  const value = useMemo(() => ({ preferences, update, reset }), [preferences, update, reset]);

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences(): PreferencesContextValue {
  const context = useContext(PreferencesContext);
  if (!context) throw new Error('usePreferences must be used inside PreferencesProvider');
  return context;
}
