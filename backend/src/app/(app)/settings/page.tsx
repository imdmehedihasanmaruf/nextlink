'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { 
  Sun, Moon, Monitor, Palette, Type, Languages, Save, Server, ShieldCheck, Shield, 
  Users, Check, Smartphone, Key, Radio, Trash2, Loader2, RefreshCw, Wifi, CreditCard,
  Ban, RotateCcw
} from 'lucide-react';
import toast from 'react-hot-toast';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useSettingsStore, SUPPORTED_LANGUAGES, ThemeColor, FontSize, ThemeMode, Language } from '@/store/settingsStore';
import { useTheme } from 'next-themes';
import { apiGet, apiFetch, apiPost, getApiToken } from '@/lib/apiClient';

const colors: { name: ThemeColor; label: string; bg: string }[] = [
  { name: 'blue', label: 'Blue', bg: 'bg-blue-500' },
  { name: 'green', label: 'Green', bg: 'bg-emerald-500' },
  { name: 'purple', label: 'Purple', bg: 'bg-purple-500' },
  { name: 'red', label: 'Red', bg: 'bg-rose-500' },
  { name: 'orange', label: 'Orange', bg: 'bg-amber-500' },
];

interface StaffUser {
  id: string;
  email: string;
  name: string | null;
  role: string;
  status: string | null;
  last_login_at: string | null;
}

interface SystemSettings {
  // New in the settings API — tells the admin UI which values the
  // environment pins, so production shows the effective mode read-only.
  runtime?: {
    nodeEnv: string;
    mikrotikMode: string;
    smsMode: string;
    paymentMode: string;
    locked: boolean;
  };
  mikrotik: {
    mode: string;
    host: string;
    apiPort: number;
    username: string;
    password: string;
    timeoutMs: number;
  };
  sms: {
    mode: string;
    provider: string;
    providerUrl: string;
    apiKey: string;
    senderId: string;
  };
  payments: { mode: string };
  billing: {
    timezone: string;
    dueDay: number;
    lateGraceDays: number;
    suspendAfterDays: number;
    currency: string;
    installationFee?: number;
    taxFee?: number;
    lateFeePercent?: number;
    lateFee?: number;
    late_fee_value?: number;
    lateFeeValue?: number;
    late_fee_type?: string;
    lateFeeType?: string;
  };
  footer?: {
    version: string;
  };
  notifications?: {
    invoiceGenerated: boolean;
    paymentReceived: boolean;
    paymentFailed: boolean;
    lateFeeApplied: boolean;
    ticketReply: boolean;
    technicianAssigned: boolean;
    boostActivated: boolean;
    referralCredited: boolean;
    adminNewTicket: boolean;
    adminNewUser: boolean;
    adminFailedPayment: boolean;
  };
  cancellation?: {
    reasons: string[];
    effectiveDateRule: string;
    allowNotSureBuyAgain: boolean;
    rechargeAfterCancelTreatAsNew?: boolean;
  };
}

