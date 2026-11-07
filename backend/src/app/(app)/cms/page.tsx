'use client';
import { useState, useEffect } from 'react';
import { 
  Globe, Save, RefreshCw, Download, Upload,
  Plus, Trash2, Layers, Tv, MapPin, 
  Gift, Zap, Phone, Eye, Menu, HeartHandshake, HelpCircle
} from 'lucide-react';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export default function CMSPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [data, setData] = useState<any>(null);

  // Load content from API
  const fetchContent = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/content?t=' + Date.now());
      if (res.ok) {
        const json = await res.json();
        setData(json);
      } else {
        toast.error('Failed to load content from server');
      }
    } catch (e: any) {
      toast.error('Connection error loading content');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchContent();
  }, []);

  // Save content
  const handleSaveSection = async (sectionLabel: string) => {
    try {
      setSaving(true);
      const res = await fetch('/api/content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        toast.success(`${sectionLabel} saved successfully & live on Frontend (Port 3000)!`);
      } else {
        toast.error('Failed to save changes to disk');
      }
    } catch (e) {
      toast.error('Failed to communicate with API');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAll = () => handleSaveSection('All Website Content');

  // Backup Download
  const handleDownloadBackup = () => {
    window.open('/api/backup', '_blank');
    toast.success('Downloading full system backup JSON...');
  };

  // Backup Upload / Restore
  const handleUploadBackup = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const parsed = JSON.parse(event.target?.result as string);
        const res = await fetch('/api/backup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(parsed),
        });
        if (res.ok) {
          toast.success('Backup restored successfully!');
          fetchContent();
        } else {
          toast.error('Failed to restore backup');
        }
      } catch (err) {
        toast.error('Invalid JSON file format');
      }
    };
    reader.readAsText(file);
  };

  if (loading || !data) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] space-y-4">
        <RefreshCw className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground font-medium">Loading content management engine...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top Bar with Quick Actions */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-card border rounded-2xl p-6 shadow-sm">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Website CMS & Content Manager
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Edit text, packages, notices, and options of the subscriber portal with instant live sync.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button 
            onClick={handleDownloadBackup} 
            variant="outline" 
            size="sm"
            className="gap-1.5"
          >
            <Download className="h-4 w-4" />
            Backup
          </Button>

          <label className="cursor-pointer inline-flex items-center justify-center rounded-md text-sm font-medium border border-input bg-background hover:bg-accent hover:text-accent-foreground h-9 px-3 gap-1.5 shadow-sm">
            <Upload className="h-4 w-4" />
            <span>Upload</span>
            <input 
              type="file" 
              accept=".json" 
              onChange={handleUploadBackup} 
              className="hidden" 
            />
          </label>

          <Button 
            onClick={handleSaveAll} 
            disabled={saving} 
            className="gap-2 shadow"
          >
            {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save All
          </Button>
        </div>
      </div>

      {/* Main CMS Tabs */}
      <Tabs defaultValue="hero" className="space-y-6">
        <TabsList className="grid grid-cols-2 md:grid-cols-7 w-full">
          <TabsTrigger value="hero">Hero & Notice</TabsTrigger>
          <TabsTrigger value="brand">Brand & Info</TabsTrigger>
          <TabsTrigger value="packages">Packages</TabsTrigger>
          <TabsTrigger value="retention">Retention & Perks</TabsTrigger>
          <TabsTrigger value="media">Media & TV</TabsTrigger>
          <TabsTrigger value="coverage">Coverage Map</TabsTrigger>
          <TabsTrigger value="navigation">Nav & Footer</TabsTrigger>
        </TabsList>

        {/* TAB 1: Hero & Notice */}
        <TabsContent value="hero" className="space-y-6">
          {/* Top Notice Bar */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <div>
                <CardTitle className="text-base">Top Announcement / Notice Bar</CardTitle>
                <CardDescription>Banner text shown at the very top of user portal</CardDescription>
              </div>
              <Button size="sm" onClick={() => handleSaveSection('Top Notice Banner')} className="gap-1.5 shadow-sm">
                <Save className="h-4 w-4" />
                Save Notice
              </Button>
            </CardHeader>
            <CardContent className="space-y-4 pt-2">
              <div className="flex items-center justify-between p-3 rounded-xl border bg-muted/20">
                <div>
                  <Label>Enable Notice Banner</Label>
                  <p className="text-xs text-muted-foreground">Show or hide top announcement message</p>
                </div>
                <Switch
                  checked={data.notice?.active}
                  onCheckedChange={(val) => setData({ ...data, notice: { ...data.notice, active: val } })}
                />
              </div>

              <div>
                <Label>Notice Text</Label>
                <Textarea
                  rows={2}
                  value={data.notice?.textEn || ''}
                  onChange={(e) => setData({ ...data, notice: { ...data.notice, textEn: e.target.value } })}
                  placeholder="Enter notice text..."
                />
              </div>
            </CardContent>
          </Card>

          {/* Hero Banner Section */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <div>
                <CardTitle className="text-base">Hero Banner Section</CardTitle>
                <CardDescription>Main headline, subtitles and CTA button texts</CardDescription>
              </div>
              <Button size="sm" onClick={() => handleSaveSection('Hero Section')} className="gap-1.5 shadow-sm">
                <Save className="h-4 w-4" />
                Save Hero Banner
              </Button>
            </CardHeader>
            <CardContent className="space-y-4 pt-2">
              <div>
                <Label>Badge Text</Label>
                <Input
                  value={data.hero?.badgeEn || ''}
                  onChange={(e) => setData({ ...data, hero: { ...data.hero, badgeEn: e.target.value } })}
                  placeholder="e.g. 🚀 Ultra Low-Latency Tier-1 Global Backbone"
                />
              </div>

              <div>
                <Label>Main Title</Label>
                <Input
                  value={data.hero?.titleEn || ''}
                  onChange={(e) => setData({ ...data, hero: { ...data.hero, titleEn: e.target.value } })}
                  placeholder="Main hero headline"
                />
              </div>

              <div>
                <Label>Subtitle Description</Label>
                <Textarea
                  rows={3}
                  value={data.hero?.subtitleEn || ''}
                  onChange={(e) => setData({ ...data, hero: { ...data.hero, subtitleEn: e.target.value } })}
                  placeholder="Hero subtitle description"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                <div>
                  <Label>Primary Action Button</Label>
                  <Input
                    placeholder="e.g. Explore Plans"
                    value={data.hero?.primaryBtnTextEn || ''}
                    onChange={(e) => setData({ ...data, hero: { ...data.hero, primaryBtnTextEn: e.target.value } })}
                  />
                </div>
                <div>
                  <Label>Secondary Action Button</Label>
                  <Input
                    placeholder="e.g. Check Availability"
                    value={data.hero?.secondaryBtnTextEn || ''}
                    onChange={(e) => setData({ ...data, hero: { ...data.hero, secondaryBtnTextEn: e.target.value } })}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Key Metrics / Live Stats Card */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <div>
                <CardTitle className="text-base">Performance Stats Counters</CardTitle>
                <CardDescription>Key metrics displayed in the hero section</CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const updated = [...(data.hero?.stats || []), { value: '100%', labelEn: 'Metric Name' }];
                    setData({ ...data, hero: { ...data.hero, stats: updated } });
                  }}
                  className="gap-1.5"
                >
                  <Plus className="h-4 w-4" /> Add Stat
                </Button>
                <Button size="sm" onClick={() => handleSaveSection('Live Performance Stats')} className="gap-1.5 shadow-sm">
                  <Save className="h-4 w-4" />
                  Save Stats
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4 pt-2">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {(data.hero?.stats || []).map((stat: any, idx: number) => (
                  <div key={idx} className="p-3 border rounded-xl bg-muted/20 space-y-2 relative group">
                    <button
                      type="button"
                      onClick={() => {
                        const updated = data.hero.stats.filter((_: any, i: number) => i !== idx);
                        setData({ ...data, hero: { ...data.hero, stats: updated } });
                      }}
                      className="absolute top-2 right-2 text-rose-500 hover:text-rose-700 text-xs"
                      title="Remove Stat"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                    <Label className="text-xs font-semibold">Stat #{idx + 1} Value</Label>
                    <Input
                      value={stat.value}
                      onChange={(e) => {
                        const updated = [...(data.hero?.stats || [])];
                        updated[idx].value = e.target.value;
                        setData({ ...data, hero: { ...data.hero, stats: updated } });
                      }}
                      className="font-bold h-8"
                    />
                    <Label className="text-[11px] text-muted-foreground">Label</Label>
                    <Input
                      value={stat.labelEn}
                      onChange={(e) => {
                        const updated = [...(data.hero?.stats || [])];
                        updated[idx].labelEn = e.target.value;
                        setData({ ...data, hero: { ...data.hero, stats: updated } });
                      }}
                      className="text-xs h-8"
                    />
                  </div>
                ))}
              </div>
              {(!data.hero?.stats || data.hero.stats.length === 0) && (
                <p className="text-xs text-muted-foreground italic py-2">No stats counters configured. Click "Add Stat" to create one.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* TAB 2: Brand & Contact */}
        <TabsContent value="brand" className="space-y-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <div>
                <CardTitle className="text-base">Brand Identity & Contact Channels</CardTitle>
                <CardDescription>Configure brand name, hotlines, addresses and social links</CardDescription>
              </div>
              <Button size="sm" onClick={() => handleSaveSection('Brand & Contact Details')} className="gap-1.5 shadow-sm">
                <Save className="h-4 w-4" />
                Save Brand & Info
              </Button>
            </CardHeader>
            <CardContent className="space-y-4 pt-2">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <Label>ISP Brand Name</Label>
                  <Input
                    value={data.brand?.name || ''}
                    onChange={(e) => setData({ ...data, brand: { ...data.brand, name: e.target.value } })}
                  />
                </div>
                <div>
                  <Label>Logo Subtitle</Label>
                  <Input
                    value={data.brand?.logoSubtitle || ''}
                    onChange={(e) => setData({ ...data, brand: { ...data.brand, logoSubtitle: e.target.value } })}
                  />
                </div>
                <div>
                  <Label>Brand Tagline</Label>
                  <Input
                    value={data.brand?.tagline || ''}
                    onChange={(e) => setData({ ...data, brand: { ...data.brand, tagline: e.target.value } })}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label>Helpline Phone</Label>
                  <Input
                    value={data.brand?.phone || ''}
                    onChange={(e) => setData({ ...data, brand: { ...data.brand, phone: e.target.value } })}
                  />
                </div>
                <div>
                  <Label>Support Email</Label>
                  <Input
                    value={data.brand?.email || ''}
                    onChange={(e) => setData({ ...data, brand: { ...data.brand, email: e.target.value } })}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label>Head Office Address</Label>
                  <Input
                    value={data.brand?.address || ''}
                    onChange={(e) => setData({ ...data, brand: { ...data.brand, address: e.target.value } })}
                  />
                </div>
                <div>
                  <Label>Office & Support Hours</Label>
                  <Input
                    value={data.brand?.officeHours || ''}
                    onChange={(e) => setData({ ...data, brand: { ...data.brand, officeHours: e.target.value } })}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                <div>
                  <Label>Facebook URL</Label>
                  <Input
                    value={data.brand?.facebook || ''}
                    onChange={(e) => setData({ ...data, brand: { ...data.brand, facebook: e.target.value } })}
                  />
                </div>
                <div>
                  <Label>YouTube URL</Label>
                  <Input
                    value={data.brand?.youtube || ''}
                    onChange={(e) => setData({ ...data, brand: { ...data.brand, youtube: e.target.value } })}
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* TAB 3: Packages */}
        <TabsContent value="packages" className="space-y-6">
          {/* Packages Section Titles Card */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <div>
                <CardTitle className="text-base">Packages Section Header</CardTitle>
                <CardDescription>Control heading text, badge and button text of pricing section</CardDescription>
              </div>
              <Button size="sm" onClick={() => handleSaveSection('Package Section Header')} className="gap-1.5 shadow-sm">
                <Save className="h-4 w-4" />
                Save Header Texts
              </Button>
            </CardHeader>
            <CardContent className="space-y-4 pt-2">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label>Section Badge Text</Label>
                  <Input
                    value={data.packagesSection?.badgeEn || ''}
                    onChange={(e) => setData({ ...data, packagesSection: { ...data.packagesSection, badgeEn: e.target.value } })}
                    placeholder="e.g. International Gigabit Plans"
                  />
                </div>
                <div>
                  <Label>Popular Badge Text</Label>
                  <Input
                    value={data.packagesSection?.popularBadgeEn || ''}
                    onChange={(e) => setData({ ...data, packagesSection: { ...data.packagesSection, popularBadgeEn: e.target.value } })}
                    placeholder="e.g. Most Popular"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label>Section Title</Label>
                  <Input
                    value={data.packagesSection?.titleEn || ''}
                    onChange={(e) => setData({ ...data, packagesSection: { ...data.packagesSection, titleEn: e.target.value } })}
                    placeholder="e.g. Choose Your Ideal Worldwide Fiber Plan"
                  />
                </div>
                <div>
                  <Label>Select Button Text</Label>
                  <Input
                    value={data.packagesSection?.chooseBtnEn || ''}
                    onChange={(e) => setData({ ...data, packagesSection: { ...data.packagesSection, chooseBtnEn: e.target.value } })}
                    placeholder="e.g. Select Plan"
                  />
                </div>
              </div>

              <div>
                <Label>Section Subtitle</Label>
                <Textarea
                  rows={2}
                  value={data.packagesSection?.subtitleEn || ''}
                  onChange={(e) => setData({ ...data, packagesSection: { ...data.packagesSection, subtitleEn: e.target.value } })}
                  placeholder="Subtitle for packages section"
                />
              </div>
            </CardContent>
          </Card>

          {/* Packages List Card */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <div>
                <CardTitle className="text-base">Website Internet Packages</CardTitle>
                <CardDescription>Control which plans appear on the public portal (Live sync)</CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const newPkg = {
                      id: `PKG-${Date.now().toString().slice(-4)}`,
                      name: 'Gigabit Plan',
                      speed: 100,
                      uploadSpeed: 100,
                      price: 49,
                      bdixSpeed: 500,
                      popular: false,
                      features: ['100 Mbps Symmetrical Line', 'Unlimited Bandwidth', '24/7 Support'],
                    };
                    setData({ ...data, packages: [...(data.packages || []), newPkg] });
                  }}
                  className="gap-1.5"
                >
                  <Plus className="h-4 w-4" />
                  Add Plan
                </Button>
                <Button size="sm" onClick={() => handleSaveSection('Packages List')} className="gap-1.5 shadow-sm">
                  <Save className="h-4 w-4" />
                  Save Packages
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4 pt-2">
              {(data.packages || []).map((pkg: any, idx: number) => (
                <div key={pkg.id || idx} className="rounded-xl border p-4 space-y-3 bg-muted/20">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-xs text-primary">{pkg.id}</span>
                      <Input
                        value={pkg.name}
                        onChange={(e) => {
                          const updated = [...data.packages];
                          updated[idx].name = e.target.value;
                          setData({ ...data, packages: updated });
                        }}
                        className="font-bold h-8 w-48 text-sm"
                        placeholder="Plan Name"
                      />
                    </div>
                    <div className="flex items-center gap-3">
                      <label className="flex items-center gap-1.5 text-xs font-medium cursor-pointer">
                        <input
                          type="checkbox"
                          checked={pkg.popular}
                          onChange={(e) => {
                            const updated = [...data.packages];
                            updated[idx].popular = e.target.checked;
                            setData({ ...data, packages: updated });
                          }}
                          className="rounded text-primary"
                        />
                        Popular Badge
                      </label>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          const updated = data.packages.filter((_: any, i: number) => i !== idx);
                          setData({ ...data, packages: updated });
                        }}
                        className="h-8 w-8 p-0 text-rose-500 hover:text-rose-600 hover:bg-rose-50"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                    <div>
                      <Label className="text-xs">Download (Mbps)</Label>
                      <Input
                        type="number"
                        value={pkg.speed}
                        onChange={(e) => {
                          const updated = [...data.packages];
                          updated[idx].speed = Number(e.target.value);
                          setData({ ...data, packages: updated });
                        }}
                        className="h-8 mt-1"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Upload (Mbps)</Label>
                      <Input
                        type="number"
                        value={pkg.uploadSpeed || pkg.speed}
                        onChange={(e) => {
                          const updated = [...data.packages];
                          updated[idx].uploadSpeed = Number(e.target.value);
                          setData({ ...data, packages: updated });
                        }}
                        className="h-8 mt-1"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Monthly Price ($)</Label>
                      <Input
                        type="number"
                        value={pkg.price}
                        onChange={(e) => {
                          const updated = [...data.packages];
                          updated[idx].price = Number(e.target.value);
                          setData({ ...data, packages: updated });
                        }}
                        className="h-8 mt-1"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Peering Speed (Mbps)</Label>
                      <Input
                        type="number"
                        value={pkg.bdixSpeed || 200}
                        onChange={(e) => {
                          const updated = [...data.packages];
                          updated[idx].bdixSpeed = Number(e.target.value);
                          setData({ ...data, packages: updated });
                        }}
                        className="h-8 mt-1"
                      />
                    </div>
                  </div>
                </div>
              ))}
              {(!data.packages || data.packages.length === 0) && (
                <div className="py-8 text-center border-2 border-dashed rounded-xl border-border/60">
                  <p className="text-sm font-semibold text-muted-foreground">No Packages Configured</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Click "Add Plan" above to create internet packages. When no packages exist, the pricing section is cleanly hidden on the frontend.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* TAB 4: Retention & Perks */}
        <TabsContent value="retention" className="space-y-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Gift className="h-5 w-5 text-primary" />
                  Customer Retention & Loyalty Incentives
                </CardTitle>
                <CardDescription>
                  Configure subscriber rewards, turbo speed boost, and loyalty programs
                </CardDescription>
              </div>
              <Button size="sm" onClick={() => handleSaveSection('Customer Retention Settings')} className="gap-1.5 shadow-sm">
                <Save className="h-4 w-4" />
                Save Retention Settings
              </Button>
            </CardHeader>
            <CardContent className="space-y-6 pt-2">
              {/* Card 1: Referral */}
              <div className="rounded-xl border p-4 bg-muted/20 space-y-4">
                <h4 className="font-semibold text-sm flex items-center gap-2 border-b pb-2">
                  <Gift className="h-4 w-4 text-emerald-500" />
                  Refer & Earn Program
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label className="text-xs">Card Title</Label>
                    <Input
                      value={data.retention?.referralTitleEn || ''}
                      onChange={(e) => setData({ ...data, retention: { ...data.retention, referralTitleEn: e.target.value } })}
                      placeholder="e.g. Refer a Neighbor, Get $25 Bill Credit!"
                      className="h-8 text-xs mt-1"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Description</Label>
                    <Input
                      value={data.retention?.referralDescEn || ''}
                      onChange={(e) => setData({ ...data, retention: { ...data.retention, referralDescEn: e.target.value } })}
                      placeholder="Description for referral program"
                      className="h-8 text-xs mt-1"
                    />
                  </div>
                </div>
              </div>

              {/* Card 2: Turbo Boost */}
              <div className="rounded-xl border p-4 bg-muted/20 space-y-4">
                <h4 className="font-semibold text-sm flex items-center gap-2 border-b pb-2">
                  <Zap className="h-4 w-4 text-amber-500" />
                  1-Click Turbo Speed Boost
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label className="text-xs">Card Title</Label>
                    <Input
                      value={data.retention?.turboTitleEn || ''}
                      onChange={(e) => setData({ ...data, retention: { ...data.retention, turboTitleEn: e.target.value } })}
                      placeholder="e.g. Instant 500 Mbps Boost"
                      className="h-8 text-xs mt-1"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Description</Label>
                    <Input
                      value={data.retention?.turboDescEn || ''}
                      onChange={(e) => setData({ ...data, retention: { ...data.retention, turboDescEn: e.target.value } })}
                      placeholder="Description for turbo boost"
                      className="h-8 text-xs mt-1"
                    />
                  </div>
                </div>
              </div>

              {/* Card 3: VIP Loyalty */}
              <div className="rounded-xl border p-4 bg-muted/20 space-y-4">
                <h4 className="font-semibold text-sm flex items-center gap-2 border-b pb-2">
                  VIP Loyalty Status
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label className="text-xs">Card Title</Label>
                    <Input
                      value={data.retention?.vipTitleEn || ''}
                      onChange={(e) => setData({ ...data, retention: { ...data.retention, vipTitleEn: e.target.value } })}
                      placeholder="e.g. Free Static IP & Annual Renewal Perk"
                      className="h-8 text-xs mt-1"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Description</Label>
                    <Input
                      value={data.retention?.vipDescEn || ''}
                      onChange={(e) => setData({ ...data, retention: { ...data.retention, vipDescEn: e.target.value } })}
                      placeholder="Description for VIP loyalty status"
                      className="h-8 text-xs mt-1"
                    />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* TAB 5: Media & TV */}
        <TabsContent value="media" className="space-y-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Tv className="h-5 w-5 text-primary" />
                  CDN & Peering Entertainment Links
                </CardTitle>
                <CardDescription>Configure local peering URLs and entertainment portals</CardDescription>
              </div>
              <Button size="sm" onClick={() => handleSaveSection('Media & Entertainment Hubs')} className="gap-1.5 shadow-sm">
                <Save className="h-4 w-4" />
                Save Media Links
              </Button>
            </CardHeader>
            <CardContent className="space-y-4 pt-2">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label>Section Title</Label>
                  <Input
                    value={data.mediaHubs?.titleEn || ''}
                    onChange={(e) => setData({ ...data, mediaHubs: { ...data.mediaHubs, titleEn: e.target.value } })}
                    placeholder="e.g. Free High-Speed CDN & Peering Services"
                  />
                </div>
                <div>
                  <Label>Section Subtitle</Label>
                  <Input
                    value={data.mediaHubs?.subtitleEn || ''}
                    onChange={(e) => setData({ ...data, mediaHubs: { ...data.mediaHubs, subtitleEn: e.target.value } })}
                    placeholder="Subtitle for media hubs"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <Label>Storage CDN FTP URL</Label>
                  <Input
                    value={data.mediaHubs?.ftpUrl || ''}
                    onChange={(e) => setData({ ...data, mediaHubs: { ...data.mediaHubs, ftpUrl: e.target.value } })}
                    placeholder="https://ftp.yourisp.com"
                  />
                </div>
                <div>
                  <Label>Live TV Portal URL</Label>
                  <Input
                    value={data.mediaHubs?.liveTvUrl || ''}
                    onChange={(e) => setData({ ...data, mediaHubs: { ...data.mediaHubs, liveTvUrl: e.target.value } })}
                    placeholder="https://tv.yourisp.com"
                  />
                </div>
                <div>
                  <Label>Speedtest URL</Label>
                  <Input
                    value={data.mediaHubs?.speedtestUrl || ''}
                    onChange={(e) => setData({ ...data, mediaHubs: { ...data.mediaHubs, speedtestUrl: e.target.value } })}
                    placeholder="https://speedtest.net"
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* TAB 6: Coverage */}
        <TabsContent value="coverage" className="space-y-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  <MapPin className="h-5 w-5 text-primary" />
                  Coverage Areas & Service Map
                </CardTitle>
                <CardDescription>Zones where fiber connectivity is live or expanding</CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const newArea = { zone: 'New Metro Zone', district: 'Downtown', status: 'Active' };
                    setData({ ...data, coverageAreas: [...(data.coverageAreas || []), newArea] });
                  }}
                  className="gap-1.5"
                >
                  <Plus className="h-4 w-4" />
                  Add Area
                </Button>
                <Button size="sm" onClick={() => handleSaveSection('Coverage Areas')} className="gap-1.5 shadow-sm">
                  <Save className="h-4 w-4" />
                  Save Coverage
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3 pt-2">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pb-2">
                <div>
                  <Label>Coverage Section Title</Label>
                  <Input
                    value={data.coverageSection?.titleEn || ''}
                    onChange={(e) => setData({ ...data, coverageSection: { ...data.coverageSection, titleEn: e.target.value } })}
                    placeholder="e.g. Worldwide Active Metro Coverage Zones"
                  />
                </div>
                <div>
                  <Label>Coverage Section Subtitle</Label>
                  <Input
                    value={data.coverageSection?.subtitleEn || ''}
                    onChange={(e) => setData({ ...data, coverageSection: { ...data.coverageSection, subtitleEn: e.target.value } })}
                    placeholder="Coverage subtitle"
                  />
                </div>
              </div>

              {(data.coverageAreas || []).map((area: any, idx: number) => (
                <div key={idx} className="flex flex-col sm:flex-row items-start sm:items-center gap-2 p-3 rounded-lg border bg-muted/20">
                  <Input
                    value={area.zone}
                    onChange={(e) => {
                      const updated = [...data.coverageAreas];
                      updated[idx].zone = e.target.value;
                      setData({ ...data, coverageAreas: updated });
                    }}
                    placeholder="Zone Name"
                    className="h-8 w-44 text-sm font-semibold"
                  />
                  <Input
                    value={area.district}
                    onChange={(e) => {
                      const updated = [...data.coverageAreas];
                      updated[idx].district = e.target.value;
                      setData({ ...data, coverageAreas: updated });
                    }}
                    placeholder="District / State"
                    className="h-8 flex-1 text-sm"
                  />
                  <Input
                    value={area.status}
                    onChange={(e) => {
                      const updated = [...data.coverageAreas];
                      updated[idx].status = e.target.value;
                      setData({ ...data, coverageAreas: updated });
                    }}
                    placeholder="Status (e.g. Active)"
                    className="h-8 w-32 text-sm font-medium"
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      const updated = data.coverageAreas.filter((_: any, i: number) => i !== idx);
                      setData({ ...data, coverageAreas: updated });
                    }}
                    className="h-8 w-8 p-0 text-rose-500"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              {(!data.coverageAreas || data.coverageAreas.length === 0) && (
                <div className="py-8 text-center border-2 border-dashed rounded-xl border-border/60">
                  <p className="text-sm font-semibold text-muted-foreground">No Coverage Zones Configured</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Click "Add Area" above to define active service zones. When empty, the coverage summary is hidden on the frontend.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* TAB 7: Navigation & Footer */}
        <TabsContent value="navigation" className="space-y-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <div>
                <CardTitle className="text-base">Navigation Menu & Buttons</CardTitle>
                <CardDescription>Control the labels displayed on the top header navigation</CardDescription>
              </div>
              <Button size="sm" onClick={() => handleSaveSection('Navigation Menu Labels')} className="gap-1.5 shadow-sm">
                <Save className="h-4 w-4" />
                Save Nav Menu
              </Button>
            </CardHeader>
            <CardContent className="space-y-4 pt-2">
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                <div className="p-3 border rounded-xl bg-muted/20 space-y-1">
                  <Label className="text-xs font-semibold">Home Label</Label>
                  <Input
                    value={data.nav?.homeEn || ''}
                    onChange={(e) => setData({ ...data, nav: { ...data.nav, homeEn: e.target.value } })}
                    className="h-8 text-xs"
                  />
                </div>
                <div className="p-3 border rounded-xl bg-muted/20 space-y-1">
                  <Label className="text-xs font-semibold">Coverage Label</Label>
                  <Input
                    value={data.nav?.coverageEn || ''}
                    onChange={(e) => setData({ ...data, nav: { ...data.nav, coverageEn: e.target.value } })}
                    className="h-8 text-xs"
                  />
                </div>
                <div className="p-3 border rounded-xl bg-muted/20 space-y-1">
                  <Label className="text-xs font-semibold">Order Service Label</Label>
                  <Input
                    value={data.nav?.applyEn || ''}
                    onChange={(e) => setData({ ...data, nav: { ...data.nav, applyEn: e.target.value } })}
                    className="h-8 text-xs"
                  />
                </div>
                <div className="p-3 border rounded-xl bg-muted/20 space-y-1">
                  <Label className="text-xs font-semibold">Support Label</Label>
                  <Input
                    value={data.nav?.supportEn || ''}
                    onChange={(e) => setData({ ...data, nav: { ...data.nav, supportEn: e.target.value } })}
                    className="h-8 text-xs"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                <div>
                  <Label className="text-xs">Navbar Login Button</Label>
                  <Input
                    value={data.nav?.loginBtnEn || ''}
                    onChange={(e) => setData({ ...data, nav: { ...data.nav, loginBtnEn: e.target.value } })}
                    className="h-8 text-xs mt-1"
                  />
                </div>
                <div>
                  <Label className="text-xs">Navbar Apply Button</Label>
                  <Input
                    value={data.nav?.applyBtnEn || ''}
                    onChange={(e) => setData({ ...data, nav: { ...data.nav, applyBtnEn: e.target.value } })}
                    className="h-8 text-xs mt-1"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* CTA Banner & Footer Copyright */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <div>
                <CardTitle className="text-base">Bottom Banner & Footer</CardTitle>
                <CardDescription>Control the bottom call-to-action banner and footer copyright</CardDescription>
              </div>
              <Button size="sm" onClick={() => handleSaveSection('CTA Banner & Footer')} className="gap-1.5 shadow-sm">
                <Save className="h-4 w-4" />
                Save Footer Info
              </Button>
            </CardHeader>
            <CardContent className="space-y-4 pt-2">
              <div>
                <Label>CTA Banner Headline</Label>
                <Input
                  value={data.ctaBanner?.titleEn || ''}
                  onChange={(e) => setData({ ...data, ctaBanner: { ...data.ctaBanner, titleEn: e.target.value } })}
                />
              </div>

              <div>
                <Label>Footer Copyright Line</Label>
                <Input
                  value={data.footer?.copyrightEn || ''}
                  onChange={(e) => setData({ ...data, footer: { ...data.footer, copyrightEn: e.target.value } })}
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
