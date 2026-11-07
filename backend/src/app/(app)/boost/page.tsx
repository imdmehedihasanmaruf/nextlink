'use client';
import { useState, useEffect } from 'react';
import { 
  Zap, Save, Plus, Trash2, Clock, Gauge, 
  Activity, Users, ShieldAlert, RefreshCw, CheckCircle2
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

export default function BoostBandwidthPage() {
  const { boostBandwidth, saveItem, fetchData } = useAdminDataStore();
  const [loading, setLoading] = useState(false);

  // Configuration State
  const [enabled, setEnabled] = useState(true);
  const [boostSpeed, setBoostSpeed] = useState(1000);
  const [durationHours, setDurationHours] = useState(6);
  const [title, setTitle] = useState('1-Click 1 Gbps Turbo Boost');
  const [description, setDescription] = useState('Instantly scale bandwidth for massive cloud syncs, torrents, or gaming');
  const [status, setStatus] = useState('Ready');
  const [burstQuotaPerMonth, setBurstQuotaPerMonth] = useState(3);
  const [history, setHistory] = useState<any[]>([]);

  // Modal State for Manual Boost
  const [dialogOpen, setDialogOpen] = useState(false);
  const [subscriberInput, setSubscriberInput] = useState('');
  const [customSpeed, setCustomSpeed] = useState('1000');
  const [customHours, setCustomHours] = useState('6');

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (boostBandwidth) {
      setEnabled(boostBandwidth.enabled ?? true);
      setBoostSpeed(boostBandwidth.boostSpeed ?? 1000);
      setDurationHours(boostBandwidth.durationHours ?? 6);
      setTitle(boostBandwidth.title || '1-Click 1 Gbps Turbo Boost');
      setDescription(boostBandwidth.description || 'Instantly scale bandwidth for massive cloud syncs, torrents, or gaming');
      setStatus(boostBandwidth.status || 'Ready');
      setBurstQuotaPerMonth(boostBandwidth.burstQuotaPerMonth ?? 3);
      setHistory(Array.isArray(boostBandwidth.history) ? boostBandwidth.history : []);
    }
  }, [boostBandwidth]);

  const handleSave = async (updatedHistory?: any[]) => {
    setLoading(true);
    const activeList = updatedHistory !== undefined ? updatedHistory : history;
    const payload = {
      enabled,
      boostSpeed: Number(boostSpeed),
      durationHours: Number(durationHours),
      title,
      description,
      status,
      burstQuotaPerMonth: Number(burstQuotaPerMonth),
      history: activeList,
    };

    await saveItem('boostBandwidth', payload);
    setLoading(false);
    toast.success('Boost Bandwidth parameters saved & synced to Frontend Portal!');
  };

  const handleAddBoost = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subscriberInput.trim()) return;

    const newBoost = {
      id: `BST-${Date.now().toString().slice(-4)}`,
      subscriber: subscriberInput,
      speed: Number(customSpeed) || boostSpeed,
      duration: Number(customHours) || durationHours,
      date: new Date().toISOString().slice(0, 10),
      status: 'Active',
    };

    const updated = [newBoost, ...history];
    setHistory(updated);
    setDialogOpen(false);
    setSubscriberInput('');
    await handleSave(updated);
    toast.success(`Turbo boost granted to ${subscriberInput}!`);
  };

  const handleDeleteHistory = async (id: string) => {
    if (confirm('Delete this boost history record?')) {
      const updated = history.filter(h => h.id !== id);
      setHistory(updated);
      await handleSave(updated);
      toast.success('Boost record deleted!');
    }
  };

  const handleClearAllHistory = async () => {
    if (confirm('Clear all turbo boost activation logs?')) {
      setHistory([]);
      await handleSave([]);
      toast.success('All boost records cleared!');
    }
  };

  const handleResetDefaults = () => {
    if (confirm('Reset Boost Bandwidth configuration to default 1 Gbps / 6 Hours?')) {
      setEnabled(true);
      setBoostSpeed(1000);
      setDurationHours(6);
      setTitle('1-Click 1 Gbps Turbo Boost');
      setDescription('Instantly scale bandwidth for massive cloud syncs, torrents, or gaming');
      setStatus('Ready');
      setBurstQuotaPerMonth(3);
      toast.success('Defaults reset. Click Save Changes to apply.');
    }
  };

  const activeCount = history.filter(h => h.status === 'Active').length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2.5">
            <Zap className="h-6 w-6 text-amber-500" />
            Boost Bandwidth Management
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Configure on-demand burst speeds, complimentary quotas, and MikroTik turbo rate-limit overrides.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleResetDefaults} className="gap-1.5 text-xs text-rose-600 border-rose-200 hover:bg-rose-50">
            <Trash2 className="h-3.5 w-3.5" />
            Reset Defaults
          </Button>
          <Button onClick={() => handleSave()} disabled={loading} className="gap-1.5 bg-amber-600 hover:bg-amber-700 text-white shadow">
            {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save & Sync Frontend
          </Button>
        </div>
      </div>

      {/* KPI Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-amber-500/20 bg-amber-500/5 shadow-sm">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs uppercase font-bold text-amber-700 dark:text-amber-400">Burst Target Bandwidth</CardDescription>
            <CardTitle className="text-2xl font-extrabold text-amber-600">{boostSpeed} Mbps</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">Symmetrical optical GPON burst pipe</p>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs uppercase font-bold">Complimentary Window</CardDescription>
            <CardTitle className="text-2xl font-extrabold">{durationHours} Hours</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">Per single subscriber trigger</p>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs uppercase font-bold">Active Subscribed Boosts</CardDescription>
            <CardTitle className="text-2xl font-extrabold text-primary">{activeCount}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">Currently utilizing burst pipe</p>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs uppercase font-bold">Total Boost Activations</CardDescription>
            <CardTitle className="text-2xl font-extrabold">{history.length}</CardTitle>
          </CardHeader>
          <CardContent>
            <Badge variant="outline" className="text-xs font-semibold">{burstQuotaPerMonth}x Monthly Quota</Badge>
          </CardContent>
        </Card>
      </div>

      {/* Configuration Card */}
      <Card className="shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Gauge className="h-4 w-4 text-amber-600" />
              Frontend Turbo Card Controls & Throttle Rules
            </CardTitle>
            <CardDescription>Controls the "1-Click Turbo Boost" card on client dashboard</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold">{enabled ? 'Active on Frontend' : 'Disabled'}</span>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>
        </CardHeader>
        <CardContent className="space-y-4 pt-2">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <Label className="text-xs">Turbo Speed (Mbps)</Label>
              <Input
                type="number"
                value={boostSpeed}
                onChange={(e) => setBoostSpeed(Number(e.target.value))}
                className="mt-1 font-bold"
              />
            </div>
            <div>
              <Label className="text-xs">Burst Duration (Hours)</Label>
              <Input
                type="number"
                value={durationHours}
                onChange={(e) => setDurationHours(Number(e.target.value))}
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-xs">Monthly Burst Quota (Times)</Label>
              <Input
                type="number"
                value={burstQuotaPerMonth}
                onChange={(e) => setBurstQuotaPerMonth(Number(e.target.value))}
                className="mt-1"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label className="text-xs">Card Header Title</Label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. 1-Click 1 Gbps Turbo Boost"
                className="mt-1 font-semibold"
              />
            </div>
            <div>
              <Label className="text-xs">Status Pill Label</Label>
              <Input
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                placeholder="e.g. Ready / Available"
                className="mt-1"
              />
            </div>
          </div>

          <div>
            <Label className="text-xs">Card Description Subtitle</Label>
            <Textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Description shown to subscriber on frontend"
              className="mt-1"
            />
          </div>
        </CardContent>
      </Card>

      {/* Boost Activations Ledger Table */}
      <Card className="shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" />
              Turbo Activations & Provisioning History
            </CardTitle>
            <CardDescription>Real-time log of customer burst triggers</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={handleClearAllHistory} className="gap-1.5 text-xs text-rose-600 hover:bg-rose-50 border-rose-200">
              <Trash2 className="h-3.5 w-3.5" />
              Clear Log
            </Button>
            <Button size="sm" onClick={() => setDialogOpen(true)} className="gap-1.5 text-xs bg-amber-600 hover:bg-amber-700 text-white">
              <Plus className="h-3.5 w-3.5" />
              Manual Boost Override
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <div className="py-8 text-center border border-dashed rounded-xl">
              <p className="text-sm font-semibold text-muted-foreground">No Boost Sessions Recorded</p>
              <p className="text-xs text-muted-foreground mt-1">Subscriber 1-click turbo activations will be recorded here.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-xs text-muted-foreground text-left">
                    <th className="py-2.5 px-3">Session ID</th>
                    <th className="py-2.5 px-3">Subscriber Identifier</th>
                    <th className="py-2.5 px-3">Boosted Speed</th>
                    <th className="py-2.5 px-3">Duration</th>
                    <th className="py-2.5 px-3">Date</th>
                    <th className="py-2.5 px-3">Status</th>
                    <th className="py-2.5 px-3 text-right">Delete</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {history.map((h) => (
                    <tr key={h.id} className="hover:bg-muted/40 transition-colors">
                      <td className="py-2.5 px-3 font-mono text-xs font-semibold">{h.id}</td>
                      <td className="py-2.5 px-3 font-medium text-foreground">{h.subscriber}</td>
                      <td className="py-2.5 px-3 font-bold text-amber-600">{h.speed} Mbps</td>
                      <td className="py-2.5 px-3 text-xs text-muted-foreground">{h.duration} Hours</td>
                      <td className="py-2.5 px-3 text-xs text-muted-foreground">{h.date}</td>
                      <td className="py-2.5 px-3">
                        <Badge className={h.status === 'Active' ? 'bg-amber-500/10 text-amber-600 border-amber-500/30' : 'bg-muted text-muted-foreground'}>
                          {h.status}
                        </Badge>
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleDeleteHistory(h.id)}
                          className="h-8 w-8 p-0 text-rose-500 hover:text-rose-600 hover:bg-rose-50"
                          title="Delete boost log"
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

      {/* Manual Boost Override Modal */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Provision Manual Bandwidth Boost</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAddBoost} className="space-y-4 pt-2">
            <div>
              <Label>Subscriber Account / Username / ID *</Label>
              <Input
                value={subscriberInput}
                onChange={(e) => setSubscriberInput(e.target.value)}
                placeholder="e.g. NL-SUB-0104 or user@fiber"
                required
              />
            </div>
            <div>
              <Label>Override Speed (Mbps)</Label>
              <Input
                type="number"
                value={customSpeed}
                onChange={(e) => setCustomSpeed(e.target.value)}
              />
            </div>
            <div>
              <Label>Burst Duration (Hours)</Label>
              <Input
                type="number"
                value={customHours}
                onChange={(e) => setCustomHours(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button type="submit" className="bg-amber-600 hover:bg-amber-700 text-white font-bold">Trigger Boost</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
