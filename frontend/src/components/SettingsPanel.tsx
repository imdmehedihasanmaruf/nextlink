'use client'

import React, { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { X, Settings, Sun, Moon, Monitor, Check, Save, RotateCcw, AlertCircle, RefreshCw } from 'lucide-react'
import { useSettingsStore, useTranslation, SUPPORTED_LANGUAGES, ThemeColor, FontSize, ThemeMode, Language } from '@/store/settingsStore'
import { useAuthStore } from '@/store/authStore'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useTheme } from 'next-themes'
import { saveUserPreferences } from '@/lib/portalApi'

const themeColors: { value: ThemeColor; label: string; hex: string }[] = [
  { value: 'blue', label: 'Blue', hex: '#3b82f6' },
  { value: 'green', label: 'Green', hex: '#22c55e' },
  { value: 'purple', label: 'Purple', hex: '#a855f7' },
  { value: 'red', label: 'Red', hex: '#ef4444' },
  { value: 'orange', label: 'Orange', hex: '#f97316' },
]

const themeModes: { value: ThemeMode; icon: React.ReactNode; labelKey: 'lightMode' | 'darkMode' | 'systemMode' }[] = [
  { value: 'light', icon: <Sun size={14} />, labelKey: 'lightMode' },
  { value: 'dark', icon: <Moon size={14} />, labelKey: 'darkMode' },
  { value: 'system', icon: <Monitor size={14} />, labelKey: 'systemMode' },
]

const fontSizes: { value: FontSize; labelKey: 'small' | 'medium' | 'large' }[] = [
  { value: 'sm', labelKey: 'small' },
  { value: 'md', labelKey: 'medium' },
  { value: 'lg', labelKey: 'large' },
]

/**
 * Apply a live visual preview of a theme mode without writing to localStorage or the DB.
 */
function applyThemePreview(themeMode: ThemeMode) {
  if (typeof document === 'undefined') return
  let isDark = false
  if (themeMode === 'dark') {
    isDark = true
  } else if (themeMode === 'light') {
    isDark = false
  } else {
    isDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
  }
  if (isDark) {
    document.documentElement.classList.add('dark')
  } else {
    document.documentElement.classList.remove('dark')
  }
}

