import { create } from 'zustand';

export type Theme = 'auto' | 'dark' | 'light';

interface Settings {
  theme: Theme;
  macLabels: boolean;
  showCoords: boolean;
  devMode: boolean;
  update(patch: Partial<Omit<Settings, 'update'>>): void;
}

const KEY = 'gen75-studio:settings';

const defaults = { theme: 'auto' as Theme, macLabels: false, showCoords: false, devMode: false };

function load(): typeof defaults {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaults;
    const p = JSON.parse(raw) as Partial<typeof defaults>;
    return {
      theme: p.theme === 'dark' || p.theme === 'light' || p.theme === 'auto' ? p.theme : defaults.theme,
      macLabels: p.macLabels === true,
      showCoords: p.showCoords === true,
      devMode: p.devMode === true,
    };
  } catch {
    return defaults;
  }
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === 'auto') root.removeAttribute('data-theme');
  else root.dataset.theme = theme;
}

export const useSettings = create<Settings>((set, get) => ({
  ...load(),
  update(patch) {
    set(patch);
    const { theme, macLabels, showCoords, devMode } = get();
    try {
      localStorage.setItem(KEY, JSON.stringify({ theme, macLabels, showCoords, devMode }));
    } catch {
      /* penyimpanan tidak tersedia; pengaturan hanya berlaku selama sesi */
    }
  },
}));
