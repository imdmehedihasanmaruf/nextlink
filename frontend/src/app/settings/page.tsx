'use client'

import React, { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useTheme } from 'next-themes'
import { 
  Sun, 
  Moon, 
  Monitor, 
  Palette, 
  Type, 
  Languages, 
  Save, 
  Check, 
  Sparkles,
  ShieldCheck,
  Bell,
  Globe,
  RotateCcw,
  AlertCircle,
  RefreshCw
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { useSettingsStore, useTranslation, SUPPORTED_LANGUAGES, ThemeColor, FontSize, Language, ThemeMode } from '@/store/settingsStore'
import { useAuthStore } from '@/store/authStore'
import { saveUserPreferences } from '@/lib/portalApi'

const colors: { name: ThemeColor; label: string; bg: string }[] = [
  { name: 'blue', label: 'Blue', bg: 'bg-blue-500' },
  { name: 'green', label: 'Green', bg: 'bg-emerald-500' },
  { name: 'purple', label: 'Purple', bg: 'bg-purple-500' },
  { name: 'red', label: 'Red', bg: 'bg-rose-500' },
  { name: 'orange', label: 'Orange', bg: 'bg-amber-500' },
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

export default function SettingsPage() {
  const router = useRouter()
  const { user, isAuthenticated, updateUser } = useAuthStore()
  const { t, language } = useTranslation()
  const { theme: nextTheme, setTheme: setNextTheme } = useTheme()
  const { 
    theme, 
    themeColor, 
    fontSize, 
    autoSave,
    setTheme: setStoreTheme, 
    setThemeColor, 
    setFontSize, 
    setLanguage, 
    setAutoSave 
  } = useSettingsStore()

  // Authoritative saved theme: what is currently stored in localStorage / DB
  const [savedTheme, setSavedTheme] = useState<ThemeMode>(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('nl_user_theme') || localStorage.getItem('nl_theme')
      if (stored === 'light' || stored === 'dark' || stored === 'system') {
        return stored
      }
    }
    return (theme as ThemeMode) || 'system'
  })

  // Pending theme: what the user has clicked in the Appearance form but NOT saved yet
  const [pendingTheme, setPendingTheme] = useState<ThemeMode>(savedTheme)
  const savedThemeRef = useRef<ThemeMode>(savedTheme)
  savedThemeRef.current = savedTheme

  // Local draft state for other deferred settings (Theme Color, Font Size, Language, AutoSave)
  const [draftThemeColor, setDraftThemeColor] = useState<ThemeColor>(themeColor)
  const [draftFontSize, setDraftFontSize] = useState<FontSize>(fontSize)
  const [draftLanguage, setDraftLanguage] = useState<Language>(language)
  const [draftAutoSave, setDraftAutoSave] = useState<boolean>(autoSave)

  const [saving, setSaving] = useState(false)
  const [savedAlert, setSavedAlert] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // Sync draft states when store loads
  useEffect(() => {
    setDraftThemeColor(themeColor)
    setDraftFontSize(fontSize)
    setDraftLanguage(language)
    setDraftAutoSave(autoSave)
  }, [themeColor, fontSize, language, autoSave])

  // If store theme updates from outside, sync savedTheme if clean
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const stored = (localStorage.getItem('nl_user_theme') || localStorage.getItem('nl_theme') || theme || 'system') as ThemeMode
      setSavedTheme(stored)
      setPendingTheme((prev) => (prev === savedThemeRef.current ? stored : prev))
    }
  }, [theme])

  // REVERT UNCOMMITTED PREVIEW ON UNMOUNT OR NAVIGATION AWAY
  useEffect(() => {
    const handleBeforeUnload = () => {
      applyThemePreview(savedThemeRef.current)
    }
    window.addEventListener('beforeunload', handleBeforeUnload)

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
      // Discard unsaved preview when navigating to another page
      applyThemePreview(savedThemeRef.current)
    }
  }, [])

  // User picks another option: live preview ONLY (temporary <html> class), NO write to storage/DB
  const handleThemePick = (chosen: ThemeMode) => {
    setPendingTheme(chosen)
    setSaveError(null)
    applyThemePreview(chosen)
  }

  // Cancel / Reset: discard pendingTheme and revert UI to savedTheme immediately
  const handleResetToSaved = () => {
    setPendingTheme(savedTheme)
    applyThemePreview(savedTheme)
    setDraftThemeColor(themeColor)
    setDraftFontSize(fontSize)
    setDraftLanguage(language)
    setDraftAutoSave(autoSave)
    setSaveError(null)
  }

  // Save button: write to localStorage and DB (user preference via API)
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
      setStoreTheme(themeToSave)
      setThemeColor(draftThemeColor)
      setFontSize(draftFontSize)
      setLanguage(draftLanguage)
      setAutoSave(draftAutoSave)

      // 3. If authenticated, persist to database via API
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
      setSavedAlert(true)
      setTimeout(() => setSavedAlert(false), 3000)
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
    <div className="container mx-auto px-4 py-8 max-w-4xl space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">
            {t('settings')}
          </h1>
          <p className="text-muted-foreground mt-1">
            Customize your portal experience with colors, fonts, worldwide languages, and preferences.
          </p>
        </div>

        {hasUnsavedChanges && (
          <div
            aria-live="polite"
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 text-xs font-semibold border border-amber-500/20"
          >
            <span>Unsaved Changes</span>
          </div>
        )}
      </div>

      {savedAlert && (
        <div className="rounded-xl border border-emerald-500/50 bg-emerald-500/10 p-4 text-emerald-600 dark:text-emerald-400 flex items-center gap-2 animate-in fade-in">
          <Check className="h-5 w-5" />
          <span>{t('savedSuccess')} (Theme saved)</span>
        </div>
      )}

      {saveError && (
        <div className="rounded-xl border border-destructive/50 bg-destructive/10 p-4 text-destructive flex items-center justify-between gap-3 animate-in fade-in">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 shrink-0" />
            <span className="text-sm font-medium">{saveError}</span>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleSave}
            disabled={saving}
            className="gap-1.5 text-xs font-semibold cursor-pointer shrink-0"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>Retry</span>
          </Button>
        </div>
      )}

      {/* 1. Theme Mode (Dark/Light/System) - Live Preview until Save */}
      <Card className="border shadow-sm">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2">
                <Sun className="h-5 w-5 text-primary" />
                {t('appearance')}
              </CardTitle>
              <CardDescription>
                Choose how NextLink displays on your screen. Preview live; applies permanently only after clicking Save.
              </CardDescription>
            </div>
            {hasThemeChanges && (
              <span className="text-xs px-2.5 py-1 rounded-full bg-primary/10 text-primary font-semibold border border-primary/20">
                Live Preview
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4" role="radiogroup" aria-label="Appearance Mode">
            <button
              type="button"
              role="radio"
              aria-checked={pendingTheme === 'light'}
              onClick={() => handleThemePick('light')}
              className={`flex flex-col items-center justify-center p-4 rounded-xl border-2 transition-all cursor-pointer ${
                pendingTheme === 'light' 
                  ? 'border-primary bg-primary/10 text-primary font-bold shadow-sm ring-2 ring-primary/20' 
                  : 'border-border hover:border-primary/50 text-muted-foreground'
              }`}
              data-testid="theme-option-light"
            >
              <Sun className="h-6 w-6 mb-2" />
              <span className="text-sm">{t('lightMode')}</span>
              {pendingTheme === 'light' && (
                <span className="mt-1 text-[11px] font-semibold text-primary">
                  {pendingTheme === savedTheme ? 'Active' : 'Preview'}
                </span>
              )}
            </button>

            <button
              type="button"
              role="radio"
              aria-checked={pendingTheme === 'dark'}
              onClick={() => handleThemePick('dark')}
              className={`flex flex-col items-center justify-center p-4 rounded-xl border-2 transition-all cursor-pointer ${
                pendingTheme === 'dark' 
                  ? 'border-primary bg-primary/10 text-primary font-bold shadow-sm ring-2 ring-primary/20' 
                  : 'border-border hover:border-primary/50 text-muted-foreground'
              }`}
              data-testid="theme-option-dark"
            >
              <Moon className="h-6 w-6 mb-2" />
              <span className="text-sm">{t('darkMode')}</span>
              {pendingTheme === 'dark' && (
                <span className="mt-1 text-[11px] font-semibold text-primary">
                  {pendingTheme === savedTheme ? 'Active' : 'Preview'}
                </span>
              )}
            </button>

            <button
              type="button"
              role="radio"
              aria-checked={pendingTheme === 'system'}
              onClick={() => handleThemePick('system')}
              className={`flex flex-col items-center justify-center p-4 rounded-xl border-2 transition-all cursor-pointer ${
                pendingTheme === 'system' 
                  ? 'border-primary bg-primary/10 text-primary font-bold shadow-sm ring-2 ring-primary/20' 
                  : 'border-border hover:border-primary/50 text-muted-foreground'
              }`}
              data-testid="theme-option-system"
            >
              <Monitor className="h-6 w-6 mb-2" />
              <span className="text-sm">{t('systemMode')}</span>
              {pendingTheme === 'system' && (
                <span className="mt-1 text-[11px] font-semibold text-primary">
                  {pendingTheme === savedTheme ? 'Active' : 'Preview'}
                </span>
              )}
            </button>
          </div>
        </CardContent>
      </Card>

      {/* 2. Language Selection (Requirement 20: 22 Languages) */}
      <Card className="border shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5 text-primary" />
            {t('languageOption')} (22 Worldwide Languages)
          </CardTitle>
          <CardDescription>
            Select your preferred international language to dynamically translate the subscriber portal
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {SUPPORTED_LANGUAGES.map((langItem) => {
              const isSelected = draftLanguage === langItem.code
              return (
                <button
                  type="button"
                  key={langItem.code}
                  onClick={() => setDraftLanguage(langItem.code)}
                  className={`flex items-center gap-3 p-3 rounded-xl border-2 text-left transition-all cursor-pointer ${
                    isSelected
                      ? 'border-primary bg-primary/10 shadow-sm'
                      : 'border-border hover:border-primary/40'
                  }`}
                >
                  <span className="text-2xl">{langItem.flag}</span>
                  <div className="min-w-0">
                    <p className={`text-sm font-semibold truncate ${isSelected ? 'text-primary' : 'text-foreground'}`}>
                      {langItem.native}
                    </p>
                    <p className="text-[11px] text-muted-foreground uppercase font-mono">
                      {langItem.code}
                    </p>
                  </div>
                </button>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {/* 3. Accent Color Scheme */}
      <Card className="border shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Palette className="h-5 w-5 text-primary" />
            Theme Color Accent
          </CardTitle>
          <CardDescription>Select the primary interface accent hue</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4">
            {colors.map((color) => (
              <button
                type="button"
                key={color.name}
                onClick={() => setDraftThemeColor(color.name)}
                className={`flex items-center gap-2.5 px-4 py-2.5 rounded-xl border-2 transition-all cursor-pointer ${
                  draftThemeColor === color.name
                    ? 'border-primary shadow-sm bg-primary/5 font-bold'
                    : 'border-border hover:border-muted-foreground/30'
                }`}
              >
                <div className={`h-4 w-4 rounded-full ${color.bg}`} />
                <span className="text-sm capitalize">{color.label}</span>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* 4. Font Size Scale */}
      <Card className="border shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Type className="h-5 w-5 text-primary" />
            Font Scale
          </CardTitle>
          <CardDescription>Adjust text readability across all pages</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4">
            {[
              { size: 'sm' as FontSize, label: 'Compact' },
              { size: 'md' as FontSize, label: 'Default' },
              { size: 'lg' as FontSize, label: 'Large' },
            ].map(({ size, label }) => (
              <button
                type="button"
                key={size}
                onClick={() => setDraftFontSize(size)}
                className={`flex flex-col items-center justify-center p-3 rounded-xl border-2 transition-all cursor-pointer ${
                  draftFontSize === size
                    ? 'border-primary bg-primary/10 text-primary font-bold shadow-sm'
                    : 'border-border hover:border-primary/50 text-muted-foreground'
                }`}
              >
                <span className={`font-semibold ${size === 'sm' ? 'text-xs' : size === 'lg' ? 'text-base' : 'text-sm'}`}>
                  {label}
                </span>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* 5. Auto Save Preference */}
      <Card className="border shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            {t('autoSaveLabel')}
          </CardTitle>
          <CardDescription>Automatically persist draft tickets, applications, and form inputs</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label className="text-base font-semibold">Continuous Form Backup</Label>
            <p className="text-xs text-muted-foreground">Keep your typed data safe even after unexpected tab refresh.</p>
          </div>
          <Switch checked={draftAutoSave} onCheckedChange={setDraftAutoSave} />
        </CardContent>
      </Card>

      {/* Actions: Cancel & Save */}
      <div className="flex justify-end items-center gap-3 pt-4">
        {hasUnsavedChanges && (
          <Button 
            type="button" 
            variant="outline" 
            onClick={handleResetToSaved}
            className="gap-2 font-medium cursor-pointer"
          >
            <RotateCcw className="h-4 w-4" />
            <span>Cancel</span>
          </Button>
        )}
        <Button 
          onClick={handleSave} 
          size="lg" 
          disabled={!hasUnsavedChanges || saving}
          className="gap-2 font-bold shadow-lg cursor-pointer"
          data-testid="settings-save-button"
        >
          <Save className="h-5 w-5" />
          <span>{saving ? 'Saving...' : t('saveChanges')}</span>
        </Button>
      </div>
    </div>
  )
}
