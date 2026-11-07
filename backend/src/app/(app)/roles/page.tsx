'use client';

import { useState, useEffect } from 'react';
import { 
  Shield, 
  ShieldCheck, 
  Plus, 
  Edit, 
  Trash2, 
  Save, 
  Users, 
  CheckCircle2, 
  AlertTriangle,
  Lock,
  Layers,
  Sparkles
} from 'lucide-react';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useAdminDataStore } from '@/store/adminDataStore';
import { useSettingsStore } from '@/store/settingsStore';
import { type Role } from '@/lib/roles';

const AVAILABLE_PERMISSIONS = [
  { key: 'dashboard', label: 'Dashboard', desc: 'Real-time telemetry, network status, and high-level KPIs' },
  { key: 'cms', label: 'Website CMS', desc: 'Control public subscriber portal content, notices, and perks' },
  { key: 'subscribers', label: 'Subscribers', desc: 'Manage customer accounts, optical terminals, and provisioning' },
  { key: 'packages', label: 'Packages', desc: 'Create and modify broadband speed tiers and tariffs' },
  { key: 'billing', label: 'Billing & Invoices', desc: 'Generate bills, process collections, and view ledger' },
  { key: 'tickets', label: 'Support Tickets', desc: 'Triage customer inquiries, faults, and escalation tickets' },
  { key: 'technicians', label: 'Field Technicians', desc: 'Assign optical fiber drops and field maintenance tasks' },
  { key: 'referral_rewards', label: 'Referral Rewards', desc: 'Manage subscriber referral programs, bonuses, and reward ledgers' },
  { key: 'boost_bandwidth', label: 'Boost Bandwidth', desc: 'Control on-demand turbo burst bandwidth speeds and quotas' },
  { key: 'live_latency', label: 'Live Latency & Ping', desc: 'Monitor real-time network latency, jitter, and target hosts' },
  { key: 'interface_traffic', label: 'Bandwidth & Traffic', desc: 'Track interface bandwidth consumption, GPON ports, and live throughput' },
  { key: 'peering_hubs', label: 'Cloud Peering Hubs', desc: 'Manage Tier-1 cloud peering nodes, CDN endpoints, and speedtests' },
  { key: 'reports', label: 'Financial Reports', desc: 'Export monthly revenue, cohort analysis, and utilization' },
  { key: 'roles', label: 'Role Governance', desc: 'Manage administrative roles, permissions, and security staff' },
  { key: 'settings', label: 'System Settings', desc: 'Configure BGP routers, payment gateways, and system defaults' },
  { key: 'profile', label: 'Admin Profile', desc: 'Update administrator account credentials, profile, and security' },
];

