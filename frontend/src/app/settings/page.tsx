'use client'

import React, { useState } from 'react'
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
  Globe
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { useSettingsStore, useTranslation, SUPPORTED_LANGUAGES, ThemeColor, FontSize, Language, ThemeMode } from '@/store/settingsStore'

const colors: { name: ThemeColor; label: string; bg: string }[] = [
  { name: 'blue', label: 'Blue', bg: 'bg-blue-500' },
  { name: 'green', label: 'Green', bg: 'bg-emerald-500' },
  { name: 'purple', label: 'Purple', bg: 'bg-purple-500' },
  { name: 'red', label: 'Red', bg: 'bg-rose-500' },
  { name: 'orange', label: 'Orange', bg: 'bg-amber-500' },
]

export default function SettingsPage() {
  const { t, language } = useTranslation()
  const { 
    theme, 
    themeColor, 
    fontSize, 
    autoSave,
    setTheme, 
    setThemeColor, 
    setFontSize, 
    setLanguage, 
    setAutoSave 
  } = useSettingsStore()

  const [savedAlert, setSavedAlert] = useState(false)

  const handleManualSave = () => {
    setSavedAlert(true)
    setTimeout(() => setSavedAlert(false), 3000)
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl space-y-8">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight">
          {t('settings')}
        </h1>
        <p className="text-muted-foreground mt-1">
          Customize your portal experience with colors, fonts, worldwide languages, and preferences.
        </p>
      </div>

      {savedAlert && (
        <div className="rounded-xl border border-emerald-500/50 bg-emerald-500/10 p-4 text-emerald-600 dark:text-emerald-400 flex items-center gap-2 animate-in fade-in">
          <Check className="h-5 w-5" />
          <span>{t('savedSuccess')}</span>
        </div>
      )}

      {/* 1. Theme Mode (Dark/Light/System) */}
      <Card className="border shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sun className="h-5 w-5 text-primary" />
            {t('appearance')}
          </CardTitle>
          <CardDescription>
            Choose how NextLink displays on your screen
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4">
            <button
              onClick={() => setTheme('light')}
              className={`flex flex-col items-center justify-center p-4 rounded-xl border-2 transition-all ${
                theme === 'light' 
                  ? 'border-primary bg-primary/10 text-primary font-bold shadow-sm' 
                  : 'border-border hover:border-primary/50 text-muted-foreground'
              }`}
            >
              <Sun className="h-6 w-6 mb-2" />
              <span className="text-sm">{t('lightMode')}</span>
            </button>

            <button
              onClick={() => setTheme('dark')}
              className={`flex flex-col items-center justify-center p-4 rounded-xl border-2 transition-all ${
                theme === 'dark' 
                  ? 'border-primary bg-primary/10 text-primary font-bold shadow-sm' 
                  : 'border-border hover:border-primary/50 text-muted-foreground'
              }`}
            >
              <Moon className="h-6 w-6 mb-2" />
              <span className="text-sm">{t('darkMode')}</span>
            </button>

            <button
              onClick={() => setTheme('system')}
              className={`flex flex-col items-center justify-center p-4 rounded-xl border-2 transition-all ${
                theme === 'system' 
                  ? 'border-primary bg-primary/10 text-primary font-bold shadow-sm' 
                  : 'border-border hover:border-primary/50 text-muted-foreground'
              }`}
            >
              <Monitor className="h-6 w-6 mb-2" />
              <span className="text-sm">{t('systemMode')}</span>
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
              const isSelected = language === langItem.code
              return (
                <button
                  key={langItem.code}
                  onClick={() => setLanguage(langItem.code)}
                  className={`flex items-center gap-3 p-3 rounded-xl border-2 text-left transition-all ${
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
                key={color.name}
                onClick={() => setThemeColor(color.name)}
                className={`flex items-center gap-2.5 px-4 py-2.5 rounded-xl border-2 transition-all ${
                  themeColor === color.name
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
                key={size}
                onClick={() => setFontSize(size)}
                className={`flex flex-col items-center justify-center p-3 rounded-xl border-2 transition-all ${
                  fontSize === size
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
          <Switch checked={autoSave} onCheckedChange={setAutoSave} />
        </CardContent>
      </Card>

      {/* Manual Save Confirmation Action */}
      <div className="flex justify-end pt-4">
        <Button onClick={handleManualSave} size="lg" className="gap-2 font-bold shadow-lg">
          <Save className="h-5 w-5" />
          <span>{t('saveChanges')}</span>
        </Button>
      </div>
    </div>
  )
}
