'use client'

import * as React from 'react'
import { ThemeProvider as NextThemesProvider } from 'next-themes'
import { useSettingsStore } from '@/store/settingsStore'
import { useMounted } from '@/lib/useMounted'

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
  // The server render has no access to the persisted theme. Passing a
  // non-system theme before mounting makes the server and the first client
  // render disagree, so the gate is required.
  const mounted = useMounted()

  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      forcedTheme={mounted && theme !== 'system' ? theme : undefined}
    >
      <ThemeColorApplier />
      {children}
    </NextThemesProvider>
  )
}
