'use client';
import { useState } from 'react';
import Link from 'next/link';
import { 
  Sun, Moon, Monitor, Palette, Type, Languages, Save, Server, ShieldCheck, Shield, 
  Users, Check, Smartphone, Key, Radio, Trash2 
} from 'lucide-react';
import toast from 'react-hot-toast';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { useSettingsStore, SUPPORTED_LANGUAGES, ThemeColor, FontSize, ThemeMode, Language } from '@/store/settingsStore';
import { mockAdminUsers } from '@/lib/mockData';

const colors: { name: ThemeColor; label: string; bg: string }[] = [
  { name: 'blue', label: 'Blue', bg: 'bg-blue-500' },
  { name: 'green', label: 'Green', bg: 'bg-emerald-500' },
  { name: 'purple', label: 'Purple', bg: 'bg-purple-500' },
  { name: 'red', label: 'Red', bg: 'bg-rose-500' },
  { name: 'orange', label: 'Orange', bg: 'bg-amber-500' },
];

export default function SettingsPage() {
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

  // System Config State
  const [ispName, setIspName] = useState('NextLink Global Optical Network');
  const [mikrotikIp, setMikrotikIp] = useState('198.51.100.1');
  const [mikrotikPort, setMikrotikPort] = useState('8728');
  const [mikrotikUser, setMikrotikUser] = useState('api_admin');
  const [smsGateway, setSmsGateway] = useState('Twilio Global / Infobip SMS Gateway');
  const [smsApiKey, setSmsApiKey] = useState('gw_live_99812401823908');

  const handleSaveSystem = (e: React.FormEvent) => {
    e.preventDefault();
    toast.success(t('Core ISP & MikroTik configuration saved!', 'আইএসপি ও মাইক্রোটিক কনফিগারেশন সংরক্ষিত হয়েছে!'));
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          {t('System & Application Settings', 'সিস্টেম ও অ্যাপ্লিকেশন সেটিংস')}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {t('Manage router connections, SMS gateways, theme modes, colors, and admin permissions.', 'রাউটার কানেকশন, এসএমএস গেটওয়ে, থিম মোড, কালার এবং অ্যাডমিন এক্সেস কনফিগার করুন।')}
        </p>
      </div>

      <Tabs defaultValue="display" className="space-y-6">
        <TabsList className="grid w-full grid-cols-3 max-w-md">
          <TabsTrigger value="display">{t('Display & UI', 'ডিসপ্লে ও ইউআই')}</TabsTrigger>
          <TabsTrigger value="system">{t('MikroTik & Core', 'মাইক্রোটিক ও গেটওয়ে')}</TabsTrigger>
          <TabsTrigger value="users">{t('User Roles', 'ইউজার ও রোলস')}</TabsTrigger>
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
                  <CardDescription>{t('Select light, dark, or system mode', 'পছন্দের থিম নির্বাচন করুন')}</CardDescription>
                </div>
                <Button size="sm" onClick={() => toast.success(t(`Theme '${theme}' saved successfully!`, `থিম '${theme}' সংরক্ষিত হয়েছে!`))} className="gap-1.5 h-8 text-xs">
                  <Save className="h-3.5 w-3.5" /> Save Theme
                </Button>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-3 gap-3">
                  <button
                    type="button"
                    onClick={() => setTheme('light')}
                    className={`flex flex-col items-center justify-center p-3 rounded-xl border-2 transition-all ${
                      theme === 'light' ? 'border-primary bg-primary/10 text-primary font-bold' : 'border-border'
                    }`}
                  >
                    <Sun className="h-5 w-5 mb-1" />
                    <span className="text-xs">Light</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setTheme('dark')}
                    className={`flex flex-col items-center justify-center p-3 rounded-xl border-2 transition-all ${
                      theme === 'dark' ? 'border-primary bg-primary/10 text-primary font-bold' : 'border-border'
                    }`}
                  >
                    <Moon className="h-5 w-5 mb-1" />
                    <span className="text-xs">Dark</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setTheme('system')}
                    className={`flex flex-col items-center justify-center p-3 rounded-xl border-2 transition-all ${
                      theme === 'system' ? 'border-primary bg-primary/10 text-primary font-bold' : 'border-border'
                    }`}
                  >
                    <Monitor className="h-5 w-5 mb-1" />
                    <span className="text-xs">System</span>
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
              <form onSubmit={handleSaveSystem} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <Label>Router Host IP</Label>
                    <Input value={mikrotikIp} onChange={(e) => setMikrotikIp(e.target.value)} />
                  </div>
                  <div>
                    <Label>API Port</Label>
                    <Input value={mikrotikPort} onChange={(e) => setMikrotikPort(e.target.value)} />
                  </div>
                  <div>
                    <Label>API Username</Label>
                    <Input value={mikrotikUser} onChange={(e) => setMikrotikUser(e.target.value)} />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                  <div>
                    <Label>SMS Gateway Provider</Label>
                    <Input value={smsGateway} onChange={(e) => setSmsGateway(e.target.value)} />
                  </div>
                  <div>
                    <Label>SMS API Secret Key</Label>
                    <Input type="password" value={smsApiKey} onChange={(e) => setSmsApiKey(e.target.value)} />
                  </div>
                </div>

                <div className="flex items-center justify-between pt-3">
                  <div className="flex items-center gap-3">
                    <Button type="submit" className="gap-2">
                      <Save className="h-4 w-4" />
                      Save Configuration
                    </Button>
                    <Button 
                      type="button" 
                      variant="outline" 
                      onClick={() => toast.success('Ping to MikroTik Router SUCCESS (2ms latency)')}
                    >
                      Test Router Connection
                    </Button>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      if (confirm('Delete and clear saved MikroTik & SMS credentials?')) {
                        setMikrotikIp('');
                        setMikrotikPort('');
                        setMikrotikUser('');
                        setSmsGateway('');
                        setSmsApiKey('');
                        toast.success('MikroTik & SMS credentials deleted');
                      }
                    }}
                    className="gap-1.5 text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete Credentials
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        {/* TAB 3: Admin User Roles (from SRS Matrix) */}
        <TabsContent value="users" className="space-y-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <ShieldCheck className="h-5 w-5 text-primary" />
                  Role & Permissions Matrix (SRS Section 2)
                </CardTitle>
                <CardDescription>
                  Configured administrative personnel and granular permission levels
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Link href="/roles">
                  <Button size="sm" variant="outline" className="gap-1.5 h-8 text-xs">
                    <Shield className="h-3.5 w-3.5" /> Manage & Create Roles
                  </Button>
                </Link>
                <Button size="sm" onClick={() => toast.success(t('User roles and permissions matrix saved!', 'ইউজার রোলস ও পারমিশন ম্যাট্রিক্স সংরক্ষিত হয়েছে!'))} className="gap-1.5 h-8 text-xs">
                  <Save className="h-3.5 w-3.5" /> Save Roles
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="divide-y">
                {mockAdminUsers.map((u) => (
                  <div key={u.id} className="py-3 flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{u.name}</span>
                        <Badge variant="outline" className="text-xs capitalize">{u.role.replace('_', ' ')}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">{u.email} • {u.phone}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/30">Active</Badge>
                      {u.role !== 'super_admin' && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => toast.success(`Staff account ${u.name} deleted`)}
                          className="h-7 w-7 p-0 text-rose-500 hover:text-rose-600 hover:bg-rose-50"
                          title="Delete User"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
