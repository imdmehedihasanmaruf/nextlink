'use client'

import React, { useState } from 'react'
import { X, Settings, Sun, Moon, Monitor, Check } from 'lucide-react'
import { useSettingsStore, useTranslation, SUPPORTED_LANGUAGES, ThemeColor, FontSize, ThemeMode } from '@/store/settingsStore'
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

  const handleSave = () => {
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <>
      {/* Floating gear button */}
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-50 h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center hover:scale-110 transition-transform focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
        aria-label="Open Settings"
      >
        <Settings size={24} className={open ? 'animate-spin' : ''} />
      </button>

      {/* Overlay */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Panel */}
      <div
        className={cn(
          'fixed top-0 right-0 z-50 h-full w-80 bg-background shadow-2xl border-l border-border overflow-y-auto transition-transform duration-300',
          open ? 'translate-x-0' : 'translate-x-full'
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border bg-primary text-primary-foreground">
          <div className="flex items-center gap-2">
            <Settings size={18} />
            <span className="font-semibold">{t('settingsTitle')}</span>
          </div>
          <button onClick={() => setOpen(false)} className="rounded-full p-1 hover:bg-white/20 transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="p-4 space-y-6">
          {/* Theme Mode */}
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground mb-2 block">
              {t('appearance')}
            </Label>
            <div className="grid grid-cols-3 gap-1 bg-muted rounded-lg p-1">
              {themeModes.map(({ value, icon, labelKey }) => (
                <button
                  key={value}
                  onClick={() => setTheme(value)}
                  className={cn(
                    'flex items-center justify-center gap-1.5 py-2 px-2 rounded-md text-xs font-medium transition-all',
                    theme === value
                      ? 'bg-background text-foreground shadow-sm'
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
                  key={value}
                  onClick={() => setThemeColor(value)}
                  title={label}
                  className={cn(
                    'h-9 w-9 rounded-full flex items-center justify-center transition-all border-2',
                    themeColor === value ? 'border-foreground scale-110' : 'border-transparent hover:scale-105'
                  )}
                  style={{ backgroundColor: hex }}
                >
                  {themeColor === value && <Check size={14} className="text-white" />}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-2 capitalize">
              Selected: {themeColor}
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
                  key={value}
                  onClick={() => setFontSize(value)}
                  className={cn(
                    'py-2 px-2 rounded-md text-xs font-medium transition-all',
                    fontSize === value
                      ? 'bg-background text-foreground shadow-sm'
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
              <span className="text-[10px] font-mono font-bold text-primary uppercase">Active: {language}</span>
            </div>
            <div className="grid grid-cols-2 gap-1.5 max-h-48 overflow-y-auto p-1.5 bg-muted rounded-lg border border-border">
              {SUPPORTED_LANGUAGES.map((l) => (
                <button
                  key={l.code}
                  onClick={() => setLanguage(l.code)}
                  className={cn(
                    'flex items-center gap-1.5 py-1.5 px-2 rounded-md text-xs font-medium transition-all text-left truncate',
                    language === l.code
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
              <Label htmlFor="autoSave" className="font-medium">
                {t('autoSave')}
              </Label>
              <p className="text-xs text-muted-foreground mt-0.5">{t('autoSaveDesc')}</p>
            </div>
            <Switch
              id="autoSave"
              checked={autoSave}
              onCheckedChange={setAutoSave}
            />
          </div>

          {/* Save button */}
          <Button className="w-full" onClick={handleSave}>
            {saved ? (
              <span className="flex items-center gap-2"><Check size={16} /> {t('settingsSaved')}</span>
            ) : (
              t('saveSettings')
            )}
          </Button>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border mt-auto">
          <p className="text-xs text-muted-foreground text-center">
            NextLink ISP v1.0.0
          </p>
        </div>
      </div>
    </>
  )
}
