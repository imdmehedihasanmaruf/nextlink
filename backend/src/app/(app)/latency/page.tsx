'use client';
import { useState, useEffect } from 'react';
import { 
  Radio, Save, Plus, Trash2, RefreshCw, Activity, 
  Wifi, Globe, ShieldCheck, CheckCircle2, Server
} from 'lucide-react';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useAdminDataStore } from '@/store/adminDataStore';

export default function LiveLatencyPage() {
  const { liveLatency, saveItem, fetchData } = useAdminDataStore();
  const [loading, setLoading] = useState(false);

  // Configuration State
  const [enabled, setEnabled] = useState(true);
  const [title, setTitle] = useState('Realtime Ping & Latency');
  const [description, setDescription] = useState('Real-time response to Tier-1 international backbones');
  const [targets, setTargets] = useState<any[]>([]);

  // Add Target Modal State
  const [dialogOpen, setDialogOpen] = useState(false);
  const [targetName, setTargetName] = useState('');
  const [targetHost, setTargetHost] = useState('');
  const [targetPing, setTargetPing] = useState('1.5 ms');
  const [targetStatus, setTargetStatus] = useState('optimal');

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (liveLatency) {
      setEnabled(liveLatency.enabled ?? true);
      setTitle(liveLatency.title || 'Realtime Ping & Latency');
      setDescription(liveLatency.description || 'Real-time response to Tier-1 international backbones');
      setTargets(Array.isArray(liveLatency.targets) ? liveLatency.targets : []);
    }
  }, [liveLatency]);

  const handleSave = async (updatedTargets?: any[]) => {
    setLoading(true);
    const activeList = updatedTargets !== undefined ? updatedTargets : targets;
    const payload = {
      enabled,
      title,
      description,
      targets: activeList,
    };

    try {
      await saveItem('liveLatency', payload);
      toast.success('Live Latency & Ping settings saved & synced to Frontend Portal!');
    } catch (error: any) {
      toast.error(error?.message || 'The settings could not be saved.');
    } finally {
      setLoading(false);
    }
  };

  const handleAddTarget = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetName.trim() || !targetHost.trim()) return;

    const newTarget = {
      id: `LAT-${Date.now().toString().slice(-4)}`,
      name: targetName,
      host: targetHost,
      ping: targetPing || '1.8 ms',
      status: targetStatus,
    };

    const updated = [...targets, newTarget];
    setTargets(updated);
    setDialogOpen(false);
    setTargetName('');
    setTargetHost('');
    await handleSave(updated);
  };

  const handleDeleteTarget = async (id: string) => {
    if (confirm('Delete this ping target?')) {
      const updated = targets.filter(t => t.id !== id);
      setTargets(updated);
      await handleSave(updated);
      toast.success('Ping target deleted!');
    }
  };

  const handleClearAllTargets = async () => {
    if (confirm('Delete all latency monitor targets?')) {
      setTargets([]);
      await handleSave([]);
      toast.success('All targets cleared!');
    }
  };

  const handleResetDefaults = async () => {
    if (confirm('Reset to standard Tier-1 backbone targets?')) {
      const defaultTargets = [
        { id: 'LAT-1', name: 'Direct POP Peering', host: 'pop.nextlink.net', ping: '1.2 ms', status: 'optimal' },
        { id: 'LAT-2', name: 'Cloudflare Edge (1.1.1.1)', host: '1.1.1.1', ping: '2.4 ms', status: 'optimal' },
        { id: 'LAT-3', name: 'Google DNS (8.8.8.8)', host: '8.8.8.8', ping: '3.1 ms', status: 'optimal' },
        { id: 'LAT-4', name: 'AWS Cloud Peering', host: 'aws.amazon.com', ping: '4.8 ms', status: 'optimal' },
      ];
      setEnabled(true);
      setTitle('Realtime Ping & Latency');
      setDescription('Real-time response to Tier-1 international backbones');
      setTargets(defaultTargets);
      await handleSave(defaultTargets);
      toast.success('Standard Tier-1 targets restored!');
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2.5">
            <Radio className="h-6 w-6 text-primary" />
            Live Latency & Ping Management
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Configure backbone latency targets, ICMP probe endpoints, and customer telemetry indicators.
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
            <CardDescription className="text-xs uppercase font-bold text-primary">Direct POP Edge Latency</CardDescription>
            <CardTitle className="text-2xl font-extrabold text-primary font-mono">
              {targets[0]?.ping || '< 1.8 ms'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">Local metro optical interconnect</p>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs uppercase font-bold">Monitored Host Nodes</CardDescription>
            <CardTitle className="text-2xl font-extrabold">{targets.length}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">Global CDN & DNS targets</p>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs uppercase font-bold">Packet Loss Ratio</CardDescription>
            <CardTitle className="text-2xl font-extrabold text-emerald-600 font-mono">0.00%</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">Zero dropped ICMP frames</p>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs uppercase font-bold">Cloudflare Anycast</CardDescription>
            <CardTitle className="text-2xl font-extrabold font-mono text-blue-600">
              {targets.find(t => t.name.toLowerCase().includes('cloudflare'))?.ping || '2.4 ms'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Badge className="bg-blue-500/10 text-blue-600 border-blue-500/30 text-xs">Direct IX Peering</Badge>
          </CardContent>
        </Card>
      </div>

      {/* Configuration Card */}
      <Card className="shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Server className="h-4 w-4 text-primary" />
              Frontend Card Header & Telemetry Config
            </CardTitle>
            <CardDescription>Controls texts and active state on the subscriber dashboard</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold">{enabled ? 'Active on Frontend' : 'Disabled'}</span>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>
        </CardHeader>
        <CardContent className="space-y-4 pt-2">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label className="text-xs">Card Header Title</Label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Realtime Ping & Latency"
                className="mt-1 font-semibold"
              />
            </div>
            <div>
              <Label className="text-xs">Card Subtitle Description</Label>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. Real-time response to Tier-1 international backbones"
                className="mt-1"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Target Nodes Table */}
      <Card className="shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Globe className="h-4 w-4 text-primary" />
              Active Target Host Nodes
            </CardTitle>
            <CardDescription>These targets appear on the frontend live latency diagnostic box</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={handleClearAllTargets} className="gap-1.5 text-xs text-rose-600 hover:bg-rose-50 border-rose-200">
              <Trash2 className="h-3.5 w-3.5" />
              Clear All Targets
            </Button>
            <Button size="sm" onClick={() => setDialogOpen(true)} className="gap-1.5 text-xs">
              <Plus className="h-3.5 w-3.5" />
              Add Target Node
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {targets.length === 0 ? (
            <div className="py-8 text-center border border-dashed rounded-xl">
              <p className="text-sm font-semibold text-muted-foreground">No Latency Targets Configured</p>
              <p className="text-xs text-muted-foreground mt-1">Click "Add Target Node" or "Reset Defaults" above.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-xs text-muted-foreground text-left">
                    <th className="py-2.5 px-3">Node Name</th>
                    <th className="py-2.5 px-3">Host / IPv4 / IPv6</th>
                    <th className="py-2.5 px-3">Measured Ping</th>
                    <th className="py-2.5 px-3">Status</th>
                    <th className="py-2.5 px-3 text-right">Delete</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {targets.map((tgt) => (
                    <tr key={tgt.id} className="hover:bg-muted/40 transition-colors">
                      <td className="py-2.5 px-3 font-semibold text-foreground">{tgt.name}</td>
                      <td className="py-2.5 px-3 font-mono text-xs text-muted-foreground">{tgt.host}</td>
                      <td className="py-2.5 px-3 font-mono font-bold text-emerald-600">{tgt.ping}</td>
                      <td className="py-2.5 px-3">
                        <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/30 text-xs">
                          {tgt.status || 'optimal'}
                        </Badge>
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleDeleteTarget(tgt.id)}
                          className="h-8 w-8 p-0 text-rose-500 hover:text-rose-600 hover:bg-rose-50"
                          title="Delete ping target"
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

      {/* Add Target Modal */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Ping Target Node</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAddTarget} className="space-y-4 pt-2">
            <div>
              <Label>Target Display Name *</Label>
              <Input
                value={targetName}
                onChange={(e) => setTargetName(e.target.value)}
                placeholder="e.g. Frankfurt Core Router"
                required
              />
            </div>
            <div>
              <Label>Host / Domain / IP *</Label>
              <Input
                value={targetHost}
                onChange={(e) => setTargetHost(e.target.value)}
                placeholder="e.g. 1.1.1.1 or fra.peering.net"
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Baseline Ping (ms)</Label>
                <Input
                  value={targetPing}
                  onChange={(e) => setTargetPing(e.target.value)}
                  placeholder="e.g. 2.1 ms"
                />
              </div>
              <div>
                <Label>Status</Label>
                <select
                  value={targetStatus}
                  onChange={(e) => setTargetStatus(e.target.value)}
                  className="w-full h-10 px-3 rounded-md border text-sm bg-background mt-1"
                >
                  <option value="optimal">Optimal</option>
                  <option value="normal">Normal</option>
                  <option value="degraded">Degraded</option>
                </select>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button type="submit">Save Target</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
