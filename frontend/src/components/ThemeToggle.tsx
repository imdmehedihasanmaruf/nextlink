'use client'

import React, { useEffect, useState } from 'react'
import { useTheme } from 'next-themes'
import { Sun, Moon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAuthStore } from '@/store/authStore'
import { useSettingsStore } from '@/store/settingsStore'
import { saveUserPreferences } from '@/lib/portalApi'

interface ThemeToggleProps {
  className?: string
  variant?: 'ghost' | 'outline' | 'default' | 'secondary'
  size?: 'default' | 'sm' | 'lg' | 'icon'
}

export function ThemeToggle({
  className = '',
  variant = 'ghost',
  size = 'icon',
}: ThemeToggleProps) {
  const { resolvedTheme, setTheme } = useTheme()
  const { user, isAuthenticated, updateUser } = useAuthStore()
  const { setTheme: setStoreTheme } = useSettingsStore()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    return (
      <Button
        variant={variant}
        size={size}
        className={`h-9 w-9 p-0 text-foreground transition-colors ${className}`}
        aria-label="Loading theme toggle"
        disabled
      >
        <span className="h-4 w-4 rounded-full bg-muted/60 animate-pulse" />
      </Button>
    )
  }

  const isDark = resolvedTheme === 'dark'

  const handleToggle = () => {
    const nextMode = isDark ? 'light' : 'dark'
    setTheme(nextMode)
    setStoreTheme(nextMode)
    try {
      localStorage.setItem('nl_theme', nextMode)
    } catch (e) {}

    if (isAuthenticated && user?.id) {
      try {
        localStorage.setItem('nl_user_theme', nextMode)
      } catch (e) {}
      updateUser({ theme: nextMode })
      saveUserPreferences({ theme: nextMode }).catch((err) => {
        console.warn('Failed to background save theme toggle to DB:', err)
      })
    }
  }

  return (
    <Button
      variant={variant}
      size={size}
      onClick={handleToggle}
      className={`h-9 w-9 p-0 text-foreground hover:bg-muted transition-colors cursor-pointer ${className}`}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      data-testid="theme-toggle-btn"
    >
      {isDark ? (
        <Sun className="h-4 w-4 text-amber-400 transition-transform hover:rotate-45" />
      ) : (
        <Moon className="h-4 w-4 text-slate-700 transition-transform hover:-rotate-12" />
      )}
      <span className="sr-only">{isDark ? 'Switch to light mode' : 'Switch to dark mode'}</span>
    </Button>
  )
}
export default ThemeToggle