export function SettingsPanel() {
  const router = useRouter()
  const { user, isAuthenticated, updateUser } = useAuthStore()
  const [open, setOpen] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [mounted, setMounted] = useState(false)
  const { t } = useTranslation()
  const { setTheme: setNextTheme } = useTheme()
  const {
    theme, setTheme,
    themeColor, setThemeColor,
    fontSize, setFontSize,
    language, setLanguage,
    autoSave, setAutoSave,
  } = useSettingsStore()

  useEffect(() => {
    setMounted(true)
  }, [])

  // Authoritative saved theme: currently in localStorage / DB
  const [savedTheme, setSavedTheme] = useState<ThemeMode>(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('nl_user_theme') || localStorage.getItem('nl_theme')
      if (stored === 'light' || stored === 'dark' || stored === 'system') {
        return stored
      }
    }
    return (theme as ThemeMode) || 'system'
  })

  // Pending theme: in-memory preview only
  const [pendingTheme, setPendingTheme] = useState<ThemeMode>(savedTheme)
  const savedThemeRef = useRef<ThemeMode>(savedTheme)
  savedThemeRef.current = savedTheme

  // Local draft state for deferred options
  const [draftThemeColor, setDraftThemeColor] = useState<ThemeColor>(themeColor)
  const [draftFontSize, setDraftFontSize] = useState<FontSize>(fontSize)
  const [draftLanguage, setDraftLanguage] = useState<Language>(language)
  const [draftAutoSave, setDraftAutoSave] = useState<boolean>(autoSave)

  const wasOpen = useRef(false)

  // Synchronize when the drawer opens
  useEffect(() => {
    if (open && !wasOpen.current) {
      if (typeof window !== 'undefined') {
        const stored = (localStorage.getItem('nl_user_theme') || localStorage.getItem('nl_theme') || theme || 'system') as ThemeMode
        setSavedTheme(stored)
        setPendingTheme(stored)
      }
      setDraftThemeColor(themeColor)
      setDraftFontSize(fontSize)
      setDraftLanguage(language)
      setDraftAutoSave(autoSave)
      setSaveError(null)
    }
    wasOpen.current = open
  }, [open, theme, themeColor, fontSize, language, autoSave])

  // Revert preview back to savedTheme on unmount
  useEffect(() => {
    return () => {
      applyThemePreview(savedThemeRef.current)
    }
  }, [])

  // User picks a theme mode: live preview ONLY (temporary <html> class), NO write to storage/DB
  const handleThemePick = (chosen: ThemeMode) => {
    setPendingTheme(chosen)
    setSaveError(null)
    applyThemePreview(chosen)
  }

  // Close panel: revert uncommitted preview back to savedTheme
  const handleClose = () => {
    applyThemePreview(savedThemeRef.current)
    setPendingTheme(savedThemeRef.current)
    setDraftThemeColor(themeColor)
    setDraftFontSize(fontSize)
    setDraftLanguage(language)
    setDraftAutoSave(autoSave)
    setSaveError(null)
    setOpen(false)
  }

  // Reset / Cancel in drawer
  const handleResetToSaved = () => {
    setPendingTheme(savedTheme)
    applyThemePreview(savedTheme)
    setDraftThemeColor(themeColor)
    setDraftFontSize(fontSize)
    setDraftLanguage(language)
    setDraftAutoSave(autoSave)
    setSaveError(null)
  }

  // Save: commit to localStorage and DB (user preference via API)
  const handleSave = async () => {
    setSaving(true)
    setSaveError(null)

    try {
      const themeToSave = pendingTheme

      // 1. Permanently write to localStorage
      try {
        localStorage.setItem('nl_theme', themeToSave)
      } catch (e) {}

      // 2. Commit to next-themes and Zustand store
      setNextTheme(themeToSave)
      setTheme(themeToSave)
      setThemeColor(draftThemeColor)
      setFontSize(draftFontSize)
      setLanguage(draftLanguage)
      setAutoSave(draftAutoSave)

      // 3. If authenticated, persist to DB
      if (isAuthenticated && user?.id) {
        try {
          localStorage.setItem('nl_user_theme', themeToSave)
        } catch (e) {}
        updateUser({ theme: themeToSave })

        const res = await saveUserPreferences({
          theme: themeToSave,
          themeColor: draftThemeColor,
          fontSize: draftFontSize,
          language: draftLanguage,
          autoSave: draftAutoSave,
        })

        if (!res || res.success === false) {
          throw new Error(res?.error || 'Failed to save preferences to server')
        }
      }

      // Mark saved
      setSavedTheme(themeToSave)
      setSaved(true)
      setTimeout(() => {
        setSaved(false)
        setOpen(false)
      }, 1200)
    } catch (err: any) {
      console.error('Failed to save settings:', err)
      setSaveError(err.message || 'Failed to save changes. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const hasThemeChanges = pendingTheme !== savedTheme
  const hasUnsavedChanges = 
    hasThemeChanges || 
    draftThemeColor !== themeColor || 
    draftFontSize !== fontSize || 
    draftLanguage !== language || 
    draftAutoSave !== autoSave

  return (
    <>
      {/* Floating gear button */}
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-50 h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center hover:scale-110 transition-transform focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 cursor-pointer"
        aria-label="Open Settings"
        data-testid="settings-panel-toggle"
      >
        <Settings size={24} className={open ? 'animate-spin' : ''} />
      </button>

      {/* Overlay */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
          onClick={handleClose}
        />
      )}

      {/* Panel */}
      <div
        className={cn(
          'fixed top-0 right-0 z-50 h-full w-80 bg-background shadow-2xl border-l border-border overflow-y-auto transition-transform duration-300 flex flex-col',
          open ? 'translate-x-0' : 'translate-x-full'
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border bg-primary text-primary-foreground shrink-0">
          <div className="flex items-center gap-2">
            <Settings size={18} />
            <span className="font-semibold">{t('settingsTitle')}</span>
          </div>
          <button onClick={handleClose} className="rounded-full p-1 hover:bg-white/20 transition-colors cursor-pointer" aria-label="Close Settings">
            <X size={18} />
          </button>
        </div>

        <div className="p-4 space-y-6 flex-1">
          {hasUnsavedChanges && (
            <div
              aria-live="polite"
              className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 text-xs font-semibold flex items-center justify-between"
            >
              <span>Unsaved changes (Preview active)</span>
              <button 
                type="button" 
                onClick={handleResetToSaved}
                className="underline hover:opacity-80 cursor-pointer"
              >
                Reset
              </button>
            </div>
          )}

          {saveError && (
            <div className="p-2.5 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-xs font-semibold flex items-center justify-between gap-2">
              <span className="truncate">{saveError}</span>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="underline hover:opacity-80 cursor-pointer shrink-0"
              >
                Retry
              </button>
            </div>
          )}

          {/* Theme Mode - Preview live; only writes on Save */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground block">
                {t('appearance')}
              </Label>
              {hasThemeChanges && (
                <span className="text-[10px] font-bold text-primary px-1.5 py-0.5 rounded bg-primary/10">
                  Preview
                </span>
              )}
            </div>
            <div className="grid grid-cols-3 gap-1 bg-muted rounded-lg p-1" role="radiogroup" aria-label="Theme Mode">
              {themeModes.map(({ value, icon, labelKey }) => (
                <button
                  type="button"
                  key={value}
                  role="radio"
                  aria-checked={pendingTheme === value}
                  onClick={() => handleThemePick(value)}
                  className={cn(
                    'flex items-center justify-center gap-1.5 py-2 px-2 rounded-md text-xs font-medium transition-all cursor-pointer',
                    pendingTheme === value
                      ? 'bg-background text-foreground shadow-sm font-bold ring-1 ring-primary/30'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                  data-testid={`panel-theme-${value}`}
                >
                  {icon}
                  <span>{t(labelKey)}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Theme Color */}
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground mb-3 block">
              {t('themeColor')}
            </Label>
            <div className="flex items-center gap-3">
              {themeColors.map((c) => (
                <button
                  type="button"
                  key={c.value}
                  onClick={() => setDraftThemeColor(c.value)}
                  className={cn(
                    'h-9 w-9 rounded-full flex items-center justify-center transition-transform hover:scale-110 cursor-pointer',
                    draftThemeColor === c.value && 'ring-2 ring-offset-2 ring-primary scale-110'
                  )}
                  style={{ backgroundColor: c.hex }}
                  title={c.label}
                  aria-label={c.label}
                >
                  {draftThemeColor === c.value && <Check size={16} className="text-white drop-shadow" />}
                </button>
              ))}
            </div>
          </div>

          {/* Font Size */}
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground mb-2 block">
              {t('fontSize')}
            </Label>
            <div className="grid grid-cols-3 gap-1 bg-muted rounded-lg p-1">
              {fontSizes.map(({ value, labelKey }) => (
                <button
                  type="button"
                  key={value}
                  onClick={() => setDraftFontSize(value)}
                  className={cn(
                    'py-1.5 px-3 rounded-md text-xs font-medium transition-all cursor-pointer',
                    draftFontSize === value
                      ? 'bg-background text-foreground shadow-sm font-bold'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {t(labelKey)}
                </button>
              ))}
            </div>
          </div>

          {/* Language Selection */}
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground mb-2 block">
              {t('languageOption')}
            </Label>
            <div className="relative">
              <select
                value={draftLanguage}
                onChange={(e) => setDraftLanguage(e.target.value as Language)}
                className="w-full h-10 px-3 pr-8 rounded-lg border border-input bg-background text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring cursor-pointer"
                aria-label="Select Language"
              >
                {SUPPORTED_LANGUAGES.map((langItem) => (
                  <option key={langItem.code} value={langItem.code}>
                    {langItem.flag} {langItem.native} ({langItem.name})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Auto Save Toggle */}
          <div className="flex items-center justify-between pt-2 border-t border-border">
            <div className="space-y-0.5">
              <Label className="text-xs font-medium text-foreground">{t('autoSaveLabel')}</Label>
              <p className="text-[11px] text-muted-foreground">Keep drafts preserved across tabs</p>
            </div>
            <Switch
              checked={draftAutoSave}
              onCheckedChange={setDraftAutoSave}
            />
          </div>
        </div>

        {/* Footer actions: Cancel & Save */}
        <div className="p-4 border-t border-border bg-muted/40 flex items-center justify-between gap-2 shrink-0">
          {hasUnsavedChanges && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleResetToSaved}
              className="gap-1.5 text-xs cursor-pointer"
            >
              <RotateCcw size={14} />
              <span>Cancel</span>
            </Button>
          )}
          <Button
            onClick={handleSave}
            size="sm"
            disabled={!hasUnsavedChanges || saving}
            className={cn('gap-1.5 text-xs font-semibold cursor-pointer', !hasUnsavedChanges && 'w-full')}
          >
            {saving ? (
              <span>Saving...</span>
            ) : saved ? (
              <>
                <Check size={14} />
                <span>{t('savedSuccess')}</span>
              </>
            ) : (
              <>
                <Save size={14} />
                <span>{t('saveChanges')}</span>
              </>
            )}
          </Button>
        </div>
      </div>
    </>
  )
}
