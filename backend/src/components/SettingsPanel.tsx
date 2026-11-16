'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Settings, X, Sun, Moon, Monitor, Check, Sliders, Globe, Save, RotateCcw } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useSettingsStore, SUPPORTED_LANGUAGES, type ThemeColor, type FontSize, type Language, type ThemeMode } from '@/store/settingsStore';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import toast from 'react-hot-toast';

const themeColors: { value: ThemeColor; label: string; color: string }[] = [
  { value: 'blue', label: 'Blue', color: '#3b82f6' },
  { value: 'green', label: 'Green', color: '#22c55e' },
  { value: 'purple', label: 'Purple', color: '#a855f7' },
  { value: 'red', label: 'Red', color: '#ef4444' },
  { value: 'orange', label: 'Orange', color: '#f97316' },
];

const fontSizes: { value: FontSize; label: string }[] = [
  { value: 'sm', label: 'Small (13px)' },
  { value: 'md', label: 'Medium (15px)' },
  { value: 'lg', label: 'Large (17px)' },
];

/**
 * Apply live visual preview of admin theme mode without persisting to storage or DB
 */
function applyAdminThemePreview(themeMode: ThemeMode) {
  if (typeof document === 'undefined') return;
  let isDark = false;
  if (themeMode === 'dark') {
    isDark = true;
  } else if (themeMode === 'light') {
    isDark = false;
  } else {
    isDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  if (isDark) {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
}

export function SettingsPanel() {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const { setTheme: setNextTheme } = useTheme();
  const { 
    theme, 
    themeColor, 
    fontSize, 
    language, 
    autoSave, 
    setTheme: setStoreTheme, 
    setThemeColor, 
    setFontSize, 
    setLanguage, 
    setAutoSave 
  } = useSettingsStore();

  // Authoritative saved theme: what is currently stored in localStorage / DB
  const [savedTheme, setSavedTheme] = useState<ThemeMode>(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('nl_admin_user_theme') || localStorage.getItem('nl_admin_theme');
      if (stored === 'light' || stored === 'dark' || stored === 'system') {
        return stored as ThemeMode;
      }
    }
    return (theme as ThemeMode) || 'system';
  });

  // Pending theme: in-memory preview only
  const [pendingTheme, setPendingTheme] = useState<ThemeMode>(savedTheme);
  const savedThemeRef = useRef<ThemeMode>(savedTheme);
  savedThemeRef.current = savedTheme;

  // Local draft states for color, font size, language
  const [draftThemeColor, setDraftThemeColor] = useState<ThemeColor>(themeColor);
  const [draftFontSize, setDraftFontSize] = useState<FontSize>(fontSize);
  const [draftLanguage, setDraftLanguage] = useState<Language>(language);
  const [draftAutoSave, setDraftAutoSave] = useState<boolean>(autoSave);

  const wasOpen = useRef(false);

  // Synchronize when the drawer opens
  useEffect(() => {
    if (open && !wasOpen.current) {
      if (typeof window !== 'undefined') {
        const stored = (localStorage.getItem('nl_admin_user_theme') || localStorage.getItem('nl_admin_theme') || theme || 'system') as ThemeMode;
        setSavedTheme(stored);
        setPendingTheme(stored);
      }
      setDraftThemeColor(themeColor);
      setDraftFontSize(fontSize);
      setDraftLanguage(language);
      setDraftAutoSave(autoSave);
    }
    wasOpen.current = open;
  }, [open, theme, themeColor, fontSize, language, autoSave]);

  // Revert preview on unmount
  useEffect(() => {
    return () => {
      applyAdminThemePreview(savedThemeRef.current);
    };
  }, []);

  // Pick theme mode: live preview ONLY (no storage/DB write)
  const handleThemePick = (chosen: ThemeMode) => {
    setPendingTheme(chosen);
    applyAdminThemePreview(chosen);
  };

  // Close panel without saving: revert preview back to savedTheme
  const handleClose = () => {
    applyAdminThemePreview(savedThemeRef.current);
    setPendingTheme(savedThemeRef.current);
    setDraftThemeColor(themeColor);
    setDraftFontSize(fontSize);
    setDraftLanguage(language);
    setDraftAutoSave(autoSave);
    setOpen(false);
  };

  // Cancel / Reset button
  const handleReset = () => {
    setPendingTheme(savedTheme);
    applyAdminThemePreview(savedTheme);
    setDraftThemeColor(themeColor);
    setDraftFontSize(fontSize);
    setDraftLanguage(language);
    setDraftAutoSave(autoSave);
  };

  // Save button: persist to localStorage & store
  const handleSave = () => {
    setSaving(true);
    try {
      const themeToSave = pendingTheme;
      localStorage.setItem('nl_admin_theme', themeToSave);
      setNextTheme(themeToSave);
      setStoreTheme(themeToSave);

      setThemeColor(draftThemeColor);
      setFontSize(draftFontSize);
      setLanguage(draftLanguage);
      setAutoSave(draftAutoSave);

      setSavedTheme(themeToSave);
      toast.success('Theme saved successfully!');
      setTimeout(() => {
        setSaving(false);
        setOpen(false);
      }, 600);
    } catch (err: any) {
      setSaving(false);
      toast.error('Failed to save settings: ' + (err.message || 'Unknown error'));
    }
  };

  const hasThemeChanges = pendingTheme !== savedTheme;
  const hasUnsavedChanges = 
    hasThemeChanges || 
    draftThemeColor !== themeColor || 
    draftFontSize !== fontSize || 
    draftLanguage !== language || 
    draftAutoSave !== autoSave;

  return (
    <>
      {/* Floating gear button */}
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-40 flex h-12 w-12 items-center justify-center rounded-full shadow-lg bg-primary text-white hover:bg-primary-dark transition-colors cursor-pointer"
        title="Settings & Languages"
        aria-label="Open Settings"
        data-testid="admin-settings-panel-toggle"
      >
        <Settings className="h-5 w-5" />
      </button>

      {/* Panel */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-end">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-xs" onClick={handleClose} />
          <aside className="relative z-10 h-full sm:h-auto sm:max-h-[92vh] w-88 bg-card border-l sm:border sm:rounded-2xl shadow-2xl flex flex-col overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between border-b p-4 bg-muted/20">
              <div className="flex items-center gap-2">
                <Sliders className="h-5 w-5 text-primary" />
                <span className="font-bold text-base">Display & Regional Settings</span>
              </div>
              <button onClick={handleClose} className="rounded-md p-1 hover:bg-accent text-muted-foreground cursor-pointer" aria-label="Close Settings">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-6">
              {hasUnsavedChanges && (
                <div
                  aria-live="polite"
                  className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 text-xs font-semibold flex items-center justify-between"
                >
                  <span>Unsaved changes (Preview active)</span>
                  <button 
                    type="button" 
                    onClick={handleReset}
                    className="underline hover:opacity-80 cursor-pointer"
                  >
                    Reset
                  </button>
                </div>
              )}

              {/* Theme Mode - Preview live; only writes on Save */}
              <section>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                    Appearance Mode
                  </h3>
                  {hasThemeChanges && (
                    <span className="text-[10px] font-bold text-primary px-1.5 py-0.5 rounded bg-primary/10">
                      Live Preview
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Admin Theme Mode">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={pendingTheme === 'light'}
                    onClick={() => handleThemePick('light')}
                    className={cn(
                      'flex flex-col items-center gap-1.5 rounded-xl border p-2.5 text-xs transition-colors cursor-pointer',
                      pendingTheme === 'light' ? 'border-primary bg-primary/10 text-primary font-bold shadow-xs' : 'hover:bg-accent'
                    )}
                    data-testid="admin-panel-theme-light"
                  >
                    <Sun className="h-4 w-4" />
                    <span>Light</span>
                    {pendingTheme === 'light' && (
                      <span className="text-[9px] text-primary">{pendingTheme === savedTheme ? 'Active' : 'Preview'}</span>
                    )}
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={pendingTheme === 'dark'}
                    onClick={() => handleThemePick('dark')}
                    className={cn(
                      'flex flex-col items-center gap-1.5 rounded-xl border p-2.5 text-xs transition-colors cursor-pointer',
                      pendingTheme === 'dark' ? 'border-primary bg-primary/10 text-primary font-bold shadow-xs' : 'hover:bg-accent'
                    )}
                    data-testid="admin-panel-theme-dark"
                  >
                    <Moon className="h-4 w-4" />
                    <span>Dark</span>
                    {pendingTheme === 'dark' && (
                      <span className="text-[9px] text-primary">{pendingTheme === savedTheme ? 'Active' : 'Preview'}</span>
                    )}
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={pendingTheme === 'system'}
                    onClick={() => handleThemePick('system')}
                    className={cn(
                      'flex flex-col items-center gap-1.5 rounded-xl border p-2.5 text-xs transition-colors cursor-pointer',
                      pendingTheme === 'system' ? 'border-primary bg-primary/10 text-primary font-bold shadow-xs' : 'hover:bg-accent'
                    )}
                    data-testid="admin-panel-theme-system"
                  >
                    <Monitor className="h-4 w-4" />
                    <span>System</span>
                    {pendingTheme === 'system' && (
                      <span className="text-[9px] text-primary">{pendingTheme === savedTheme ? 'Active' : 'Preview'}</span>
                    )}
                  </button>
                </div>
              </section>

              {/* Theme Color */}
              <section>
                <h3 className="mb-3 text-xs font-bold text-muted-foreground uppercase tracking-wider">
                  Accent Color
                </h3>
                <div className="grid grid-cols-5 gap-2">
                  {themeColors.map((c) => (
                    <button
                      type="button"
                      key={c.value}
                      onClick={() => setDraftThemeColor(c.value)}
                      className={cn(
                        'flex flex-col items-center gap-1 rounded-xl border p-2 text-xs transition-colors cursor-pointer',
                        draftThemeColor === c.value ? 'border-primary bg-primary/10 font-bold' : 'hover:bg-accent'
                      )}
                    >
                      <span className="flex h-5 w-5 items-center justify-center rounded-full text-white shadow-sm" style={{ backgroundColor: c.color }}>
                        {draftThemeColor === c.value && <Check className="h-3 w-3 stroke-[3]" />}
                      </span>
                      <span className="text-[10px] capitalize">{c.label}</span>
                    </button>
                  ))}
                </div>
              </section>

              {/* Font Size */}
              <section>
                <h3 className="mb-3 text-xs font-bold text-muted-foreground uppercase tracking-wider">
                  Text Scaling
                </h3>
                <div className="grid grid-cols-3 gap-2">
                  {fontSizes.map((f) => (
                    <button
                      type="button"
                      key={f.value}
                      onClick={() => setDraftFontSize(f.value)}
                      className={cn(
                        'rounded-xl border p-2 text-xs transition-colors text-center cursor-pointer',
                        draftFontSize === f.value ? 'border-primary bg-primary/10 text-primary font-bold' : 'hover:bg-accent'
                      )}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </section>

              {/* 22 Supported Languages */}
              <section>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                    <Globe className="h-3.5 w-3.5 text-primary" />
                    22 Languages Supported
                  </h3>
                  <span className="text-[10px] font-mono font-bold text-primary px-1.5 py-0.5 rounded bg-primary/10 uppercase">
                    {draftLanguage}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-1.5 max-h-48 overflow-y-auto pr-1 border rounded-xl p-2 bg-muted/20">
                  {SUPPORTED_LANGUAGES.map((l) => (
                    <button
                      type="button"
                      key={l.code}
                      onClick={() => setDraftLanguage(l.code)}
                      className={cn(
                        'flex items-center gap-1.5 rounded-lg border p-1.5 text-left text-xs transition-colors cursor-pointer',
                        draftLanguage === l.code ? 'border-primary bg-primary/10 text-primary font-bold' : 'hover:bg-accent bg-card'
                      )}
                    >
                      <span className="text-base">{l.flag}</span>
                      <span className="truncate">{l.name}</span>
                    </button>
                  ))}
                </div>
              </section>

              {/* Auto Save */}
              <section className="flex items-center justify-between rounded-xl border p-3.5 bg-muted/20">
                <div>
                  <Label htmlFor="auto-save" className="text-xs font-bold">
                    Auto Save Active
                  </Label>
                  <p className="text-[11px] text-muted-foreground">
                    Persist form changes in real-time
                  </p>
                </div>
                <Switch id="auto-save" checked={draftAutoSave} onCheckedChange={setDraftAutoSave} />
              </section>
            </div>

            {/* Footer actions: Cancel & Save */}
            <div className="p-4 border-t border-border bg-muted/30 flex items-center justify-between gap-2 shrink-0">
              {hasUnsavedChanges && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleReset}
                  className="gap-1.5 text-xs cursor-pointer"
                >
                  <RotateCcw size={14} />
                  <span>Cancel</span>
                </Button>
              )}
              <Button
                type="button"
                onClick={handleSave}
                size="sm"
                disabled={!hasUnsavedChanges || saving}
                className={cn('gap-1.5 text-xs font-semibold cursor-pointer', !hasUnsavedChanges && 'w-full')}
              >
                <Save size={14} />
                <span>{saving ? 'Saving...' : 'Save Changes'}</span>
              </Button>
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
