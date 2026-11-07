'use client';
import { useEffect } from 'react';
import { ThemeProvider as NextThemesProvider } from 'next-themes';
import { useSettingsStore } from '@/store/settingsStore';

function ThemeApplicator({ children }: { children: React.ReactNode }) {
  const { themeColor, fontSize } = useSettingsStore();

  useEffect(() => {
    document.documentElement.setAttribute('data-color', themeColor);
  }, [themeColor]);

  useEffect(() => {
    document.documentElement.classList.remove('font-size-sm', 'font-size-md', 'font-size-lg');
    document.documentElement.classList.add(`font-size-${fontSize}`);
  }, [fontSize]);

  return <>{children}</>;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { theme } = useSettingsStore();

  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme={theme}
      enableSystem
      disableTransitionOnChange
    >
      <ThemeApplicator>{children}</ThemeApplicator>
    </NextThemesProvider>
  );
}
