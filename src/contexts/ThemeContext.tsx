import { createContext, useContext, type ReactNode } from 'react';
import { useTheme, type ThemeMode, type ColorTheme } from '@/hooks/useTheme';

interface ThemeContextValue {
  mode: ThemeMode;
  colorTheme: ColorTheme;
  setMode: (m: ThemeMode) => void;
  setColorTheme: (c: ColorTheme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return (
    <ThemeContext.Provider value={theme}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useThemeContext(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useThemeContext must be used inside ThemeProvider');
  return ctx;
}

export type { ThemeMode, ColorTheme };
