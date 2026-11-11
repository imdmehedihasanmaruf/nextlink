'use client';
import { useState, useEffect } from 'react';
import { 
  Gift, Save, Plus, Trash2, CheckCircle2, DollarSign, 
  Users, Share2, Percent, Tag, RefreshCw, AlertCircle
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

export default function ReferralRewardsPage() {
  const { referralRewards, saveItem, fetchData } = useAdminDataStore();
  const [loading, setLoading] = useState(false);

  // Local config state — the initial values are honest empties; the stored
  // CMS configuration (synced on load) overwrites them.
  const [enabled, setEnabled] = useState(false);
  const [bonusAmount, setBonusAmount] = useState(25);
  const [discountPercent, setDiscountPercent] = useState(10);
  const [defaultCode, setDefaultCode] = useState('');
  const [title, setTitle] = useState('Refer a friend');
  const [description, setDescription] = useState('Share your invite link with a friend — you both receive billing credit when they activate.');
  const [tierName, setTierName] = useState('');
  const [referrals, setReferrals] = useState<any[]>([]);

  // Add modal state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newReward, setNewReward] = useState('25');

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (referralRewards) {
      setEnabled(referralRewards.enabled ?? false);
      setBonusAmount(referralRewards.bonusAmount ?? 25);
      setDiscountPercent(referralRewards.discountPercent ?? 10);
      setDefaultCode(referralRewards.defaultCode || '');
      setTitle(referralRewards.title || 'Refer a friend');
      setDescription(referralRewards.description || 'Share your invite link with a friend — you both receive billing credit when they activate.');
      setTierName(referralRewards.tierName || '');
      setReferrals(Array.isArray(referralRewards.referrals) ? referralRewards.referrals : []);
    }
  }, [referralRewards]);

  const handleSave = async (updatedReferrals?: any[]) => {
    setLoading(true);
    const activeList = updatedReferrals !== undefined ? updatedReferrals : referrals;
    const payload = {
      enabled,
      bonusAmount: Number(bonusAmount),
      discountPercent: Number(discountPercent),
      defaultCode,
      title,
      description,
      tierName,
      friendsJoinedCount: activeList.length,
      totalSavedAmount: activeList.reduce((acc, cur) => acc + (Number(cur.reward) || Number(bonusAmount)), 0),
      referrals: activeList,
    };

    await saveItem('referralRewards', payload);
    setLoading(false);
    toast.success('Referral Rewards configuration saved & synced to Frontend Portal!');
  };

  const handleAddReferral = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;

    const newEntry = {
      id: `REF-${Date.now().toString().slice(-4)}`,
      name: newName,
      email: newEmail || `${newName.toLowerCase().replace(/\s+/g, '.')}@example.com`,
      date: new Date().toISOString().slice(0, 10),
      reward: Number(newReward) || bonusAmount,
      status: 'Rewarded',
    };

    const updated = [newEntry, ...referrals];
    setReferrals(updated);
    setDialogOpen(false);
    setNewName('');
    setNewEmail('');
    await handleSave(updated);
  };

  const handleDeleteReferral = async (id: string) => {
    if (confirm('Are you sure you want to delete this referral record?')) {
      const updated = referrals.filter(r => r.id !== id);
      setReferrals(updated);
      await handleSave(updated);
      toast.success('Referral entry deleted!');
    }
  };

  const handleClearAllReferrals = async () => {
    if (confirm('Clear all referral reward history records?')) {
      setReferrals([]);
      await handleSave([]);
      toast.success('All referral records cleared!');
    }
  };

  const handleResetSettings = async () => {
    if (confirm('Reset Referral Rewards to the neutral defaults?')) {
      setEnabled(false);
      setBonusAmount(25);
      setDiscountPercent(10);
      setDefaultCode('');
      setTitle('Refer a friend');
      setDescription('Share your invite link with a friend — you both receive billing credit when they activate.');
      setTierName('');
      toast.success('Settings reset. Remember to click Save Changes.');
    }
  };

  const totalRewardsGiven = referrals.reduce((sum, r) => sum + (Number(r.reward) || bonusAmount), 0);

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2.5">
            <Gift className="h-6 w-6 text-emerald-600" />
            Referral Rewards Management
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Configure the referral card shown on the subscriber dashboard. This is CMS content only — no referrals are tracked and no credits are applied automatically while the tracking backend does not exist yet.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleResetSettings} className="gap-1.5 text-xs text-rose-600 border-rose-200 hover:bg-rose-50">
            <Trash2 className="h-3.5 w-3.5" />
            Reset Defaults
          </Button>
          <Button onClick={() => handleSave()} disabled={loading} className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white shadow">
            {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save & Sync Frontend
          </Button>
        </div>
      </div>

      {/* KPI Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-emerald-500/20 bg-emerald-500/5 shadow-sm">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs uppercase font-bold text-emerald-700 dark:text-emerald-400">Bonus Credit Per Referral</CardDescription>
            <CardTitle className="text-2xl font-extrabold text-emerald-600">${bonusAmount}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">Credited directly to subscriber invoice</p>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs uppercase font-bold">Total Referred Friends</CardDescription>
            <CardTitle className="text-2xl font-extrabold">{referrals.length}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">Active successful signups</p>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs uppercase font-bold">Total Rewards Given</CardDescription>
            <CardTitle className="text-2xl font-extrabold text-primary">${totalRewardsGiven}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">Customer loyalty billing credits</p>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs uppercase font-bold">Global Promo Code</CardDescription>
            <CardTitle className="text-lg font-mono font-bold text-foreground">{defaultCode}</CardTitle>
          </CardHeader>
          <CardContent>
            <Badge variant="outline" className="text-xs font-semibold">{tierName}</Badge>
          </CardContent>
        </Card>
      </div>

      {/* Configuration Form Card */}
      <Card className="shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Share2 className="h-4 w-4 text-emerald-600" />
              Frontend Card Display & Program Rules
            </CardTitle>
            <CardDescription>Changes here update the "Refer & Earn" card on the subscriber dashboard in real time</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold">{enabled ? 'Active on Frontend' : 'Disabled'}</span>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>
        </CardHeader>
        <CardContent className="space-y-4 pt-2">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <Label className="text-xs">Reward Amount ($ USD)</Label>
              <Input
                type="number"
                value={bonusAmount}
                onChange={(e) => setBonusAmount(Number(e.target.value))}
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-xs">Invitee Discount (% Percent)</Label>
              <Input
                type="number"
                value={discountPercent}
                onChange={(e) => setDiscountPercent(Number(e.target.value))}
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-xs">Default Referral Code</Label>
              <Input
                value={defaultCode}
                onChange={(e) => setDefaultCode(e.target.value.toUpperCase())}
                className="font-mono mt-1"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label className="text-xs">Card Header Title</Label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Earn $25 on Your Next Invoice"
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-xs">Subscriber Loyalty Tier Name</Label>
              <Input
                value={tierName}
                onChange={(e) => setTierName(e.target.value)}
                placeholder="e.g. Silver Tier (optional)"
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
              placeholder="Instructions shown to subscriber on frontend card"
              className="mt-1"
            />
          </div>
        </CardContent>
      </Card>

      {/* Referrals Ledger Table */}
      <Card className="shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-4 w-4 text-primary" />
              Referrals Record Ledger
            </CardTitle>
            <CardDescription>Track all subscriber referrals and credits issued</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={handleClearAllReferrals} className="gap-1.5 text-xs text-rose-600 hover:bg-rose-50 border-rose-200">
              <Trash2 className="h-3.5 w-3.5" />
              Clear Ledger
            </Button>
            <Button size="sm" onClick={() => setDialogOpen(true)} className="gap-1.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white">
              <Plus className="h-3.5 w-3.5" />
              Add Referral
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {referrals.length === 0 ? (
            <div className="py-8 text-center border border-dashed rounded-xl">
              <p className="text-sm font-semibold text-muted-foreground">No Referrals Recorded</p>
              <p className="text-xs text-muted-foreground mt-1">Click "Add Referral" above to log a new subscriber referral reward.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-xs text-muted-foreground text-left">
                    <th className="py-2.5 px-3">ID</th>
                    <th className="py-2.5 px-3">Referred Friend</th>
                    <th className="py-2.5 px-3">Date</th>
                    <th className="py-2.5 px-3">Reward Amount</th>
                    <th className="py-2.5 px-3">Status</th>
                    <th className="py-2.5 px-3 text-right">Delete</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {referrals.map((ref) => (
                    <tr key={ref.id} className="hover:bg-muted/40 transition-colors">
                      <td className="py-2.5 px-3 font-mono text-xs font-semibold">{ref.id}</td>
                      <td className="py-2.5 px-3">
                        <div className="font-semibold text-foreground">{ref.name}</div>
                        <div className="text-xs text-muted-foreground">{ref.email}</div>
                      </td>
                      <td className="py-2.5 px-3 text-xs text-muted-foreground">{ref.date}</td>
                      <td className="py-2.5 px-3 font-bold text-emerald-600">${ref.reward}</td>
                      <td className="py-2.5 px-3">
                        <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/30 text-xs">
                          {ref.status || 'Rewarded'}
                        </Badge>
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleDeleteReferral(ref.id)}
                          className="h-8 w-8 p-0 text-rose-500 hover:text-rose-600 hover:bg-rose-50"
                          title="Delete referral entry"
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

      {/* Add Referral Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Manual Referral Entry</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAddReferral} className="space-y-4 pt-2">
            <div>
              <Label>Referred Customer Full Name *</Label>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Sophia Anderson"
                required
              />
            </div>
            <div>
              <Label>Email Address</Label>
              <Input
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="sophia@example.com"
              />
            </div>
            <div>
              <Label>Reward Amount ($ USD)</Label>
              <Input
                type="number"
                value={newReward}
                onChange={(e) => setNewReward(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button type="submit" className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold">Add & Save</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
