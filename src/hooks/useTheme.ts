/**
 * useTheme — Lightweight localStorage-backed theme management.
 * Manages two orthogonal axes:
 *   • mode:       'light' | 'dark' | 'system'
 *   • colorTheme: 'black' | 'blue' | 'orange' | 'green'
 *
 * Applies the corresponding CSS classes to <html>:
 *   • 'dark' for dark mode
 *   • 'theme-blue' / 'theme-orange' / 'theme-green' for color themes
 *   (no class for 'black' — that is the default)
 */
import { useCallback, useEffect, useState } from 'react';

export type ThemeMode = 'light' | 'dark' | 'system';
export type ColorTheme = 'black' | 'blue' | 'orange' | 'green';

const STORAGE_MODE_KEY = 'claw-switch-theme-mode';
const STORAGE_COLOR_KEY = 'claw-switch-theme-color';
const COLOR_CLASSES: Record<ColorTheme, string> = {
  black: '',
  blue: 'theme-blue',
  orange: 'theme-orange',
  green: 'theme-green',
};

function getStoredMode(): ThemeMode {
  const v = localStorage.getItem(STORAGE_MODE_KEY) as ThemeMode | null;
  return v === 'light' || v === 'dark' || v === 'system' ? v : 'system';
}

function getStoredColor(): ColorTheme {
  const v = localStorage.getItem(STORAGE_COLOR_KEY) as ColorTheme | null;
  return v === 'black' || v === 'blue' || v === 'orange' || v === 'green'
    ? v
    : 'black';
}

function applyDark(mode: ThemeMode) {
  const root = document.documentElement;
  if (mode === 'dark') {
    root.classList.add('dark');
  } else if (mode === 'light') {
    root.classList.remove('dark');
  } else {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    if (mq.matches) root.classList.add('dark');
    else root.classList.remove('dark');
  }
}

function applyColor(color: ColorTheme) {
  const root = document.documentElement;
  root.classList.remove('theme-blue', 'theme-orange', 'theme-green');
  const cls = COLOR_CLASSES[color];
  if (cls) root.classList.add(cls);
}

export function useTheme() {
  const [mode, setModeState] = useState<ThemeMode>(getStoredMode);
  const [colorTheme, setColorState] = useState<ColorTheme>(getStoredColor);

  // Apply on mount + whenever mode changes
  useEffect(() => {
    applyDark(mode);

    if (mode === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const handler = () => applyDark('system');
      mq.addEventListener('change', handler);
      return () => mq.removeEventListener('change', handler);
    }
  }, [mode]);

  // Apply color theme on mount + change
  useEffect(() => {
    applyColor(colorTheme);
  }, [colorTheme]);

  const setMode = useCallback((m: ThemeMode) => {
    localStorage.setItem(STORAGE_MODE_KEY, m);
    setModeState(m);
  }, []);

  const setColorTheme = useCallback((c: ColorTheme) => {
    localStorage.setItem(STORAGE_COLOR_KEY, c);
    setColorState(c);
  }, []);

  return { mode, colorTheme, setMode, setColorTheme };
}
