'use client'

import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { X, Settings, Sun, Moon, Monitor, Check, Save, RotateCcw } from 'lucide-react'
import { useSettingsStore, useTranslation, SUPPORTED_LANGUAGES, ThemeColor, FontSize, ThemeMode, Language } from '@/store/settingsStore'
import { useAuthStore } from '@/store/authStore'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

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

export function SettingsPanel() {
  const router = useRouter()
  const { isAuthenticated } = useAuthStore()
  const [open, setOpen] = useState(false)
  const [saved, setSaved] = useState(false)
  const { t } = useTranslation()
  const {
    theme, setTheme,
    themeColor, setThemeColor,
    fontSize, setFontSize,
    language, setLanguage,
    autoSave, setAutoSave,
  } = useSettingsStore()

  // Local draft state — settings DO NOT apply globally until "Save Changes" is clicked
  const [draftTheme, setDraftTheme] = useState<ThemeMode>(theme)
  const [draftThemeColor, setDraftThemeColor] = useState<ThemeColor>(themeColor)
  const [draftFontSize, setDraftFontSize] = useState<FontSize>(fontSize)
  const [draftLanguage, setDraftLanguage] = useState<Language>(language)
  const [draftAutoSave, setDraftAutoSave] = useState<boolean>(autoSave)

  // Synchronize draft state when the panel opens — and only then. Depending
  // on the store values as well made the panel overwrite what the user was
  // editing, whenever something else in the app wrote to the store.
  const wasOpen = React.useRef(false)

  useEffect(() => {
    if (open && !wasOpen.current) {
      setDraftTheme(theme)
      setDraftThemeColor(themeColor)
      setDraftFontSize(fontSize)
      setDraftLanguage(language)
      setDraftAutoSave(autoSave)
    }
    wasOpen.current = open
    // The values are intentionally read at the moment the panel opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const handleClose = () => {
    // Revert draft changes back to saved settings when panel is closed without saving
    setDraftTheme(theme)
    setDraftThemeColor(themeColor)
    setDraftFontSize(fontSize)
    setDraftLanguage(language)
    setDraftAutoSave(autoSave)
    setOpen(false)
  }

  const handleResetToSaved = () => {
    setDraftTheme(theme)
    setDraftThemeColor(themeColor)
    setDraftFontSize(fontSize)
    setDraftLanguage(language)
    setDraftAutoSave(autoSave)
  }

  const handleSave = () => {
    // If user is not authenticated, redirect to login page and DO NOT save settings
    if (!isAuthenticated) {
      handleClose()
      router.push('/login?redirect=settings')
      return
    }

    // Only commit settings to global store when Save Changes is clicked by an authenticated user
    setTheme(draftTheme)
    setThemeColor(draftThemeColor)
    setFontSize(draftFontSize)
    setLanguage(draftLanguage)
    setAutoSave(draftAutoSave)

    setSaved(true)
    setTimeout(() => {
      setSaved(false)
      setOpen(false)
    }, 1200)
  }

  const hasUnsavedChanges = 
    draftTheme !== theme || 
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
            <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 text-xs font-semibold flex items-center justify-between">
              <span>Unsaved changes</span>
              <button 
                type="button" 
                onClick={handleResetToSaved}
                className="underline hover:opacity-80 cursor-pointer"
              >
                Reset
              </button>
            </div>
          )}

          {/* Theme Mode */}
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground mb-2 block">
              {t('appearance')}
            </Label>
            <div className="grid grid-cols-3 gap-1 bg-muted rounded-lg p-1">
              {themeModes.map(({ value, icon, labelKey }) => (
                <button
                  type="button"
                  key={value}
                  onClick={() => setDraftTheme(value)}
                  className={cn(
                    'flex items-center justify-center gap-1.5 py-2 px-2 rounded-md text-xs font-medium transition-all cursor-pointer',
                    draftTheme === value
                      ? 'bg-background text-foreground shadow-sm font-bold'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
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
            <div className="flex gap-2 flex-wrap">
              {themeColors.map(({ value, label, hex }) => (
                <button
                  type="button"
                  key={value}
                  onClick={() => setDraftThemeColor(value)}
                  title={label}
                  className={cn(
                    'h-9 w-9 rounded-full flex items-center justify-center transition-all border-2 cursor-pointer',
                    draftThemeColor === value ? 'border-foreground scale-110 shadow-md ring-2 ring-primary/40' : 'border-transparent hover:scale-105'
                  )}
                  style={{ backgroundColor: hex }}
                >
                  {draftThemeColor === value && <Check size={14} className="text-white" />}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-2 capitalize">
              Selected: {draftThemeColor}
            </p>
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
                    'py-2 px-2 rounded-md text-xs font-medium transition-all cursor-pointer',
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

          {/* Language Selection: All 22 Languages */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground block">
                {t('language')} (22 Languages)
              </Label>
              <span className="text-[10px] font-mono font-bold text-primary uppercase">Active: {draftLanguage}</span>
            </div>
            <div className="grid grid-cols-2 gap-1.5 max-h-48 overflow-y-auto p-1.5 bg-muted rounded-lg border border-border">
              {SUPPORTED_LANGUAGES.map((l) => (
                <button
                  type="button"
                  key={l.code}
                  onClick={() => setDraftLanguage(l.code)}
                  className={cn(
                    'flex items-center gap-1.5 py-1.5 px-2 rounded-md text-xs font-medium transition-all text-left truncate cursor-pointer',
                    draftLanguage === l.code
                      ? 'bg-primary text-primary-foreground font-bold shadow-sm'
                      : 'text-muted-foreground hover:bg-background hover:text-foreground'
                  )}
                >
                  <span className="text-sm">{l.flag}</span>
                  <span className="truncate">{l.name}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Auto Save */}
          <div className="flex items-start justify-between gap-4">
            <div>
              <Label htmlFor="autoSave" className="font-medium cursor-pointer">
                {t('autoSave')}
              </Label>
              <p className="text-xs text-muted-foreground mt-0.5">{t('autoSaveDesc')}</p>
            </div>
            <Switch
              id="autoSave"
              checked={draftAutoSave}
              onCheckedChange={setDraftAutoSave}
            />
          </div>

          {/* Save Changes button */}
          <div className="space-y-2 pt-2">
            {hasUnsavedChanges && (
              <Button 
                type="button" 
                variant="outline" 
                size="sm" 
                onClick={handleResetToSaved} 
                className="w-full gap-1.5 text-xs text-muted-foreground hover:text-foreground cursor-pointer"
              >
                <RotateCcw size={13} />
                <span>Reset to Saved</span>
              </Button>
            )}
            <Button 
              type="button" 
              className="w-full font-bold gap-2 shadow-md cursor-pointer" 
              onClick={handleSave}
            >
              {saved ? (
                <span className="flex items-center gap-2"><Check size={16} /> {t('settingsSaved') || 'Settings Saved!'}</span>
              ) : (
                <span className="flex items-center gap-2"><Save size={16} /> {t('saveChanges') || 'Save Changes'}</span>
              )}
            </Button>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border mt-auto shrink-0">
          <p className="text-xs text-muted-foreground text-center">
            NextLink ISP v1.0.0
          </p>
        </div>
      </div>
    </>
  )
}