export default function RolesPage() {
  const t = (en: string, _bn?: string) => en;
  const { roles, addRole, updateRole, deleteRole, removePermissionFromRole, saveCollection, fetchData } = useAdminDataStore();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<Role | null>(null);

  // Form State
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [description, setDescription] = useState('');
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([]);
  const [isSystem, setIsSystem] = useState(false);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleOpenAdd = () => {
    setEditingRole(null);
    setName('');
    setKey('');
    setDescription('');
    setSelectedPermissions(['dashboard', 'tickets']);
    setIsSystem(false);
    setDialogOpen(true);
  };

  const handleOpenEdit = (role: Role) => {
    setEditingRole(role);
    setName(role.name);
    setKey(role.key);
    setDescription(role.description);
    setSelectedPermissions(role.permissions || []);
    setIsSystem(role.isSystem);
    setDialogOpen(true);
  };

  const togglePermission = (permKey: string) => {
    if (selectedPermissions.includes(permKey)) {
      setSelectedPermissions(selectedPermissions.filter(p => p !== permKey));
    } else {
      setSelectedPermissions([...selectedPermissions, permKey]);
    }
  };

  const handleSaveRole = async () => {
    if (!name.trim()) {
      toast.error(t('Role name is required', 'রোল এর নাম প্রয়োজন'));
      return;
    }
    if (!key.trim()) {
      toast.error(t('Role slug/key is required', 'রোল কোড/কী প্রয়োজন'));
      return;
    }

    const cleanKey = key.toLowerCase().replace(/[^a-z0-9_]/g, '_');

    if (editingRole) {
      // Update existing
      const updated: Role = {
        ...editingRole,
        name: name.trim(),
        key: cleanKey,
        description: description.trim(),
        permissions: selectedPermissions,
      };
      await updateRole(updated);
      toast.success(t(`Role "${updated.name}" updated successfully!`, `রোল "${updated.name}" সফলভাবে আপডেট হয়েছে!`));
    } else {
      // Create new
      const newRole: Role = {
        id: `ROLE-${String(roles.length + 1).padStart(3, '0')}`,
        name: name.trim(),
        key: cleanKey,
        description: description.trim(),
        permissions: selectedPermissions,
        userCount: 0,
        isSystem: false,
      };
      await addRole(newRole);
      toast.success(t(`New role "${newRole.name}" created successfully!`, `নতুন রোল "${newRole.name}" সফলভাবে তৈরি হয়েছে!`));
    }

    setDialogOpen(false);
  };

  const handleDelete = async (role: Role) => {
    if (role.isSystem) {
      toast.error(t('Cannot delete protected core system role', 'সুরক্ষিত সিস্টেম রোল ডিলিট করা সম্ভব নয়'));
      return;
    }

    if (window.confirm(t(`Are you sure you want to delete role "${role.name}"?`, `আপনি কি নিশ্চিতভাবে "${role.name}" রোলটি মুছে ফেলতে চান?`))) {
      await deleteRole(role.id);
      toast.success(t(`Role "${role.name}" deleted.`, `রোল "${role.name}" মুছে ফেলা হয়েছে।`));
    }
  };

  const systemCount = roles.filter(r => r.isSystem).length;
  const customCount = roles.filter(r => !r.isSystem).length;
  const totalStaff = roles.reduce((sum, r) => sum + (r.userCount || 0), 0);

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-card border rounded-2xl p-6 shadow-sm">
        <div>
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
              <ShieldCheck className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">
                {t('Role & Access Control Management', 'ভূমিকা ও অ্যাক্সেস নিয়ন্ত্রণ ব্যবস্থাপনা')}
              </h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                {t('Define permissions, assign operational privileges, and govern administrative access.', 'আইএসপি ইঞ্জিনিয়ার ও কর্মচারীদের ভূমিকা, পারমিশন ও এক্সেস পলিসি তৈরি ও পরিবর্তন করুন।')}
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {customCount > 0 && (
            <Button 
              variant="outline" 
              onClick={async () => {
                if (confirm('Delete all custom roles?')) {
                  const systemOnly = roles.filter(r => r.isSystem);
                  await saveCollection('roles', systemOnly);
                  await fetchData();
                  toast.success('All custom roles deleted');
                }
              }}
              className="gap-2 text-rose-600 hover:text-rose-700 hover:bg-rose-50"
            >
              <Trash2 className="h-4 w-4" />
              Delete Custom Roles
            </Button>
          )}
          <Button onClick={handleOpenAdd} className="gap-2 shadow">
            <Plus className="h-4 w-4" />
            {t('Create New Role', 'নতুন রোল তৈরি করুন')}
          </Button>
        </div>
      </div>

      {/* KPI Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-5 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase">{t('Total Roles', 'মোট রোল')}</p>
              <h3 className="text-2xl font-bold mt-1">{roles.length}</h3>
              <p className="text-xs text-muted-foreground mt-0.5">Active access profiles</p>
            </div>
            <div className="h-10 w-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
              <Shield className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase">{t('System Roles', 'সিস্টেম রোল')}</p>
              <h3 className="text-2xl font-bold mt-1 text-blue-600">{systemCount}</h3>
              <p className="text-xs text-muted-foreground mt-0.5">Built-in protected</p>
            </div>
            <div className="h-10 w-10 rounded-xl bg-blue-500/10 text-blue-600 flex items-center justify-center">
              <Lock className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase">{t('Custom Roles', 'কাস্টম রোল')}</p>
              <h3 className="text-2xl font-bold mt-1 text-emerald-600">{customCount}</h3>
              <p className="text-xs text-muted-foreground mt-0.5">User customized</p>
            </div>
            <div className="h-10 w-10 rounded-xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center">
              <Sparkles className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase">{t('Assigned Staff', 'নিযুক্ত স্টাফ')}</p>
              <h3 className="text-2xl font-bold mt-1 text-purple-600">{totalStaff}</h3>
              <p className="text-xs text-muted-foreground mt-0.5">Staff users active</p>
            </div>
            <div className="h-10 w-10 rounded-xl bg-purple-500/10 text-purple-600 flex items-center justify-center">
              <Users className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Roles List */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <div>
            <CardTitle>{t('Configured Roles & Permission Matrix', 'কনফিগার করা রোল ও পারমিশন ম্যাট্রিক্স')}</CardTitle>
            <CardDescription>{t('Inspect permissions granted to each operational staff position', 'প্রতিটি রোলের জন্য বরাদ্দকৃত অপশন ও পারমিশন দেখুন')}</CardDescription>
          </div>
          <Badge variant="outline" className="font-mono text-xs">
            {roles.length} Roles Registered
          </Badge>
        </CardHeader>
        <CardContent className="pt-2">
          <div className="divide-y">
            {roles.map((role) => (
              <div key={role.id} className="py-4.5 first:pt-2 last:pb-2 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:bg-muted/30 p-3 rounded-xl transition-colors">
                <div className="space-y-2 flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-bold text-muted-foreground">{role.id}</span>
                    <h3 className="text-base font-bold text-foreground">{role.name}</h3>
                    <code className="text-xs bg-muted px-2 py-0.5 rounded font-mono text-primary font-semibold">
                      {role.key}
                    </code>
                    {role.isSystem ? (
                      <Badge variant="secondary" className="gap-1 text-[11px] bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300 border-blue-200">
                        <Lock className="h-3 w-3" /> System Protected
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[11px] text-emerald-600 border-emerald-500/30 bg-emerald-500/5">
                        Custom Role
                      </Badge>
                    )}
                    <span className="text-xs text-muted-foreground flex items-center gap-1 ml-2">
                      <Users className="h-3 w-3" /> {role.userCount || 0} staff assigned
                    </span>
                  </div>

                  <p className="text-xs text-muted-foreground">{role.description}</p>

                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {(role.permissions || []).map((perm) => (
                      <span 
                        key={perm}
                        className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-[11px] font-medium text-foreground border"
                      >
                        <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                        {AVAILABLE_PERMISSIONS.find(p => p.key === perm)?.label || perm}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0 self-end md:self-center">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleOpenEdit(role)}
                    className="gap-1.5 h-8 text-xs font-medium"
                  >
                    <Edit className="h-3.5 w-3.5" />
                    {t('Edit', 'এডিট')}
                  </Button>

                  {!role.isSystem ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleDelete(role)}
                      className="h-8 w-8 p-0 text-rose-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                      title="Delete Role"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled
                      className="h-8 w-8 p-0 opacity-30 cursor-not-allowed"
                      title="System role cannot be deleted"
                    >
                      <Lock className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Role Create/Edit Modal Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingRole 
                ? t(`Edit Role: ${editingRole.name}`, `রোল এডিট: ${editingRole.name}`) 
                : t('Create New Operational Role', 'নতুন ভূমিকা / রোল তৈরি করুন')}
            </DialogTitle>
            <DialogDescription>
              {t('Configure role identifier, display name, description, and module permissions.', 'রোলের নাম, কোড, বিবরণ এবং কোন কোন মডিউলে এক্সেস থাকবে তা নির্ধারণ করুন।')}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label className="text-xs font-semibold">{t('Role Display Name', 'রোলের নাম')}</Label>
                <Input
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    if (!editingRole) {
                      setKey(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, '_'));
                    }
                  }}
                  placeholder="e.g. Senior Optical Engineer"
                  className="mt-1"
                />
              </div>

              <div>
                <Label className="text-xs font-semibold">{t('Role Key / Identifier (Slug)', 'রোল কোড / আইডেন্টিফায়ার')}</Label>
                <Input
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  placeholder="e.g. senior_optical_eng"
                  className="mt-1 font-mono text-xs"
                  disabled={editingRole?.isSystem}
                />
                <p className="text-[11px] text-muted-foreground mt-0.5">Used internally for authorization checks</p>
              </div>
            </div>

            <div>
              <Label className="text-xs font-semibold">{t('Role Purpose & Responsibilities Description', 'দায়িত্ব ও ভূমিকা বিবরণ')}</Label>
              <Textarea
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe what tasks this role handles in the ISP workflow..."
                className="mt-1 text-sm"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {t('Granted Module Permissions', 'অনুমোদিত মডিউল পারমিশন')}
                </Label>
                <div className="flex gap-2">
                  <Button 
                    type="button" 
                    variant="ghost" 
                    size="sm" 
                    onClick={() => setSelectedPermissions(AVAILABLE_PERMISSIONS.map(p => p.key))}
                    className="h-6 text-[11px] px-2"
                  >
                    Select All
                  </Button>
                  <Button 
                    type="button" 
                    variant="ghost" 
                    size="sm" 
                    onClick={() => setSelectedPermissions(['dashboard'])}
                    className="h-6 text-[11px] px-2"
                  >
                    Reset
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-64 overflow-y-auto p-1">
                {AVAILABLE_PERMISSIONS.map((perm) => {
                  const isChecked = selectedPermissions.includes(perm.key);
                  return (
                    <div
                      key={perm.key}
                      onClick={() => togglePermission(perm.key)}
                      className={`flex items-start gap-2.5 p-2.5 rounded-xl border cursor-pointer transition-all ${
                        isChecked 
                          ? 'border-primary bg-primary/5 text-foreground shadow-xs' 
                          : 'border-border hover:bg-muted/50 text-muted-foreground'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => {}}
                        className="mt-1 rounded text-primary"
                      />
                      <div className="min-w-0">
                        <p className={`text-xs font-semibold ${isChecked ? 'text-foreground' : ''}`}>{perm.label}</p>
                        <p className="text-[11px] text-muted-foreground leading-tight line-clamp-2">{perm.desc}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              {t('Cancel', 'বাতিল')}
            </Button>
            <Button onClick={handleSaveRole} className="gap-1.5 shadow">
              <Save className="h-4 w-4" />
              {t('Save Role Configuration', 'রোল কনফিগারেশন সংরক্ষণ করুন')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
