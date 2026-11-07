'use client'

import * as React from 'react'
import { ThemeProvider as NextThemesProvider } from 'next-themes'
import { useSettingsStore } from '@/store/settingsStore'

function ThemeColorApplier() {
  const { themeColor, fontSize } = useSettingsStore()

  React.useEffect(() => {
    document.documentElement.setAttribute('data-color', themeColor)
  }, [themeColor])

  React.useEffect(() => {
    document.documentElement.classList.remove('font-size-sm', 'font-size-md', 'font-size-lg')
    document.documentElement.classList.add(`font-size-${fontSize}`)
  }, [fontSize])

  return null
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { theme } = useSettingsStore()

  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      forcedTheme={theme === 'system' ? undefined : theme}
    >
      <ThemeColorApplier />
      {children}
    </NextThemesProvider>
  )
}
