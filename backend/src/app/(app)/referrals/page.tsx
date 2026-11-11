'use client';
import { useState, useEffect, useCallback } from 'react';
import {
  Gift, Save, CheckCircle2, Users, RefreshCw, AlertTriangle, DollarSign,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { apiGet, apiPost, apiPut } from '@/lib/apiClient';

interface Referral {
  id: string;
  code: string;
  status: string;
  referrer_id: string;
  referred_subscriber_id: string | null;
  application_id: string | null;
  reward_amount: string | number;
  created_at: string;
  credited_at: string | null;
}

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-amber-500/10 text-amber-600 border-amber-500/30',
  qualified: 'bg-blue-500/10 text-blue-600 border-blue-500/30',
  credited: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30',
  void: 'bg-muted text-muted-foreground',
  rejected: 'bg-rose-500/10 text-rose-600 border-rose-500/30',
};

export default function ReferralRewardsPage() {
  const [loading, setLoading] = useState(false);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [referrals, setReferrals] = useState<Referral[]>([]);
  const [loadingList, setLoadingList] = useState(true);

  // Configuration state
  const [enabled, setEnabled] = useState(false);
  const [bonusAmount, setBonusAmount] = useState(25);
  const [title, setTitle] = useState('Refer a friend');
  const [description, setDescription] = useState(
    'Share your invite link — the reward is applied to your next invoice once your friend activates and pays.',
  );

  const loadSettings = useCallback(async () => {
    setSettingsLoading(true);
    try {
      const result = await apiGet('/api/admin/referral-settings');
      if (result.success && result.settings) {
        setEnabled(!!result.settings.enabled);
        setBonusAmount(Number(result.settings.bonusAmount ?? 25));
        setTitle(result.settings.title || 'Refer a friend');
        setDescription(result.settings.description || '');
      }
    } catch {
      toast.error('Could not load the referral configuration');
    } finally {
      setSettingsLoading(false);
    }
  }, []);

  const loadReferrals = useCallback(async () => {
    setLoadingList(true);
    try {
      const result = await apiGet('/api/admin/referrals');
      if (result.success) {
        setReferrals(Array.isArray(result.referrals) ? result.referrals : []);
      } else {
        toast.error(result.error || 'Could not load referrals');
      }
    } catch {
      toast.error('Could not load referrals');
    } finally {
      setLoadingList(false);
    }
  }, []);

  useEffect(() => {
    loadSettings();
    loadReferrals();
  }, [loadSettings, loadReferrals]);

  const handleSave = async () => {
    setLoading(true);
    try {
      const result = await apiPut('/api/admin/referral-settings', {
        enabled,
        bonusAmount: Number(bonusAmount),
        title,
        description,
      });
      if (result.success) {
        toast.success('Referral configuration saved.');
      } else {
        toast.error(result.error || 'The settings could not be saved');
      }
    } catch {
      toast.error('The settings could not be saved');
    } finally {
      setLoading(false);
    }
  };

  const handleVoid = async (id: string) => {
    const reason = prompt('Reason for voiding this referral (required):')?.trim();
    if (!reason) return;
    const result = await apiPost(`/api/admin/referrals/${encodeURIComponent(id)}/void`, { reason });
    if (result.success) {
      toast.success('Referral voided.');
      await loadReferrals();
    } else {
      toast.error(result.error || 'Could not void the referral');
    }
  };

  const totalCredited = referrals
    .filter((r) => r.status === 'credited')
    .reduce((acc, r) => acc + Number(r.reward_amount || 0), 0);
  const qualifiedCount = referrals.filter((r) => r.status === 'qualified' || r.status === 'credited').length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2.5">
            <Gift className="h-6 w-6 text-emerald-600" />
            Referral Rewards
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Configure the referral program and watch real referrals arrive — each reward is credited against the referrer&apos;s next invoice after their friend activates and pays.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={loadReferrals} className="gap-1.5 text-xs">
            <RefreshCw className={`h-3.5 w-3.5 ${loadingList ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button onClick={handleSave} disabled={loading} className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white shadow">
            {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save Configuration
          </Button>
        </div>
      </div>

      {/* KPI Stats — all live from the database */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-emerald-500/20 bg-emerald-500/5 shadow-sm">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs uppercase font-bold text-emerald-700 dark:text-emerald-400">Credit Per Referral</CardDescription>
            <CardTitle className="text-2xl font-extrabold text-emerald-600">${bonusAmount}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">Applied to the next monthly invoice</p>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs uppercase font-bold">Referrals Tracked</CardDescription>
            <CardTitle className="text-2xl font-extrabold">{referrals.length}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">Records in the referral ledger</p>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs uppercase font-bold">Qualified (Activated &amp; Paid)</CardDescription>
            <CardTitle className="text-2xl font-extrabold text-primary">{qualifiedCount}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">Friends already contributing</p>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs uppercase font-bold">Total Credited</CardDescription>
            <CardTitle className="text-2xl font-extrabold text-emerald-600">${totalCredited.toFixed(2)}</CardTitle>
          </CardHeader>
          <CardContent>
            <Badge variant={enabled ? 'outline' : 'secondary'} className="text-xs font-semibold">
              {enabled ? 'Program Active' : 'Program Disabled'}
            </Badge>
          </CardContent>
        </Card>
      </div>

      {/* Configuration */}
      <Card className="shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            Program Configuration
          </CardTitle>
          <CardDescription>Controls the referral card on the subscriber dashboard and the reward amount</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 pt-1">
          <div className="flex items-center justify-between border rounded-lg px-4 py-3">
            <div>
              <p className="text-sm font-semibold">Referral program enabled</p>
              <p className="text-xs text-muted-foreground">When disabled, the portal card is hidden and the API refuses the referral code</p>
            </div>
            <Switch checked={enabled} onCheckedChange={setEnabled} disabled={settingsLoading} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label className="text-xs">Credit Per Referral (USD)</Label>
              <Input
                type="number"
                min={1}
                value={bonusAmount}
                onChange={(e) => setBonusAmount(Number(e.target.value) || 0)}
                className="mt-1 font-bold"
              />
            </div>
            <div>
              <Label className="text-xs">Card Title (Portal)</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1" />
            </div>
          </div>
          <div>
            <Label className="text-xs">Card Description (Portal)</Label>
            <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} className="mt-1" />
          </div>
        </CardContent>
      </Card>

      {/* Live referral ledger */}
      <Card className="shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" />
            Live Referral Ledger
          </CardTitle>
          <CardDescription>Every row is a real, database-backed referral record — rewards only credit after a friend activates and pays</CardDescription>
        </CardHeader>
        <CardContent>
          {loadingList ? (
            <p className="text-sm text-muted-foreground text-center py-6">Loading referrals…</p>
          ) : referrals.length === 0 ? (
            <div className="py-8 text-center border border-dashed rounded-xl">
              <AlertTriangle className="h-6 w-6 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm font-semibold text-muted-foreground">No referrals recorded yet</p>
              <p className="text-xs text-muted-foreground mt-1">They will appear here when subscribers share their invite link.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-xs text-muted-foreground text-left">
                    <th className="py-2.5 px-3">ID</th>
                    <th className="py-2.5 px-3">Code</th>
                    <th className="py-2.5 px-3">Referrer</th>
                    <th className="py-2.5 px-3">Referred Subscriber</th>
                    <th className="py-2.5 px-3">Status</th>
                    <th className="py-2.5 px-3">Reward</th>
                    <th className="py-2.5 px-3">Created</th>
                    <th className="py-2.5 px-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {referrals.map((r) => (
                    <tr key={r.id} className="hover:bg-muted/40">
                      <td className="py-2.5 px-3 font-mono text-xs">{r.id}</td>
                      <td className="py-2.5 px-3 font-mono text-xs font-semibold">{r.code}</td>
                      <td className="py-2.5 px-3 text-xs">{r.referrer_id}</td>
                      <td className="py-2.5 px-3 text-xs">{r.referred_subscriber_id || '—'}</td>
                      <td className="py-2.5 px-3">
                        <Badge variant="outline" className={`text-[11px] ${STATUS_STYLES[r.status] || ''}`}>{r.status}</Badge>
                      </td>
                      <td className="py-2.5 px-3 font-bold text-emerald-600">${Number(r.reward_amount).toFixed(2)}</td>
                      <td className="py-2.5 px-3 text-xs text-muted-foreground">{new Date(r.created_at).toLocaleDateString()}</td>
                      <td className="py-2.5 px-3 text-right">
                        {r.status === 'pending' && (
                          <Button size="sm" variant="ghost" className="h-7 text-xs text-rose-600 hover:bg-rose-50" onClick={() => handleVoid(r.id)}>
                            Void
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
