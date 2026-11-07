'use client';
import { useState } from 'react';
import { Settings, X, Sun, Moon, Monitor, Check, Sliders, Globe } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useSettingsStore, SUPPORTED_LANGUAGES, type ThemeColor, type FontSize, type Language } from '@/store/settingsStore';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

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

export function SettingsPanel() {
  const [open, setOpen] = useState(false);
  const { setTheme } = useTheme();
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

  const handleTheme = (t: 'light' | 'dark' | 'system') => {
    setStoreTheme(t);
    setTheme(t);
  };

  return (
    <>
      {/* Floating gear button */}
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-40 flex h-12 w-12 items-center justify-center rounded-full shadow-lg bg-primary text-white hover:bg-primary-dark transition-colors"
        title="Settings & Languages"
        aria-label="Open Settings"
      >
        <Settings className="h-5 w-5" />
      </button>

      {/* Panel */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-end">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <aside className="relative z-10 h-full sm:h-auto sm:max-h-[92vh] w-88 bg-card border-l sm:border sm:rounded-2xl shadow-2xl flex flex-col overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between border-b p-4 bg-muted/20">
              <div className="flex items-center gap-2">
                <Sliders className="h-5 w-5 text-primary" />
                <span className="font-bold text-base">Display & Regional Settings</span>
              </div>
              <button onClick={() => setOpen(false)} className="rounded-md p-1 hover:bg-accent text-muted-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-6">
              {/* Theme Mode */}
              <section>
                <h3 className="mb-3 text-xs font-bold text-muted-foreground uppercase tracking-wider">
                  Appearance Mode
                </h3>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    onClick={() => handleTheme('light')}
                    className={cn(
                      'flex flex-col items-center gap-1.5 rounded-xl border p-2.5 text-xs transition-colors',
                      theme === 'light' ? 'border-primary bg-primary/10 text-primary font-bold' : 'hover:bg-accent'
                    )}
                  >
                    <Sun className="h-4 w-4" />
                    Light
                  </button>
                  <button
                    onClick={() => handleTheme('dark')}
                    className={cn(
                      'flex flex-col items-center gap-1.5 rounded-xl border p-2.5 text-xs transition-colors',
                      theme === 'dark' ? 'border-primary bg-primary/10 text-primary font-bold' : 'hover:bg-accent'
                    )}
                  >
                    <Moon className="h-4 w-4" />
                    Dark
                  </button>
                  <button
                    onClick={() => handleTheme('system')}
                    className={cn(
                      'flex flex-col items-center gap-1.5 rounded-xl border p-2.5 text-xs transition-colors',
                      theme === 'system' ? 'border-primary bg-primary/10 text-primary font-bold' : 'hover:bg-accent'
                    )}
                  >
                    <Monitor className="h-4 w-4" />
                    System
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
                      key={c.value}
                      onClick={() => setThemeColor(c.value)}
                      className={cn(
                        'flex flex-col items-center gap-1 rounded-xl border p-2 text-xs transition-colors',
                        themeColor === c.value ? 'border-primary bg-primary/10 font-bold' : 'hover:bg-accent'
                      )}
                    >
                      <span className="flex h-5 w-5 items-center justify-center rounded-full text-white shadow-sm" style={{ backgroundColor: c.color }}>
                        {themeColor === c.value && <Check className="h-3 w-3 stroke-[3]" />}
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
                      key={f.value}
                      onClick={() => setFontSize(f.value)}
                      className={cn(
                        'rounded-xl border p-2 text-xs transition-colors text-center',
                        fontSize === f.value ? 'border-primary bg-primary/10 text-primary font-bold' : 'hover:bg-accent'
                      )}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </section>

              {/* 22 Supported Languages (Requirement 10) */}
              <section>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                    <Globe className="h-3.5 w-3.5 text-primary" />
                    22 Languages Supported
                  </h3>
                  <span className="text-[10px] font-mono font-bold text-primary px-1.5 py-0.5 rounded bg-primary/10 uppercase">
                    {language}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-1.5 max-h-48 overflow-y-auto pr-1 border rounded-xl p-2 bg-muted/20">
                  {SUPPORTED_LANGUAGES.map((l) => (
                    <button
                      key={l.code}
                      onClick={() => setLanguage(l.code)}
                      className={cn(
                        'flex items-center gap-1.5 rounded-lg border p-1.5 text-left text-xs transition-colors',
                        language === l.code ? 'border-primary bg-primary/10 text-primary font-bold' : 'hover:bg-accent bg-card'
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
                <Switch id="auto-save" checked={autoSave} onCheckedChange={setAutoSave} />
              </section>
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
