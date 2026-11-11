'use client';

import { useState, useEffect, useMemo } from 'react';
import { 
  Plus, Edit2, Trash2, Check, Zap, Globe, ArrowDown, ArrowUp, Save, 
  Layers, RotateCcw, Sparkles, Wifi, Shield, Server
} from 'lucide-react';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { type Package, type PackageCategory, mockPackages } from '@/lib/mockData';
import { useAdminTranslation } from '@/store/settingsStore';
import { useAdminDataStore } from '@/store/adminDataStore';
import crypto from 'crypto';

export default function PackagesPage() {
  const { t } = useAdminTranslation();
  const { packages, addPackage, updatePackage, deletePackage, clearCollection, saveCollection, fetchData } = useAdminDataStore();
  
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingPkg, setEditingPkg] = useState<Package | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<'All' | PackageCategory>('All');

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Form State
  const [name, setName] = useState('');
  const [downloadSpeed, setDownloadSpeed] = useState('');
  const [uploadSpeed, setUploadSpeed] = useState('');
  const [price, setPrice] = useState('');
  const [category, setCategory] = useState<PackageCategory>('Home Internet');
  const [targetCustomer, setTargetCustomer] = useState('');
  const [badge, setBadge] = useState('');
  const [description, setDescription] = useState('');

  const openAdd = () => {
    setEditingPkg(null);
    setName('');
    setDownloadSpeed('100');
    setUploadSpeed('100');
    setPrice('19.99');
    setCategory('Home Internet');
    setTargetCustomer('Individual / Small Household');
    setBadge('');
    setDescription('Symmetrical optical fiber connectivity with low-latency global peering.');
    setDialogOpen(true);
  };

  const openEdit = (pkg: Package) => {
    setEditingPkg(pkg);
    setName(pkg.name);
    setDownloadSpeed(pkg.downloadSpeed.toString());
    setUploadSpeed(pkg.uploadSpeed.toString());
    setPrice(pkg.price.toString());
    setCategory(pkg.category || 'Home Internet');
    setTargetCustomer(pkg.targetCustomer || '');
    setBadge(pkg.badge || '');
    setDescription(pkg.description || '');
    setDialogOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const parsedPrice = parseFloat(price) || 0;
    const parsedDown = parseInt(downloadSpeed) || 100;
    const parsedUp = parseInt(uploadSpeed) || parsedDown;

    if (editingPkg) {
      await updatePackage({
        ...editingPkg,
        name,
        downloadSpeed: parsedDown,
        uploadSpeed: parsedUp,
        price: parsedPrice,
        category,
        targetCustomer,
        badge: badge || undefined,
        description,
      });
      toast.success(t('Package updated and saved permanently to disk!', 'Package updated and saved to disk!'));
    } else {
      const newPkg: Package = {
        // A UUID suffix keeps the id unique. The previous value came from a
        // space of 10,000 numbers that repeated every 10 seconds, so two
        // plans could overwrite each other.
        id: `PKG-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
        name,
        downloadSpeed: parsedDown,
        uploadSpeed: parsedUp,
        price: parsedPrice,
        duration: 30,
        category,
        targetCustomer,
        badge: badge || undefined,
        description,
        subscriberCount: 0,
        popular: false,
        features: [
          `${parsedDown} Mbps Symmetrical Fiber`,
          'Unlimited Global Data',
          'Optical Fiber GPON Drop',
          'Sub-millisecond Edge Peering'
        ],
        unlimitedData: true,
        symmetricalSpeed: true,
        fiberConnection: true,
        ipv6Support: true,
        gamingOptimized: true,
        streaming4k8k: true,
        staticIp: 'Add-on',
        prioritySupport: false,
        dedicatedBandwidth: '—',
        businessSla: '—',
        support24_7: false,
      };
      await addPackage(newPkg);
      toast.success(t('New package created and saved to disk!', 'New package created and saved to disk!'));
    }
    setDialogOpen(false);
  };

  const handleDelete = async (id: string) => {
    if (confirm('Are you sure you want to delete this package?')) {
      await deletePackage(id);
      toast.success('Package deleted and saved permanently to disk!');
    }
  };

  // Reset to NextLink Global 8 Standard Plans
  const handleResetToStandardGlobal = async () => {
    if (confirm('Reset packages to the 8 official NextLink Global Internet Plans (Essential to Business Pro)? This will update all packages.')) {
      await saveCollection('packages', mockPackages);
      toast.success('Reset to 8 NextLink Global Standard Plans successfully!');
      fetchData();
    }
  };

  const filteredPackages = useMemo(() => {
    if (selectedCategory === 'All') return packages;
    return packages.filter(p => p.category === selectedCategory);
  }, [packages, selectedCategory]);

  const formatSpeed = (speed: number) => {
    if (speed >= 1000) return `${speed / 1000} Gbps (${speed} Mbps)`;
    return `${speed} Mbps`;
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">
              {t('packages', 'Internet Packages Management')}
            </h1>
            <Badge variant="outline" className="text-xs bg-primary/10 text-primary border-primary/20">
              NextLink Global Standard
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Configure symmetrical fiber bandwidth tiers, international monthly pricing, and SLA features. (Persisted to PostgreSQL & disk)
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleResetToStandardGlobal}
            className="gap-2 text-primary hover:bg-primary/5"
            title="Reload standard 8 Global Plans"
          >
            <RotateCcw className="h-4 w-4" />
            Load 8 Global Plans
          </Button>

          <Button 
            variant="outline"
            size="sm"
            onClick={async () => {
              await saveCollection('packages', packages);
              toast.success('All packages saved permanently to disk!');
            }} 
            className="gap-2 shadow-sm"
          >
            <Save className="h-4 w-4" />
            Save Changes
          </Button>

          <Button size="sm" onClick={openAdd} className="gap-2 shadow">
            <Plus className="h-4 w-4" />
            {t('add', 'Add Package')}
          </Button>
        </div>
      </div>

      {/* Category Tabs */}
      <div className="flex flex-wrap items-center gap-2 border-b pb-3">
        <Button
          variant={selectedCategory === 'All' ? 'default' : 'ghost'}
          size="sm"
          onClick={() => setSelectedCategory('All')}
          className="rounded-lg text-xs"
        >
          All Categories ({packages.length})
        </Button>

        <Button
          variant={selectedCategory === 'Home Internet' ? 'default' : 'ghost'}
          size="sm"
          onClick={() => setSelectedCategory('Home Internet')}
          className="rounded-lg text-xs"
        >
          1. Home Internet
        </Button>

        <Button
          variant={selectedCategory === 'Advanced Internet' ? 'default' : 'ghost'}
          size="sm"
          onClick={() => setSelectedCategory('Advanced Internet')}
          className="rounded-lg text-xs"
        >
          2. Advanced Internet
        </Button>

        <Button
          variant={selectedCategory === 'Business Internet' ? 'default' : 'ghost'}
          size="sm"
          onClick={() => setSelectedCategory('Business Internet')}
          className="rounded-lg text-xs"
        >
          3. Business Internet
        </Button>
      </div>

      {/* Package Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
        {filteredPackages.length === 0 ? (
          <div className="col-span-full py-12 text-center border-2 border-dashed rounded-xl border-border/60">
            <Layers className="h-10 w-10 text-muted-foreground/40 mx-auto mb-2" />
            <p className="text-sm font-semibold text-muted-foreground">No Packages Found in this Category</p>
            <p className="text-xs text-muted-foreground mt-1">Click &quot;Load 8 Global Plans&quot; or &quot;Add Package&quot; to configure plans.</p>
          </div>
        ) : (
          filteredPackages.map((pkg) => (
            <Card key={pkg.id} className="border shadow-sm flex flex-col justify-between hover:shadow-md transition-shadow">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <Badge variant="outline" className="font-mono text-[11px]">{pkg.id}</Badge>
                  <Badge className="bg-primary/10 text-primary border-primary/20 text-[10px]">
                    {pkg.category || 'Home Internet'}
                  </Badge>
                </div>

                <div className="mt-2">
                  <CardTitle className="text-lg font-bold">{pkg.name}</CardTitle>
                  {pkg.targetCustomer && (
                    <span className="text-[11px] text-muted-foreground block mt-0.5 font-medium">
                      🎯 {pkg.targetCustomer}
                    </span>
                  )}
                </div>

                <CardDescription className="text-xs line-clamp-2 mt-1">
                  {pkg.description}
                </CardDescription>
              </CardHeader>

              <CardContent className="space-y-4 pt-0">
                <div className="rounded-xl bg-muted/40 p-3 space-y-2 border">
                  <div className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <ArrowDown className="h-3.5 w-3.5 text-emerald-500" />
                      Download
                    </span>
                    <span className="font-bold">{formatSpeed(pkg.downloadSpeed)}</span>
                  </div>

                  <div className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <ArrowUp className="h-3.5 w-3.5 text-blue-500" />
                      Upload
                    </span>
                    <span className="font-bold">{formatSpeed(pkg.uploadSpeed)}</span>
                  </div>

                  <div className="flex items-center justify-between text-xs pt-1.5 border-t">
                    <span className="text-muted-foreground">Billing Duration</span>
                    <span className="font-mono">{pkg.duration || 30} Days</span>
                  </div>
                </div>

                <div className="flex items-baseline justify-between">
                  <div>
                    <span className="text-2xl font-extrabold text-foreground">
                      ${pkg.price.toFixed(2)}
                    </span>
                    <span className="text-xs text-muted-foreground font-medium"> / month</span>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 pt-2 border-t">
                  <Button size="sm" variant="outline" onClick={() => openEdit(pkg)} className="h-8 gap-1.5 text-xs">
                    <Edit2 className="h-3.5 w-3.5" />
                    {t('edit', 'Edit')}
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => handleDelete(pkg.id)} className="h-8 gap-1.5 text-xs">
                    <Trash2 className="h-3.5 w-3.5" />
                    {t('delete', 'Delete')}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* Edit / Add Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingPkg ? 'Edit Package' : 'Create New Package'}
            </DialogTitle>
            <DialogDescription>
              Configure symmetrical speeds, international monthly pricing, and customer target group.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSave} className="space-y-4 py-2">
            <div>
              <Label>Package Name *</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Essential, Gigabit, Ultra" required />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Category</Label>
                <Select value={category} onValueChange={(val) => setCategory(val as PackageCategory)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Category" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Home Internet">1. Home Internet</SelectItem>
                    <SelectItem value="Advanced Internet">2. Advanced Internet</SelectItem>
                    <SelectItem value="Business Internet">3. Business Internet</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Target Customer</Label>
                <Input 
                  value={targetCustomer} 
                  onChange={(e) => setTargetCustomer(e.target.value)} 
                  placeholder="e.g. Regular Home Users" 
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Download Speed (Mbps)</Label>
                <Input 
                  type="number" 
                  value={downloadSpeed} 
                  onChange={(e) => setDownloadSpeed(e.target.value)} 
                  placeholder="100, 1000, 5000"
                  required 
                />
              </div>

              <div>
                <Label>Upload Speed (Mbps)</Label>
                <Input 
                  type="number" 
                  value={uploadSpeed} 
                  onChange={(e) => setUploadSpeed(e.target.value)} 
                  placeholder="100, 1000, 5000"
                  required 
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Monthly Price (USD $)</Label>
                <Input 
                  type="number" 
                  step="0.01" 
                  value={price} 
                  onChange={(e) => setPrice(e.target.value)} 
                  placeholder="19.99"
                  required 
                />
              </div>

              <div>
                <Label>Badge Label (Optional)</Label>
                <Input 
                  value={badge} 
                  onChange={(e) => setBadge(e.target.value)} 
                  placeholder="e.g. MOST POPULAR" 
                />
              </div>
            </div>

            <div>
              <Label>Description</Label>
              <Textarea 
                value={description} 
                onChange={(e) => setDescription(e.target.value)} 
                rows={3} 
                placeholder="High-speed symmetrical optical fiber plan details..."
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit">
                {t('save', 'Save Package')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
