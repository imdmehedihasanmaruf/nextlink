'use client';
import { useState, useEffect } from 'react';
import { Plus, Edit2, Trash2, Check, Zap, Globe, ArrowDown, ArrowUp, Save, Layers } from 'lucide-react';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { type Package } from '@/lib/mockData';
import { useSettingsStore, useAdminTranslation } from '@/store/settingsStore';
import { useAdminDataStore } from '@/store/adminDataStore';

export default function PackagesPage() {
  const { t } = useAdminTranslation();
  const { packages, addPackage, updatePackage, deletePackage, clearCollection, saveCollection, fetchData } = useAdminDataStore();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingPkg, setEditingPkg] = useState<Package | null>(null);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Form State
  const [name, setName] = useState('');
  const [downloadSpeed, setDownloadSpeed] = useState('');
  const [uploadSpeed, setUploadSpeed] = useState('');
  const [price, setPrice] = useState('');
  const [description, setDescription] = useState('');

  const openAdd = () => {
    setEditingPkg(null);
    setName('');
    setDownloadSpeed('25');
    setUploadSpeed('25');
    setPrice('79');
    setDescription('High-speed fiber connectivity with global peering');
    setDialogOpen(true);
  };

  const openEdit = (pkg: Package) => {
    setEditingPkg(pkg);
    setName(pkg.name);
    setDownloadSpeed(pkg.downloadSpeed.toString());
    setUploadSpeed(pkg.uploadSpeed.toString());
    setPrice(pkg.price.toString());
    setDescription(pkg.description);
    setDialogOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    if (editingPkg) {
      await updatePackage({
        ...editingPkg,
        name,
        downloadSpeed: Number(downloadSpeed),
        uploadSpeed: Number(uploadSpeed),
        price: Number(price),
        description,
      });
      toast.success(t('Package updated and saved permanently to disk!', 'Package updated and saved to disk!'));
    } else {
      const newPkg: Package = {
        id: `PKG-${Date.now().toString().slice(-4)}`,
        name,
        downloadSpeed: Number(downloadSpeed),
        uploadSpeed: Number(uploadSpeed),
        price: Number(price),
        duration: 30,
        description,
        subscriberCount: 0,
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

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {t('packages', 'Internet Packages Management')}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Configure bandwidth tiers, rates, and Mikrotik rate-limit profiles. (Auto-persisted to disk)
          </p>
        </div>
        <div className="flex items-center gap-2">
          {packages.length > 0 && (
            <Button
              variant="outline"
              onClick={async () => {
                if (confirm('Delete all packages? This will remove all package tariffs.')) {
                  await clearCollection('packages');
                  toast.success('All packages deleted');
                }
              }}
              className="gap-2 text-rose-600 hover:text-rose-700 hover:bg-rose-50"
            >
              <Trash2 className="h-4 w-4" />
              Delete All Packages
            </Button>
          )}
          <Button 
            variant="outline" 
            onClick={async () => {
              await saveCollection('packages', packages);
              toast.success('All packages saved permanently to disk!');
            }} 
            className="gap-2 shadow-sm"
          >
            <Save className="h-4 w-4" />
            Save Packages
          </Button>
          <Button onClick={openAdd} className="gap-2 shadow">
            <Plus className="h-4 w-4" />
            {t('add', 'Add Package')}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {packages.length === 0 ? (
          <div className="col-span-full py-12 text-center border-2 border-dashed rounded-xl border-border/60">
            <Layers className="h-10 w-10 text-muted-foreground/40 mx-auto mb-2" />
            <p className="text-sm font-semibold text-muted-foreground">No Packages Configured</p>
            <p className="text-xs text-muted-foreground mt-1">Click Add Package to create your first internet tariff.</p>
          </div>
        ) : (
          packages.map((pkg) => (
            <Card key={pkg.id} className="border shadow-sm flex flex-col justify-between hover:shadow-md transition-shadow">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <Badge variant="outline" className="font-mono">{pkg.id}</Badge>
                  <Badge className="bg-primary/10 text-primary border-primary/20">
                    {pkg.subscriberCount || 0} Subscribers
                  </Badge>
                </div>
                <CardTitle className="text-xl mt-2">{pkg.name}</CardTitle>
                <CardDescription>{pkg.description}</CardDescription>
              </CardHeader>

              <CardContent className="space-y-4 pt-0">
                <div className="rounded-xl bg-muted/40 p-4 space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <ArrowDown className="h-4 w-4 text-emerald-500" />
                      Download
                    </span>
                    <span className="font-bold">{pkg.downloadSpeed} Mbps</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <ArrowUp className="h-4 w-4 text-blue-500" />
                      Upload
                    </span>
                    <span className="font-bold">{pkg.uploadSpeed} Mbps</span>
                  </div>
                  <div className="flex items-center justify-between text-sm pt-2 border-t">
                    <span className="text-muted-foreground">Validity</span>
                    <span>{pkg.duration} Days</span>
                  </div>
                </div>

                <div className="flex items-baseline justify-between">
                  <div>
                    <span className="text-3xl font-extrabold text-primary">${pkg.price.toLocaleString()}</span>
                    <span className="text-xs text-muted-foreground"> / month</span>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 pt-2 border-t">
                  <Button size="sm" variant="outline" onClick={() => openEdit(pkg)} className="gap-1.5">
                    <Edit2 className="h-3.5 w-3.5" />
                    {t('edit', 'Edit')}
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => handleDelete(pkg.id)} className="gap-1.5">
                    <Trash2 className="h-3.5 w-3.5" />
                    {t('delete', 'Delete')}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingPkg ? 'Edit Package' : 'Create New Package'}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSave} className="space-y-4 py-2">
            <div>
              <Label>Package Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Turbo 30 Mbps" required />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Download Speed (Mbps)</Label>
                <Input type="number" value={downloadSpeed} onChange={(e) => setDownloadSpeed(e.target.value)} required />
              </div>
              <div>
                <Label>Upload Speed (Mbps)</Label>
                <Input type="number" value={uploadSpeed} onChange={(e) => setUploadSpeed(e.target.value)} required />
              </div>
            </div>
            <div>
              <Label>Monthly Fee (BDT)</Label>
              <Input type="number" value={price} onChange={(e) => setPrice(e.target.value)} required />
            </div>
            <div>
              <Label>Description & Features</Label>
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
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
