'use client';
import { useState, useEffect } from 'react';
import { 
  Network, Save, Plus, Trash2, ArrowUpRight, 
  Activity, Globe, HardDrive, Tv, ExternalLink, RefreshCw
} from 'lucide-react';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useAdminDataStore } from '@/store/adminDataStore';

export default function CloudPeeringHubsPage() {
  const { peeringHubs, saveItem, fetchData } = useAdminDataStore();
  const [loading, setLoading] = useState(false);
  const [hubs, setHubs] = useState<any[]>([]);

  // Add Hub Modal State
  const [dialogOpen, setDialogOpen] = useState(false);
  const [hubName, setHubName] = useState('');
  const [hubUrl, setHubUrl] = useState('');
  const [hubBadge, setHubBadge] = useState('Gigabit');
  const [hubCategory, setHubCategory] = useState('cdn');
  const [hubStatus, setHubStatus] = useState('Active');

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (peeringHubs) {
      setHubs(Array.isArray(peeringHubs) ? peeringHubs : []);
    }
  }, [peeringHubs]);

  const handleSave = async (updatedHubs?: any[]) => {
    setLoading(true);
    const activeList = updatedHubs !== undefined ? updatedHubs : hubs;
    try {
      await saveItem('peeringHubs', activeList);
      toast.success('Cloud Peering Hubs saved & synced to Frontend Portal!');
    } catch (error: any) {
      toast.error(error?.message || 'The peering hubs could not be saved.');
    } finally {
      setLoading(false);
    }
  };

  const handleAddHub = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hubName.trim() || !hubUrl.trim()) return;

    const newHub = {
      id: `HUB-${Date.now().toString().slice(-4)}`,
      name: hubName,
      url: hubUrl,
      badge: hubBadge || 'Gigabit',
      category: hubCategory || 'cdn',
      status: hubStatus || 'Active',
    };

    const updated = [...hubs, newHub];
    setHubs(updated);
    setDialogOpen(false);
    setHubName('');
    setHubUrl('');
    await handleSave(updated);
  };

  const handleDeleteHub = async (id: string) => {
    if (confirm('Delete this peering hub from subscriber dashboard?')) {
      const updated = hubs.filter(h => h.id !== id);
      setHubs(updated);
      await handleSave(updated);
      toast.success('Peering hub deleted!');
    }
  };

  const handleClearAllHubs = async () => {
    if (confirm('Clear all cloud peering hub links?')) {
      setHubs([]);
      await handleSave([]);
      toast.success('All peering hubs cleared!');
    }
  };

  const handleResetDefaults = async () => {
    if (confirm('Reset to default Cloud Peering Hubs?')) {
      const defaultHubs = [
        { id: 'HUB-1', name: 'Speedtest Diagnostic', url: 'https://speedtest.net', badge: 'Tier-1', category: 'speedtest', status: 'Active' },
        { id: 'HUB-2', name: 'Global Storage CDN', url: 'https://storage.nextlink.global', badge: 'Gigabit', category: 'cdn', status: 'Active' },
        { id: 'HUB-3', name: 'Ultra HD Streaming', url: 'https://tv.nextlink.global', badge: '4K HDR', category: 'streaming', status: 'Active' },
        { id: 'HUB-4', name: 'Cloudflare IX Gateway', url: 'https://cloudflare.com', badge: 'Edge Anycast', category: 'peering', status: 'Active' },
      ];
      setHubs(defaultHubs);
      await handleSave(defaultHubs);
      toast.success('Default peering hubs restored!');
    }
  };

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'speedtest': return <Activity className="h-4 w-4 text-primary" />;
      case 'streaming': return <Tv className="h-4 w-4 text-purple-600" />;
      case 'cdn': return <HardDrive className="h-4 w-4 text-blue-600" />;
      default: return <Globe className="h-4 w-4 text-emerald-600" />;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2.5">
            <Network className="h-6 w-6 text-primary" />
            Cloud Peering Hubs Management
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Configure Zero-buffering content delivery networks, BDIX peering pipes, and client media hubs.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleResetDefaults} className="gap-1.5 text-xs text-rose-600 border-rose-200 hover:bg-rose-50">
            <Trash2 className="h-3.5 w-3.5" />
            Reset Defaults
          </Button>
          <Button onClick={() => handleSave()} disabled={loading} className="gap-1.5 shadow">
            {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save & Sync Frontend
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-primary/20 bg-primary/5 shadow-sm">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs uppercase font-bold text-primary">Connected Peering Nodes</CardDescription>
            <CardTitle className="text-2xl font-extrabold text-primary">{hubs.length}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">Direct Tier-1 interconnect pipes</p>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs uppercase font-bold">BDIX / Local IX Speed</CardDescription>
            <CardTitle className="text-2xl font-extrabold text-emerald-600 font-mono">1000 Mbps</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">Uncapped high-bandwidth burst</p>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs uppercase font-bold">Ultra HD 4K Streaming</CardDescription>
            <CardTitle className="text-2xl font-extrabold text-purple-600">Active</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">Optimized OTT bufferless routing</p>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs uppercase font-bold">Global CDN Status</CardDescription>
            <CardTitle className="text-2xl font-extrabold font-mono text-blue-600">99.99%</CardTitle>
          </CardHeader>
          <CardContent>
            <Badge className="bg-blue-500/10 text-blue-600 border-blue-500/30 text-xs">Direct Anycast</Badge>
          </CardContent>
        </Card>
      </div>

      {/* Peering Hubs Table */}
      <Card className="shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Network className="h-4 w-4 text-primary" />
              Public Subscriber Peering Hubs List
            </CardTitle>
            <CardDescription>Each hub configured here is displayed on the "Cloud Peering Hubs" card on the subscriber dashboard</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={handleClearAllHubs} className="gap-1.5 text-xs text-rose-600 hover:bg-rose-50 border-rose-200">
              <Trash2 className="h-3.5 w-3.5" />
              Clear All Hubs
            </Button>
            <Button size="sm" onClick={() => setDialogOpen(true)} className="gap-1.5 text-xs">
              <Plus className="h-3.5 w-3.5" />
              Add Peering Hub
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {hubs.length === 0 ? (
            <div className="py-8 text-center border border-dashed rounded-xl">
              <p className="text-sm font-semibold text-muted-foreground">No Peering Hubs Configured</p>
              <p className="text-xs text-muted-foreground mt-1">Click "Add Peering Hub" or "Reset Defaults" above.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-xs text-muted-foreground text-left">
                    <th className="py-2.5 px-3">Category</th>
                    <th className="py-2.5 px-3">Service / Hub Name</th>
                    <th className="py-2.5 px-3">Endpoint URL</th>
                    <th className="py-2.5 px-3">Badge Label</th>
                    <th className="py-2.5 px-3">Status</th>
                    <th className="py-2.5 px-3 text-right">Delete</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {hubs.map((hub) => (
                    <tr key={hub.id} className="hover:bg-muted/40 transition-colors">
                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-2">
                          {getCategoryIcon(hub.category)}
                          <span className="capitalize text-xs text-muted-foreground">{hub.category}</span>
                        </div>
                      </td>
                      <td className="py-2.5 px-3 font-semibold text-foreground">
                        {hub.name}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-xs text-muted-foreground">
                        <a href={hub.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 hover:text-primary transition-colors">
                          <span className="truncate max-w-xs">{hub.url}</span>
                          <ExternalLink className="h-3 w-3 inline" />
                        </a>
                      </td>
                      <td className="py-2.5 px-3">
                        <Badge variant="secondary" className="text-xs font-semibold">
                          {hub.badge}
                        </Badge>
                      </td>
                      <td className="py-2.5 px-3">
                        <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/30 text-xs">
                          {hub.status || 'Active'}
                        </Badge>
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleDeleteHub(hub.id)}
                          className="h-8 w-8 p-0 text-rose-500 hover:text-rose-600 hover:bg-rose-50"
                          title="Delete peering hub"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add Peering Hub Modal */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Cloud Peering Hub</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAddHub} className="space-y-4 pt-2">
            <div>
              <Label>Hub / Service Name *</Label>
              <Input
                value={hubName}
                onChange={(e) => setHubName(e.target.value)}
                placeholder="e.g. Disney+ Hotstar Cache"
                required
              />
            </div>
            <div>
              <Label>Destination Endpoint URL *</Label>
              <Input
                value={hubUrl}
                onChange={(e) => setHubUrl(e.target.value)}
                placeholder="https://..."
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Badge Label</Label>
                <Input
                  value={hubBadge}
                  onChange={(e) => setHubBadge(e.target.value)}
                  placeholder="e.g. 4K HDR / Gigabit"
                />
              </div>
              <div>
                <Label>Category</Label>
                <select
                  value={hubCategory}
                  onChange={(e) => setHubCategory(e.target.value)}
                  className="w-full h-10 px-3 rounded-md border text-sm bg-background mt-1"
                >
                  <option value="cdn">CDN Storage</option>
                  <option value="speedtest">Speedtest Node</option>
                  <option value="streaming">Streaming & Live TV</option>
                  <option value="peering">Direct Anycast Peering</option>
                </select>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button type="submit">Save Peering Hub</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
