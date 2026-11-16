'use client';
import { useState, useEffect } from 'react';
import { 
  Zap, Save, Trash2, Clock, Gauge,
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
import { useAdminDataStore } from '@/store/adminDataStore';
import { apiGet, apiPost } from '@/lib/apiClient';

export default function BoostBandwidthPage() {
  const { boostBandwidth, saveItem, fetchData } = useAdminDataStore();
  const [loading, setLoading] = useState(false);

  // Configuration State — the CMS only stores display copy.
  const [enabled, setEnabled] = useState(false);
  const [boostSpeed, setBoostSpeed] = useState(1000);
  const [durationHours, setDurationHours] = useState(6);
  const [title, setTitle] = useState('Turbo Boost on Request');
  const [description, setDescription] = useState('Time-boxed speed burst routed through support like any other change.');
  const [status, setStatus] = useState('');
  const [burstQuotaPerMonth, setBurstQuotaPerMonth] = useState(0);

  // Real request queue from the server.
  const [liveRequests, setLiveRequests] = useState<any[]>([]);
  const [loadingRequests, setLoadingRequests] = useState(false);

  useEffect(() => {
    fetchData();
    loadLiveRequests();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchData]);

  useEffect(() => {
    if (boostBandwidth) {
      setEnabled(boostBandwidth.enabled ?? false);
      setBoostSpeed(boostBandwidth.boostSpeed ?? 1000);
      setDurationHours(boostBandwidth.durationHours ?? 6);
      setTitle(boostBandwidth.title || 'Turbo Boost on Request');
      setDescription(boostBandwidth.description || 'Time-boxed speed burst routed through support like any other change.');
      setStatus(boostBandwidth.status || '');
      setBurstQuotaPerMonth(boostBandwidth.burstQuotaPerMonth ?? 0);
    }
  }, [boostBandwidth]);

  const handleSave = async () => {
    setLoading(true);
    const payload = {
      enabled,
      boostSpeed: Number(boostSpeed),
      durationHours: Number(durationHours),
      title,
      description,
      status,
      burstQuotaPerMonth: Number(burstQuotaPerMonth),
    };

    try {
      await saveItem('boostBandwidth', payload);
      toast.success('Boost Bandwidth parameters saved & synced to Frontend Portal!');
    } catch (error: any) {
      toast.error(error?.message || 'The settings could not be saved.');
    } finally {
      setLoading(false);
    }
  };

  const loadLiveRequests = async () => {
    setLoadingRequests(true);
    try {
      const result = await apiGet('/api/admin/turbo-boost');
      if (result.success) {
        setLiveRequests(Array.isArray(result.requests) ? result.requests : []);
      }
    } catch (error: any) {
      toast.error(error?.message || 'Could not load the boost requests');
    } finally {
      setLoadingRequests(false);
    }
  };

  const handleBoostAction = async (id: string, action: 'approve' | 'reject' | 'complete' | 'deactivate') => {
    const note = action === 'reject' ? (prompt('Optional rejection note:') ?? '') : undefined;
    try {
      const result = await apiPost(`/api/admin/turbo-boost/${encodeURIComponent(id)}/${action}`, note !== undefined ? { note } : {});
      if (result.success) {
        toast.success(`Request ${result.request?.reference || id} updated (${action})`);
        await loadLiveRequests();
      } else {
        toast.error(result.error || 'The action failed');
      }
    } catch (error: any) {
      toast.error(error?.message || 'The action failed');
    }
  };

  const formatRemaining = (seconds?: number) => {
    const s = Math.max(0, Number(seconds || 0));
    if (s <= 0) return 'Expired / 0m';
    const hrs = Math.floor(s / 3600);
    const mins = Math.floor((s % 3600) / 60);
    const secs = s % 60;
    return `${hrs}h ${mins}m ${secs}s`;
  };

  const handleResetDefaults = () => {
    if (confirm('Reset Boost Bandwidth to the neutral defaults (disabled)?')) {
      setEnabled(false);
      setBoostSpeed(1000);
      setDurationHours(6);
      setTitle('Turbo Boost on Request');
      setDescription('Time-boxed speed burst routed through support like any other change.');
      setStatus('');
      setBurstQuotaPerMonth(0);
      toast.success('Defaults reset. Click Save Changes to apply.');
    }
  };

  const inFlightCount = liveRequests.filter(r => r.status === 'requested' || r.status === 'in_progress').length;
  const totalCount = liveRequests.length;

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
            Configure the Turbo Boost card shown on the subscriber dashboard. This CMS content bears no rate-limit commands on the router — burst activation is a support action, not an automatic MikroTik override.
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
            <CardDescription className="text-xs uppercase font-bold">In-Flight Requests</CardDescription>
            <CardTitle className="text-2xl font-extrabold text-primary">{inFlightCount}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">Awaiting helpdesk activation</p>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs uppercase font-bold">Total Requests Logged</CardDescription>
            <CardTitle className="text-2xl font-extrabold">{totalCount}</CardTitle>
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
            <CardDescription>Controls the Turbo Boost card on the subscriber dashboard</CardDescription>
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
                placeholder="e.g. Turbo Boost on Request"
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
              Live Boost Requests
            </CardTitle>
            <CardDescription>Real requests submitted by subscribers from the portal — approve to activate the change on the router, then mark it completed</CardDescription>
          </div>
          <Button size="sm" variant="outline" onClick={loadLiveRequests} className="gap-1.5 text-xs">
            <RefreshCw className={`h-3.5 w-3.5 ${loadingRequests ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </CardHeader>
        <CardContent>
          {liveRequests.length === 0 ? (
            <div className="py-8 text-center border border-dashed rounded-xl">
              <p className="text-sm font-semibold text-muted-foreground">No Boost Requests</p>
              <p className="text-xs text-muted-foreground mt-1">Customer boost requests from the portal will appear here.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-xs text-muted-foreground text-left">
                    <th className="py-2.5 px-3">Reference</th>
                    <th className="py-2.5 px-3">Subscriber</th>
                    <th className="py-2.5 px-3">Requested</th>
                    <th className="py-2.5 px-3">Duration</th>
                    <th className="py-2.5 px-3">Remaining Time</th>
                    <th className="py-2.5 px-3">Ticket</th>
                    <th className="py-2.5 px-3">Status</th>
                    <th className="py-2.5 px-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {liveRequests.map((r) => (
                    <tr key={r.id} className="hover:bg-muted/40 transition-colors">
                      <td className="py-2.5 px-3 font-mono text-xs font-semibold">{r.reference}</td>
                      <td className="py-2.5 px-3 font-medium text-foreground">{r.subscriber_id}</td>
                      <td className="py-2.5 px-3 font-bold text-amber-600">{r.requested_mbps} Mbps</td>
                      <td className="py-2.5 px-3 text-xs text-muted-foreground">{r.duration_hours} Hours</td>
                      <td className="py-2.5 px-3 font-mono text-xs">
                        {r.status === 'active' || r.status === 'in_progress'
                          ? formatRemaining(r.remaining_seconds)
                          : r.status === 'expired'
                            ? 'Expired'
                            : '—'}
                      </td>
                      <td className="py-2.5 px-3 text-xs text-muted-foreground">{r.ticket_id || '—'}</td>
                      <td className="py-2.5 px-3">
                        <Badge
                          className={
                            r.status === 'active'
                              ? 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30'
                              : r.status === 'requested'
                                ? 'bg-amber-500/10 text-amber-600 border-amber-500/30'
                                : r.status === 'in_progress'
                                  ? 'bg-blue-500/10 text-blue-600 border-blue-500/30'
                                  : r.status === 'expired'
                                    ? 'bg-rose-500/10 text-rose-600 border-rose-500/30'
                                    : 'bg-muted text-muted-foreground'
                          }
                        >
                          {r.status}
                        </Badge>
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {['requested', 'in_progress', 'active'].includes(r.status) && (
                            <>
                              {r.status === 'requested' && (
                                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => handleBoostAction(r.id, 'approve')}>
                                  Activate
                                </Button>
                              )}
                              {['active', 'in_progress'].includes(r.status) && (
                                <Button size="sm" variant="outline" className="h-7 text-xs text-amber-600 border-amber-200 hover:bg-amber-50" onClick={() => handleBoostAction(r.id, 'deactivate')}>
                                  Deactivate
                                </Button>
                              )}
                              <Button size="sm" variant="outline" className="h-7 text-xs text-emerald-600 border-emerald-200 hover:bg-emerald-50" onClick={() => handleBoostAction(r.id, 'complete')}>
                                Complete
                              </Button>
                              <Button size="sm" variant="outline" className="h-7 text-xs text-rose-600 border-rose-200 hover:bg-rose-50" onClick={() => handleBoostAction(r.id, 'reject')}>
                                Reject
                              </Button>
                            </>
                          )}
                        </div>
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
    </div>
  );
}