export default function SettingsPage() {
  const { setTheme: setNextTheme } = useTheme();
  const { 
    theme, 
    themeColor, 
    fontSize, 
    language, 
    autoSave, 
    setTheme, 
    setThemeColor, 
    setFontSize, 
    setLanguage, 
    setAutoSave 
  } = useSettingsStore();

  const t = (en: string, _bn?: string) => en;

  // Authoritative saved theme: currently in localStorage / store
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

  // Revert preview on unmount or navigation away
  useEffect(() => {
    return () => {
      if (typeof document !== 'undefined') {
        const themeMode = savedThemeRef.current;
        let isDark = false;
        if (themeMode === 'dark') isDark = true;
        else if (themeMode === 'light') isDark = false;
        else isDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        if (isDark) document.documentElement.classList.add('dark');
        else document.documentElement.classList.remove('dark');
      }
    };
  }, []);

  const handleAdminThemePick = (chosen: ThemeMode) => {
    setPendingTheme(chosen);
    if (typeof document !== 'undefined') {
      let isDark = false;
      if (chosen === 'dark') isDark = true;
      else if (chosen === 'light') isDark = false;
      else isDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      if (isDark) document.documentElement.classList.add('dark');
      else document.documentElement.classList.remove('dark');
    }
  };

  const handleAdminThemeReset = () => {
    setPendingTheme(savedTheme);
    if (typeof document !== 'undefined') {
      let isDark = false;
      if (savedTheme === 'dark') isDark = true;
      else if (savedTheme === 'light') isDark = false;
      else isDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      if (isDark) document.documentElement.classList.add('dark');
      else document.documentElement.classList.remove('dark');
    }
  };

  const handleAdminThemeSave = () => {
    try {
      localStorage.setItem('nl_admin_theme', pendingTheme);
      setTheme(pendingTheme);
      setNextTheme(pendingTheme);
      setSavedTheme(pendingTheme);
      toast.success(t(`Theme '${pendingTheme}' saved successfully!`, `থিম '${pendingTheme}' সংরক্ষিত হয়েছে!`));
    } catch (err: any) {
      toast.error('Failed to save theme: ' + (err.message || 'Error'));
    }
  };

  // Core infrastructure configuration — persisted through the Express API.
  const [system, setSystem] = useState<SystemSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [hasToken, setHasToken] = useState(false);
  const [mikrotikPassword, setMikrotikPassword] = useState('');
  const [smsApiKey, setSmsApiKey] = useState('');

  // Cancellation settings
  const [cancelReasonsText, setCancelReasonsText] = useState('');
  const [effectiveDateRule, setEffectiveDateRule] = useState('immediate');
  const [allowNotSureBuyAgain, setAllowNotSureBuyAgain] = useState(true);
  const [rechargeAfterCancelTreatAsNew, setRechargeAfterCancelTreatAsNew] = useState(true);
  const [savingCancellation, setSavingCancellation] = useState(false);

  // The live staff accounts — the same table the login verifies against.
  const [staff, setStaff] = useState<StaffUser[]>([]);
  const [staffLoading, setStaffLoading] = useState(true);
  const [deletingStaffId, setDeletingStaffId] = useState<string | null>(null);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    const result = await apiGet<{ settings: SystemSettings }>('/api/settings/system');
    setLoading(false);
    if (result.success && result.settings) {
      setSystem(result.settings);
      // Secret fields come back masked; keep the mask visible until edited.
      setMikrotikPassword(result.settings.mikrotik.password || '');
      setSmsApiKey(result.settings.sms.apiKey || '');

      if (result.settings.cancellation) {
        setCancelReasonsText((result.settings.cancellation.reasons || []).join('\n'));
        setEffectiveDateRule(result.settings.cancellation.effectiveDateRule || 'immediate');
        setAllowNotSureBuyAgain(result.settings.cancellation.allowNotSureBuyAgain ?? true);
        setRechargeAfterCancelTreatAsNew(result.settings.cancellation.rechargeAfterCancelTreatAsNew ?? true);
      }
    }
  }, []);

  useEffect(() => {
    setHasToken(Boolean(getApiToken()));
    loadSettings();
  }, [loadSettings]);

  const loadStaff = useCallback(async () => {
    setStaffLoading(true);
    const result = await apiGet<{ staff: StaffUser[] }>('/api/settings/staff');
    setStaffLoading(false);
    if (result.success && Array.isArray(result.staff)) {
      setStaff(result.staff);
    } else {
      setStaff([]);
    }
  }, []);

  useEffect(() => {
    loadStaff();
  }, [loadStaff]);

  const handleDeleteStaff = async (member: StaffUser) => {
    if (!confirm(`Delete the staff account ${member.email}? This cannot be undone.`)) return;
    setDeletingStaffId(member.id);
    const result = await apiFetch<{ success: boolean; error?: string }>(`/api/settings/staff/${encodeURIComponent(member.id)}`, {
      method: 'DELETE',
    });
    setDeletingStaffId(null);
    if (!result.success) {
      toast.error(result.error || 'The staff account could not be deleted.');
      return;
    }
    toast.success(`Staff account ${member.email} deleted.`);
    setStaff((prev) => prev.filter((item) => item.id !== member.id));
  };

  const updateSystem = (patch: Partial<SystemSettings>) => {
    setSystem((prev) => (prev ? { ...prev, ...patch } : prev));
  };

  /**
   * Persist the MikroTik configuration.
   *
   * The masked password that comes back from the API must not be written
   * again — only a password the operator actually typed is sent.
   */
  const handleSaveMikrotik = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!system) return;

    setSaving(true);
    const payload: Record<string, unknown> = {
      mode: system.mikrotik.mode,
      host: system.mikrotik.host,
      apiPort: Number(system.mikrotik.apiPort) || 8728,
      username: system.mikrotik.username,
      timeoutMs: Number(system.mikrotik.timeoutMs) || 8000,
    };
    if (mikrotikPassword && !mikrotikPassword.includes('•')) {
      payload.password = mikrotikPassword;
    }

    const result = await apiFetch('/api/settings/system/mikrotik', {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    setSaving(false);

    if (result.success) {
      toast.success('MikroTik configuration saved to the billing service.');
      loadSettings();
    } else {
      toast.error(result.error || 'Could not save the configuration');
    }
  };

  /**
   * Persist the SMS gateway configuration.
   */
  const handleSaveSms = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!system) return;

    setSaving(true);
    const payload: Record<string, unknown> = {
      mode: system.sms.mode,
      provider: system.sms.provider,
      providerUrl: system.sms.providerUrl,
      senderId: system.sms.senderId,
    };
    if (smsApiKey && !smsApiKey.includes('•')) {
      payload.apiKey = smsApiKey;
    }

    const result = await apiFetch('/api/settings/system/sms', {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    setSaving(false);

    if (result.success) {
      toast.success('SMS gateway configuration saved.');
      loadSettings();
    } else {
      toast.error(result.error || 'Could not save the configuration');
    }
  };

  /**
   * Test the real router connection.
   */
  const handleTestRouter = async () => {
    setTesting(true);
    const result = await apiPost('/api/settings/mikrotik/test');
    setTesting(false);

    if (result.success && result.success === true) {
      // The identity comes from the router itself. When the router did not
      // report one the message says so instead of naming a made-up device.
      const identity = result.router?.identity;
      toast.success(
        identity
          ? `Router reachable — ${identity} (${result.latencyMs}ms)`
          : `Router reachable (${result.latencyMs}ms)`,
      );
    } else if (result.error) {
      toast.error(result.error);
    }
  };

  /**
   * Clear the stored MikroTik and SMS credentials.
   */
  const handleDeleteCredentials = async () => {
    if (!confirm('Delete and clear the saved MikroTik & SMS credentials?')) return;

    setSaving(true);
    await apiFetch('/api/settings/system/mikrotik', {
      method: 'PUT',
      body: JSON.stringify({ password: '' }),
    });
    await apiFetch('/api/settings/system/sms', {
      method: 'PUT',
      body: JSON.stringify({ apiKey: '' }),
    });
    setSaving(false);

    toast.success('MikroTik & SMS credentials cleared');
    loadSettings();
  };

  const handleSaveCancellation = async () => {
    setSavingCancellation(true);
    const parsedReasons = cancelReasonsText
      .split('\n')
      .map((r) => r.trim())
      .filter(Boolean);

    const payload = {
      reasons: parsedReasons.length > 0 ? parsedReasons : ['Too expensive', 'Slow speed', 'Other'],
      effectiveDateRule,
      allowNotSureBuyAgain,
      rechargeAfterCancelTreatAsNew,
    };

    try {
      const res = await apiFetch('/api/settings/system/cancellation', {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      if (res.success) {
        toast.success('Cancellation settings saved successfully');
        loadSettings();
      } else {
        toast.error(res.error || 'Failed to save cancellation settings');
      }
    } catch (err: any) {
      toast.error(err?.message || 'Error saving cancellation settings');
    } finally {
      setSavingCancellation(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          {t('System & Application Settings', 'সিস্টেম ও অ্যাপ্লিকেশন সেটিংস')}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {t('Manage router connections, SMS gateways, theme modes, colors, cancellations, and admin permissions.', 'রাউটার কানেকশন, এসএমএস গেটওয়ে, থিম মোড, কালার এবং অ্যাডমিন এক্সেস কনফিগার করুন।')}
        </p>
      </div>

      <Tabs defaultValue="display" className="space-y-6">
        <TabsList className="grid w-full grid-cols-4 max-w-xl">
          <TabsTrigger value="display">{t('Display & UI', 'ডিসপ্লে ও ইউআই')}</TabsTrigger>
          <TabsTrigger value="system">{t('MikroTik & Core', 'মাইক্রোটিক ও গেটওয়ে')}</TabsTrigger>
          <TabsTrigger value="users">{t('User Roles', 'ইউজার ও রোলস')}</TabsTrigger>
          <TabsTrigger value="cancellation">{t('Cancellations', 'ক্যান্সেলেশন')}</TabsTrigger>
        </TabsList>

        {/* TAB 1: Display & Preferences (Dark/Light, Theme Color, Font Size, Language, Auto Save) */}
        <TabsContent value="display" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Theme Mode */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Sun className="h-4 w-4 text-primary" />
                    {t('Theme Appearance (Dark / Light)', 'থিম মোড (ডার্ক / লাইট)')}
                  </CardTitle>
                  <CardDescription>{t('Preview live; applies permanently only when saved', 'প্রিভিউ দেখুন; সেভ করলেই স্থায়ী হবে')}</CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  {pendingTheme !== savedTheme && (
                    <Button 
                      type="button" 
                      variant="outline" 
                      size="sm" 
                      onClick={handleAdminThemeReset}
                      className="gap-1 h-8 text-xs cursor-pointer"
                    >
                      <RotateCcw className="h-3.5 w-3.5" /> Cancel
                    </Button>
                  )}
                  <Button 
                    size="sm" 
                    onClick={handleAdminThemeSave} 
                    disabled={pendingTheme === savedTheme}
                    className="gap-1.5 h-8 text-xs cursor-pointer"
                  >
                    <Save className="h-3.5 w-3.5" /> Save Theme
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {pendingTheme !== savedTheme && (
                  <div
                    aria-live="polite"
                    className="mb-3 px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 text-xs font-semibold flex items-center justify-between"
                  >
                    <span>Unsaved theme changes (Live Preview active)</span>
                  </div>
                )}
                <div className="grid grid-cols-3 gap-3" role="radiogroup" aria-label="Admin Theme Appearance">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={pendingTheme === 'light'}
                    onClick={() => handleAdminThemePick('light')}
                    className={`flex flex-col items-center justify-center p-3 rounded-xl border-2 transition-all cursor-pointer ${
                      pendingTheme === 'light' ? 'border-primary bg-primary/10 text-primary font-bold shadow-xs' : 'border-border'
                    }`}
                  >
                    <Sun className="h-5 w-5 mb-1" />
                    <span className="text-xs">Light</span>
                    {pendingTheme === 'light' && (
                      <span className="text-[10px] text-primary">{pendingTheme === savedTheme ? 'Active' : 'Preview'}</span>
                    )}
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={pendingTheme === 'dark'}
                    onClick={() => handleAdminThemePick('dark')}
                    className={`flex flex-col items-center justify-center p-3 rounded-xl border-2 transition-all cursor-pointer ${
                      pendingTheme === 'dark' ? 'border-primary bg-primary/10 text-primary font-bold shadow-xs' : 'border-border'
                    }`}
                  >
                    <Moon className="h-5 w-5 mb-1" />
                    <span className="text-xs">Dark</span>
                    {pendingTheme === 'dark' && (
                      <span className="text-[10px] text-primary">{pendingTheme === savedTheme ? 'Active' : 'Preview'}</span>
                    )}
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={pendingTheme === 'system'}
                    onClick={() => handleAdminThemePick('system')}
                    className={`flex flex-col items-center justify-center p-3 rounded-xl border-2 transition-all cursor-pointer ${
                      pendingTheme === 'system' ? 'border-primary bg-primary/10 text-primary font-bold shadow-xs' : 'border-border'
                    }`}
                  >
                    <Monitor className="h-5 w-5 mb-1" />
                    <span className="text-xs">System</span>
                    {pendingTheme === 'system' && (
                      <span className="text-[10px] text-primary">{pendingTheme === savedTheme ? 'Active' : 'Preview'}</span>
                    )}
                  </button>
                </div>
              </CardContent>
            </Card>

            {/* Theme Color Picker */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Palette className="h-4 w-4 text-primary" />
                    {t('Accent Theme Color', 'থিম কালার (Accent Color)')}
                  </CardTitle>
                  <CardDescription>{t('Pick the primary color scheme', 'মূল কালার স্কিম নির্ধারণ করুন')}</CardDescription>
                </div>
                <Button size="sm" onClick={() => toast.success(t(`Accent color '${themeColor}' saved successfully!`, `থিম কালার '${themeColor}' সংরক্ষিত হয়েছে!`))} className="gap-1.5 h-8 text-xs">
                  <Save className="h-3.5 w-3.5" /> Save Color
                </Button>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-5 gap-2">
                  {colors.map((c) => (
                    <button
                      key={c.name}
                      type="button"
                      onClick={() => setThemeColor(c.name)}
                      className={`flex flex-col items-center gap-2 p-2 rounded-xl border-2 transition-all ${
                        themeColor === c.name ? 'border-primary bg-primary/10 font-bold' : 'border-border'
                      }`}
                    >
                      <span className={`h-6 w-6 rounded-full ${c.bg} flex items-center justify-center text-white shadow`}>
                        {themeColor === c.name && <Check className="h-3 w-3 stroke-[3]" />}
                      </span>
                      <span className="text-xs capitalize">{c.label}</span>
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Font Size */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Type className="h-4 w-4 text-primary" />
                    {t('Font Size (Scaling)', 'ফন্টের আকার (Font Size)')}
                  </CardTitle>
                  <CardDescription>{t('Adjust text readability', 'পড়ার সুবিধার জন্য লেখার সাইজ')}</CardDescription>
                </div>
                <Button size="sm" onClick={() => toast.success(t(`Font size '${fontSize}' saved successfully!`, `ফন্ট সাইজ '${fontSize}' সংরক্ষিত হয়েছে!`))} className="gap-1.5 h-8 text-xs">
                  <Save className="h-3.5 w-3.5" /> Save Font
                </Button>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-3 gap-3">
                  <button
                    type="button"
                    onClick={() => setFontSize('sm')}
                    className={`p-3 rounded-xl border-2 text-center transition-all ${
                      fontSize === 'sm' ? 'border-primary bg-primary/10 text-primary font-bold' : 'border-border'
                    }`}
                  >
                    <p className="text-xs font-semibold">Small</p>
                    <p className="text-[11px] text-muted-foreground">14px</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => setFontSize('md')}
                    className={`p-3 rounded-xl border-2 text-center transition-all ${
                      fontSize === 'md' ? 'border-primary bg-primary/10 text-primary font-bold' : 'border-border'
                    }`}
                  >
                    <p className="text-sm font-semibold">Medium</p>
                    <p className="text-xs text-muted-foreground">16px</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => setFontSize('lg')}
                    className={`p-3 rounded-xl border-2 text-center transition-all ${
                      fontSize === 'lg' ? 'border-primary bg-primary/10 text-primary font-bold' : 'border-border'
                    }`}
                  >
                    <p className="text-base font-semibold">Large</p>
                    <p className="text-xs text-muted-foreground">18px</p>
                  </button>
                </div>
              </CardContent>
            </Card>

            {/* Language & Auto Save */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Languages className="h-4 w-4 text-primary" />
                    {t('Language & Auto Save', 'ভাষা ও অটো সেভ')}
                  </CardTitle>
                  <CardDescription>{t('Interface localization & persistence', 'ভাষা নির্বাচন ও ড্রাফট সেভ')}</CardDescription>
                </div>
                <Button size="sm" onClick={() => toast.success(t(`Language '${language}' and Auto-Save preference saved!`, `ভাষা '${language}' এবং অটো সেভ সংরক্ষিত হয়েছে!`))} className="gap-1.5 h-8 text-xs">
                  <Save className="h-3.5 w-3.5" /> Save Language
                </Button>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-muted-foreground uppercase">Select from 22 Regional Languages</span>
                    <span className="text-xs font-mono font-bold text-primary uppercase">Current: {language}</span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-48 overflow-y-auto p-2 border rounded-xl bg-muted/20">
                    {SUPPORTED_LANGUAGES.map((l) => (
                      <button
                        key={l.code}
                        type="button"
                        onClick={() => setLanguage(l.code)}
                        className={`flex items-center gap-1.5 p-2 rounded-lg border text-left text-xs transition-colors ${
                          language === l.code ? 'border-primary bg-primary/10 font-bold text-primary' : 'bg-card hover:bg-accent'
                        }`}
                      >
                        <span className="text-base">{l.flag}</span>
                        <span className="truncate">{l.name}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-between p-3 rounded-xl border bg-muted/20">
                  <div className="space-y-0.5">
                    <Label className="text-sm font-semibold">{t('Auto Save Feature', 'অটো সেভ ফিচার')}</Label>
                    <p className="text-xs text-muted-foreground">
                      {t('Store form edits automatically in browser', 'ফর্মের তথ্য স্বয়ংক্রিয় সংরক্ষণ')}
                    </p>
                  </div>
                  <Switch checked={autoSave} onCheckedChange={setAutoSave} />
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* TAB 2: MikroTik & Core Integration (from SRS section 3.2 & 4) */}
        <TabsContent value="system" className="space-y-6">
          {!hasToken ? (
            <Card>
              <CardContent className="p-8 text-center space-y-3">
                <Key className="h-10 w-10 mx-auto text-amber-500" />
                <p className="font-semibold">API session required</p>
                <p className="text-sm text-muted-foreground max-w-md mx-auto">
                  Sign out and sign in again to obtain a session token for the Billing API (proxied at /api).
                  The MikroTik and SMS credentials are stored there so the billing engine can use them.
                </p>
                <Button variant="outline" onClick={() => window.location.reload()} className="mt-2">
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Retry
                </Button>
              </CardContent>
            </Card>
          ) : loading || !system ? (
            <Card>
              <CardContent className="p-8 text-center">
                <Loader2 className="h-6 w-6 mx-auto animate-spin text-primary" />
                <p className="text-sm text-muted-foreground mt-3">Loading configuration…</p>
              </CardContent>
            </Card>
          ) : (
            <>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Server className="h-5 w-5 text-primary" />
                    MikroTik RouterOS API Synchronization (v6 / v7)
                  </CardTitle>
                  <CardDescription>
                    Real-time automated PPPoE / Static user enable/disable based on bill payment status
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleSaveMikrotik} className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                      <div>
                        <Label>Mode</Label>
                        {system.runtime?.locked ? (
                          <div className="mt-1.5 h-9 flex items-center px-3 rounded-md border bg-muted/50 text-sm font-semibold">
                            {system.runtime.mikrotikMode === 'live' ? 'Live RouterOS (enforced by environment)' : 'Simulator (enforced by environment)'}
                          </div>
                        ) : (
                          <Select
                            value={system.mikrotik.mode}
                            onValueChange={(value) =>
                              updateSystem({
                                mikrotik: { ...system.mikrotik, mode: value },
                              })
                            }
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Select mode" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="simulator">Simulator (development only)</SelectItem>
                              <SelectItem value="live">Live RouterOS</SelectItem>
                            </SelectContent>
                          </Select>
                        )}
                      </div>
                      <div>
                        <Label>Router Host IP</Label>
                        <Input
                          value={system.mikrotik.host}
                          onChange={(e) =>
                            updateSystem({
                              mikrotik: { ...system.mikrotik, host: e.target.value },
                            })
                          }
                        />
                      </div>
                      <div>
                        <Label>API Port</Label>
                        <Input
                          value={String(system.mikrotik.apiPort)}
                          onChange={(e) =>
                            updateSystem({
                              mikrotik: { ...system.mikrotik, apiPort: Number(e.target.value) || 8728 },
                            })
                          }
                        />
                      </div>
                      <div>
                        <Label>API Username</Label>
                        <Input
                          value={system.mikrotik.username}
                          onChange={(e) =>
                            updateSystem({
                              mikrotik: { ...system.mikrotik, username: e.target.value },
                            })
                          }
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                      <div>
                        <Label>API Password</Label>
                        <Input
                          type="password"
                          placeholder="Leave unchanged to keep the stored password"
                          value={mikrotikPassword}
                          onChange={(e) => setMikrotikPassword(e.target.value)}
                        />
                        <p className="text-[11px] text-muted-foreground mt-1">
                          Stored hashed-style and never returned in clear text.
                        </p>
                      </div>
                      <div>
                        <Label>Timeout (ms)</Label>
                        <Input
                          value={String(system.mikrotik.timeoutMs)}
                          onChange={(e) =>
                            updateSystem({
                              mikrotik: { ...system.mikrotik, timeoutMs: Number(e.target.value) || 8000 },
                            })
                          }
                        />
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-3">
                      <div className="flex items-center gap-3">
                        <Button type="submit" disabled={saving} className="gap-2">
                          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                          Save Configuration
                        </Button>
                        <Button type="button" variant="outline" disabled={testing} onClick={handleTestRouter}>
                          {testing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Wifi className="h-4 w-4 mr-2" />}
                          Test Router Connection
                        </Button>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={saving}
                        onClick={handleDeleteCredentials}
                        className="gap-1.5 text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Delete Credentials
                      </Button>
                    </div>
                  </form>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Smartphone className="h-5 w-5 text-primary" />
                    SMS Notification Gateway
                  </CardTitle>
                  <CardDescription>
                    Bill reminders, suspension notices, reconnection confirmations and ticket updates.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleSaveSms} className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                      <div>
                        <Label>Mode</Label>
                        {system.runtime?.locked ? (
                          <div className="mt-1.5 h-9 flex items-center px-3 rounded-md border bg-muted/50 text-sm font-semibold">
                            {system.runtime.smsMode === 'live' ? 'Live gateway (enforced by environment)' : 'Mock — logged only (enforced by environment)'}
                          </div>
                        ) : (
                          <Select
                            value={system.sms.mode}
                            onValueChange={(value) =>
                              updateSystem({ sms: { ...system.sms, mode: value } })
                            }
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Select mode" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="mock">Mock — logged only (development)</SelectItem>
                              <SelectItem value="live">Live gateway</SelectItem>
                            </SelectContent>
                          </Select>
                        )}
                      </div>
                      <div>
                        <Label>Provider</Label>
                        <Input
                          value={system.sms.provider}
                          onChange={(e) =>
                            updateSystem({ sms: { ...system.sms, provider: e.target.value } })
                          }
                        />
                      </div>
                      <div>
                        <Label>Sender ID</Label>
                        <Input
                          value={system.sms.senderId}
                          onChange={(e) =>
                            updateSystem({ sms: { ...system.sms, senderId: e.target.value } })
                          }
                        />
                      </div>
                      <div>
                        <Label>API Key</Label>
                        <Input
                          type="password"
                          placeholder="Leave unchanged to keep the stored key"
                          value={smsApiKey}
                          onChange={(e) => setSmsApiKey(e.target.value)}
                        />
                      </div>
                    </div>

                    <div className="pt-2">
                      <Label>Provider Endpoint URL</Label>
                      <Input
                        placeholder="https://sms-gateway.example.com/api/send"
                        value={system.sms.providerUrl}
                        onChange={(e) =>
                          updateSystem({ sms: { ...system.sms, providerUrl: e.target.value } })
                        }
                      />
                    </div>

                    <Button type="submit" disabled={saving} className="gap-2">
                      {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                      Save SMS Configuration
                    </Button>
                  </form>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <CreditCard className="h-5 w-5 text-primary" />
                    Billing Engine Fees, Footer Version &amp; Notification Preferences
                  </CardTitle>
                  <CardDescription>
                    Configure first-month installation fee ($8.99), tax fee ($0.99), unpaid late fee (2%), footer version string, and real-time notification triggers.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  {/* Billing Fees Form */}
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      setSaving(true);
                      const lfVal = Number(
                        system.billing.late_fee_value ??
                          system.billing.lateFeeValue ??
                          system.billing.lateFeePercent ??
                          10,
                      );
                      const lfType =
                        String(system.billing.late_fee_type || system.billing.lateFeeType || 'percent').toLowerCase() === 'flat'
                          ? 'flat'
                          : 'percent';
                      const res = await apiFetch('/api/settings/system/billing', {
                        method: 'PUT',
                        body: JSON.stringify({
                          currency: system.billing.currency || 'USD',
                          dueDay: Number(system.billing.dueDay ?? 10),
                          lateGraceDays: Number(system.billing.lateGraceDays ?? 5),
                          suspendAfterDays: Number(system.billing.suspendAfterDays ?? 10),
                          installationFee: Number(system.billing.installationFee ?? 8.99),
                          taxFee: Number(system.billing.taxFee ?? 0.99),
                          late_fee_type: lfType,
                          late_fee_value: lfVal,
                          lateFeeType: lfType,
                          lateFeeValue: lfVal,
                          lateFeePercent: lfVal,
                          timezone: system.billing.timezone || 'UTC',
                        }),
                      });
                      setSaving(false);
                      if (res.success) {
                        toast.success('Billing fee rules saved!');
                        loadSettings();
                      } else {
                        toast.error(res.error || 'Could not save billing settings');
                      }
                    }}
                    className="space-y-3 border-b pb-5"
                  >
                    <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                      1. Billing Fee Values (Requirement 4e)
                    </h4>
                    <div className="grid grid-cols-2 md:grid-cols-7 gap-4">
                      <div>
                        <Label className="text-xs">Installation Fee ($)</Label>
                        <Input
                          type="number"
                          step="0.01"
                          value={system.billing.installationFee ?? 8.99}
                          onChange={(e) =>
                            updateSystem({
                              billing: { ...system.billing, installationFee: Number(e.target.value) },
                            })
                          }
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Tax Fee ($)</Label>
                        <Input
                          type="number"
                          step="0.01"
                          value={system.billing.taxFee ?? 0.99}
                          onChange={(e) =>
                            updateSystem({
                              billing: { ...system.billing, taxFee: Number(e.target.value) },
                            })
                          }
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Late Fee Type</Label>
                        <select
                          value={system.billing.late_fee_type || system.billing.lateFeeType || 'percent'}
                          onChange={(e) =>
                            updateSystem({
                              billing: {
                                ...system.billing,
                                late_fee_type: e.target.value,
                                lateFeeType: e.target.value,
                              },
                            })
                          }
                          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                        >
                          <option value="percent">Percent (%)</option>
                          <option value="flat">Flat ($)</option>
                        </select>
                      </div>
                      <div>
                        <Label className="text-xs">
                          Late Fee Value ({(system.billing.late_fee_type || system.billing.lateFeeType || 'percent') === 'flat' ? '$' : '%'})
                        </Label>
                        <Input
                          type="number"
                          step="0.1"
                          value={
                            system.billing.late_fee_value ??
                            system.billing.lateFeeValue ??
                            system.billing.lateFeePercent ??
                            10
                          }
                          onChange={(e) => {
                            const val = Number(e.target.value);
                            updateSystem({
                              billing: {
                                ...system.billing,
                                late_fee_value: val,
                                lateFeeValue: val,
                                lateFeePercent: val,
                              },
                            });
                          }}
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Due Day (UTC)</Label>
                        <Input
                          type="number"
                          min={1}
                          max={28}
                          value={system.billing.dueDay ?? 10}
                          onChange={(e) =>
                            updateSystem({
                              billing: { ...system.billing, dueDay: Number(e.target.value) },
                            })
                          }
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Currency</Label>
                        <Input
                          value={system.billing.currency || 'USD'}
                          onChange={(e) =>
                            updateSystem({
                              billing: { ...system.billing, currency: e.target.value },
                            })
                          }
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Timezone</Label>
                        <Input
                          value={system.billing.timezone || 'UTC'}
                          onChange={(e) =>
                            updateSystem({
                              billing: { ...system.billing, timezone: e.target.value },
                            })
                          }
                        />
                      </div>
                    </div>
                    <Button type="submit" size="sm" disabled={saving} className="gap-1.5">
                      <Save className="h-3.5 w-3.5" /> Save Billing Fees
                    </Button>
                  </form>

                  {/* Footer Version Form */}
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      setSaving(true);
                      const res = await apiFetch('/api/settings/system/footer', {
                        method: 'PUT',
                        body: JSON.stringify({
                          version: system.footer?.version || 'To be implemented',
                        }),
                      });
                      setSaving(false);
                      if (res.success) {
                        toast.success('Footer version saved!');
                        loadSettings();
                      } else {
                        toast.error(res.error || 'Could not save footer settings');
                      }
                    }}
                    className="space-y-3 border-b pb-5"
                  >
                    <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                      2. Footer Configuration (Requirement 15)
                    </h4>
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-end gap-3 max-w-lg">
                      <div className="flex-1">
                        <Label className="text-xs">Footer Version String</Label>
                        <Input
                          placeholder="To be implemented"
                          value={system.footer?.version ?? 'To be implemented'}
                          onChange={(e) =>
                            updateSystem({
                              footer: { version: e.target.value },
                            })
                          }
                        />
                      </div>
                      <Button type="submit" size="sm" disabled={saving} className="gap-1.5">
                        <Save className="h-3.5 w-3.5" /> Save Footer Version
                      </Button>
                    </div>
                  </form>

                  {/* Notification Preferences Form */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                        3. Real-Time Notification Triggers (Requirement 13)
                      </h4>
                      <Button
                        size="sm"
                        disabled={saving}
                        onClick={async () => {
                          setSaving(true);
                          const res = await apiFetch('/api/settings/system/notifications', {
                            method: 'PUT',
                            body: JSON.stringify(system.notifications || {}),
                          });
                          setSaving(false);
                          if (res.success) {
                            toast.success('Notification preferences saved!');
                            loadSettings();
                          } else {
                            toast.error(res.error || 'Could not save notification preferences');
                          }
                        }}
                        className="gap-1.5"
                      >
                        <Save className="h-3.5 w-3.5" /> Save Notification Preferences
                      </Button>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                      {[
                        { key: 'invoiceGenerated', label: 'Invoice Generated' },
                        { key: 'paymentReceived', label: 'Payment Received' },
                        { key: 'paymentFailed', label: 'Payment Failed' },
                        { key: 'lateFeeApplied', label: '2% Late Fee Applied' },
                        { key: 'ticketReply', label: 'Support Ticket Reply' },
                        { key: 'technicianAssigned', label: 'Technician Assigned' },
                        { key: 'boostActivated', label: 'Turbo Boost Activated' },
                        { key: 'referralCredited', label: 'Referral Reward Credited' },
                        { key: 'adminNewTicket', label: 'Admin: New Ticket Alert' },
                        { key: 'adminNewUser', label: 'Admin: New User Signup' },
                        { key: 'adminFailedPayment', label: 'Admin: Failed Payment Alert' },
                      ].map((pref) => {
                        const checked = (system.notifications as any)?.[pref.key] ?? true;
                        return (
                          <div
                            key={pref.key}
                            className="flex items-center justify-between rounded-lg border p-2.5 bg-muted/20"
                          >
                            <span className="text-xs font-medium">{pref.label}</span>
                            <Switch
                              checked={Boolean(checked)}
                              onCheckedChange={(val) =>
                                updateSystem({
                                  notifications: {
                                    invoiceGenerated: true,
                                    paymentReceived: true,
                                    paymentFailed: true,
                                    lateFeeApplied: true,
                                    ticketReply: true,
                                    technicianAssigned: true,
                                    boostActivated: true,
                                    referralCredited: true,
                                    adminNewTicket: true,
                                    adminNewUser: true,
                                    adminFailedPayment: true,
                                    ...(system.notifications || {}),
                                    [pref.key]: val,
                                  },
                                })
                              }
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        {/* TAB 3: Staff Accounts — the same api_users table the login uses */}
        <TabsContent value="users" className="space-y-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <ShieldCheck className="h-5 w-5 text-primary" />
                  Staff Accounts
                </CardTitle>
                <CardDescription>
                  The live staff list, read from the server on every load. Role permissions are managed on the Role Management page.
                </CardDescription>
              </div>
              <Link href="/roles">
                <Button size="sm" variant="outline" className="gap-1.5 h-8 text-xs">
                  <Shield className="h-3.5 w-3.5" /> Manage & Create Roles
                </Button>
              </Link>
            </CardHeader>
            <CardContent>
              {staffLoading ? (
                <p className="text-sm text-muted-foreground py-6 text-center">Loading staff accounts…</p>
              ) : staff.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">
                  Staff accounts could not be loaded. Check that the API is reachable and you are signed in as a super admin.
                </p>
              ) : (
                <div className="divide-y">
                  {staff.map((member) => (
                    <div key={member.id} className="py-3 flex items-center justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold">{member.name || member.email}</span>
                          <Badge variant="outline" className="text-xs capitalize">{member.role.replace('_', ' ')}</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {member.email}
                          {member.last_login_at ? ` • Last login ${new Date(member.last_login_at).toLocaleString()}` : ' • Never signed in'}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge className={member.status === 'active'
                          ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30'
                          : 'bg-rose-500/10 text-rose-600 border-rose-500/30'}>
                          {member.status || 'unknown'}
                        </Badge>
                        {member.role !== 'super_admin' && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleDeleteStaff(member)}
                            disabled={deletingStaffId === member.id}
                            className="h-7 w-7 p-0 text-rose-500 hover:text-rose-600 hover:bg-rose-50"
                            title="Delete staff account"
                          >
                            {deletingStaffId === member.id
                              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              : <Trash2 className="h-3.5 w-3.5" />}
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* TAB 4: Cancellation Policy & Re-subscription Settings */}
        <TabsContent value="cancellation" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Ban className="h-4 w-4 text-rose-600" />
                Package Cancellation &amp; Termination Rules
              </CardTitle>
              <CardDescription>
                Configure allowed reasons for cancellation, service termination effective date rule, and re-subscription policy.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Editable Cancel Reasons */}
              <div className="space-y-2">
                <Label htmlFor="cancel-reasons" className="text-sm font-semibold">
                  Allowed Cancellation Reasons (one per line)
                </Label>
                <Textarea
                  id="cancel-reasons"
                  rows={6}
                  value={cancelReasonsText}
                  onChange={(e) => setCancelReasonsText(e.target.value)}
                  className="font-mono text-xs"
                  placeholder="Too expensive&#10;Slow speed&#10;Frequent disconnections&#10;Moving to another location&#10;Switching provider&#10;Poor support&#10;Temporary pause&#10;Other"
                />
                <p className="text-xs text-muted-foreground">
                  Subscribers pick from these reasons when submitting the cancellation form on /cancel.
                </p>
              </div>

              {/* Effective Date Rule */}
              <div className="space-y-2 max-w-sm">
                <Label htmlFor="effective-date-rule" className="text-sm font-semibold">
                  Cancellation Effective Date Rule
                </Label>
                <Select value={effectiveDateRule} onValueChange={setEffectiveDateRule}>
                  <SelectTrigger id="effective-date-rule" className="text-xs">
                    <SelectValue placeholder="Select rule" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="immediate">Immediate (Terminate today at midnight UTC)</SelectItem>
                    <SelectItem value="end_of_month">End of Billing Month (Active until end of cycle)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Controls when subscriber internet service line is taken down and billed stops.
                </p>
              </div>

              {/* Allow "Not sure yet" Toggle */}
              <div className="flex items-center justify-between border-t pt-4">
                <div className="space-y-0.5">
                  <Label className="text-sm font-semibold">Allow &quot;Not sure yet&quot; for Buy-Again Date</Label>
                  <p className="text-xs text-muted-foreground">
                    Allows subscribers to skip specifying an exact date when they might re-subscribe.
                  </p>
                </div>
                <Switch
                  checked={allowNotSureBuyAgain}
                  onCheckedChange={setAllowNotSureBuyAgain}
                />
              </div>

              {/* Re-subscription Rule Toggle */}
              <div className="flex items-center justify-between border-t pt-4">
                <div className="space-y-0.5">
                  <Label className="text-sm font-semibold">Treat Re-subscription as New Subscription</Label>
                  <p className="text-xs text-muted-foreground">
                    When enabled, buying a package again after a cancellation charges the one-time installation fee ($8.99) and tax fee ($0.99) again.
                  </p>
                </div>
                <Switch
                  checked={rechargeAfterCancelTreatAsNew}
                  onCheckedChange={setRechargeAfterCancelTreatAsNew}
                />
              </div>

              <div className="pt-4 border-t flex justify-end">
                <Button
                  onClick={handleSaveCancellation}
                  disabled={savingCancellation}
                  className="font-bold text-xs gap-1.5"
                >
                  {savingCancellation ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Saving Settings…
                    </>
                  ) : (
                    <>
                      <Save className="h-3.5 w-3.5" />
                      Save Cancellation Settings
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
