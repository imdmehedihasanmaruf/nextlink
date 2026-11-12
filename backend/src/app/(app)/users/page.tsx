'use client';

import React, { useState, useEffect, useMemo } from 'react';
import {
  Users, ShieldAlert, ShieldCheck, Eye, Ban, CheckCircle2, UserPlus,
  Trash2, KeyRound, Search, Plus, RefreshCw, AlertTriangle, Globe,
  Shield, MapPin, Phone, Mail, Wifi, Copy, Check, Lock, AlertOctagon,
  ExternalLink, UserCheck
} from 'lucide-react';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { type Subscriber, type SubscriberStatus } from '@/lib/mockData';
import { useAdminDataStore } from '@/store/adminDataStore';
import { formatDate } from '@/lib/utils';
import { apiPost } from '@/lib/apiClient';

export default function UserDetailsPage() {
  const { subscribers, packages, updateSubscriber, deleteSubscriber, fetchData, isLoading } = useAdminDataStore();
  
  // State
  const [activeTab, setActiveTab] = useState<'all' | 'active' | 'registered' | 'cancelled' | 'vpn' | 'spam' | 'scam' | 'blocked'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [riskFilter, setRiskFilter] = useState('all');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [busyUser, setBusyUser] = useState<string | null>(null);

  // Modals state
  const [selectedUser, setSelectedUser] = useState<Subscriber | null>(null);
  const [viewDetailsOpen, setViewDetailsOpen] = useState(false);
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [userForPasswordReset, setUserForPasswordReset] = useState<Subscriber | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [addUserOpen, setAddUserOpen] = useState(false);

  // New user form state. There is no password field — the API generates a
  // one-time temporary password for each account.
  const [newUserForm, setNewUserForm] = useState({
    name: '',
    username: '',
    phone: '',
    email: '',
    packageId: '',
    address: '',
    isVpn: false,
    isSpam: false,
    isScam: false,
    riskScore: 'low' as 'low' | 'medium' | 'high',
  });

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    toast.success('Copied to clipboard');
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Filter users based on tabs and search.
  //
  // This page is "User Details": everyone who has an account on the portal.
  // That includes accounts that registered but have not bought a plan yet, and
  // accounts whose subscription was cancelled — their purchase and cancellation
  // dates stay on their profile. The subscriber list (those with a live plan)
  // is the "Subscriber Details" page.
  const filteredUsers = useMemo(() => {
    return subscribers.filter((user) => {
      // Tab filter
      if (activeTab === 'active' && user.status !== 'active') return false;
      if (activeTab === 'registered' && user.status !== 'registered') return false;
      if (activeTab === 'cancelled' && user.status !== 'cancelled') return false;
      if (activeTab === 'vpn' && !user.isVpn) return false;
      if (activeTab === 'spam' && !user.isSpam) return false;
      if (activeTab === 'scam' && !user.isScam && user.riskScore !== 'high') return false;
      if (activeTab === 'blocked' && user.status !== 'blocked' && user.status !== 'suspended') return false;

      // Risk score filter
      if (riskFilter !== 'all' && (user.riskScore || 'low') !== riskFilter) return false;

      // Search query
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const matchesId = (user.id || '').toLowerCase().includes(query);
        const matchesName = (user.name || '').toLowerCase().includes(query);
        const matchesUsername = (user.username || '').toLowerCase().includes(query);
        const matchesPhone = (user.phone || '').toLowerCase().includes(query);
        const matchesEmail = (user.email || '').toLowerCase().includes(query);
        const matchesAddress = (user.address || '').toLowerCase().includes(query);
        const matchesIp = (user.ipAddress || '').toLowerCase().includes(query);
        const matchesPlan = (user.packageName || '').toLowerCase().includes(query);

        if (!matchesId && !matchesName && !matchesUsername && !matchesPhone && !matchesEmail && !matchesAddress && !matchesIp && !matchesPlan) {
          return false;
        }
      }

      return true;
    });
  }, [subscribers, activeTab, riskFilter, searchQuery]);

  // Counts for tabs & badges
  const stats = useMemo(() => {
    const total = subscribers.length;
    const active = subscribers.filter(s => s.status === 'active').length;
    const registered = subscribers.filter(s => s.status === 'registered').length;
    const cancelled = subscribers.filter(s => s.status === 'cancelled').length;
    const vpn = subscribers.filter(s => s.isVpn).length;
    const spam = subscribers.filter(s => s.isSpam).length;
    const scam = subscribers.filter(s => s.isScam || s.riskScore === 'high').length;
    const blocked = subscribers.filter(s => s.status === 'blocked' || s.status === 'suspended').length;
    return { total, active, registered, cancelled, vpn, spam, scam, blocked };
  }, [subscribers]);

  // Block / Unblock handler. Blocking goes through the billing service,
  // which disables the PPPoE secret on the router — otherwise the customer
  // remained connected while the admin panel claimed their line was cut.
  const handleToggleBlock = async (user: Subscriber) => {
    const isCurrentlyBlocked = user.status === 'blocked' || user.status === 'suspended';
    const action = isCurrentlyBlocked ? 'restore' : 'suspend';

    if (confirm(
      isCurrentlyBlocked
        ? `Restore ${user.name}'s connection on the router?`
        : `Suspend ${user.name}'s connection on the router? Their PPPoE secret will be disabled.`
    )) {
      setBusyUser(user.id);
      const result = await apiPost(`/api/mikrotik/${action}`, {
        subscriberId: user.id,
        username: user.username || user.id,
      });
      setBusyUser(null);

      if (!result.success) {
        toast.error(result.error || `The router refused the ${action} request`);
        return;
      }

      toast.success(
        isCurrentlyBlocked
          ? `${user.name}'s line restored on the router and account activated.`
          : `${user.name}'s line suspended on the router and account suspended.`
      );

      await fetchData();
      if (selectedUser?.id === user.id) {
        setSelectedUser(null);
        setViewDetailsOpen(false);
      }
    }
  };

  // Deactivate (archive) handler. The subscriber is never removed from the
  // system — the account is deactivated and the billing history is kept.
  const handleDeleteUser = async (user: Subscriber) => {
    if (confirm(`Deactivate account "${user.name}" (${user.id})? The billing history will be kept.`)) {
      await deleteSubscriber(user.id);
      toast.success(`User ${user.name} was deactivated and the line was suspended.`);
      if (selectedUser?.id === user.id) {
        setViewDetailsOpen(false);
        setSelectedUser(null);
      }
    }
  };

  // Password reset handler
  const handleOpenPasswordModal = (user: Subscriber) => {
    setUserForPasswordReset(user);
    setNewPassword('');
    setConfirmPassword('');
    setPasswordModalOpen(true);
  };

  const handleSavePassword = async () => {
    if (!userForPasswordReset) return;
    if (!newPassword || newPassword.length < 8) {
      toast.error('Password must be at least 8 characters long');
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }

    // The password is stored hashed by the API, so it is never written to the
    // local store in plain text.
    const apiResult = await apiPost(`/api/auth/admin/reset-password`, {
      subscriberId: userForPasswordReset.id,
      newPassword,
    });

    if (!apiResult.success) {
      toast.error(apiResult.error || 'Could not update the password');
      return;
    }

    // Keep the local record in sync without the plain password.
    const updated = {
      ...userForPasswordReset,
      password: '',
      passwordUpdated: true,
    };

    await updateSubscriber(updated);
    toast.success(`Password for ${userForPasswordReset.name} updated successfully!`);
    setPasswordModalOpen(false);
    setUserForPasswordReset(null);
    setNewPassword('');
    setConfirmPassword('');

    if (selectedUser?.id === userForPasswordReset.id) {
      setSelectedUser(updated);
    }
  };

  const generateRandomPassword = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
    let res = '';
    for (let i = 0; i < 12; i++) {
      res += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setNewPassword(res);
    setConfirmPassword(res);
  };

  // Add new user handler. The account is created through the backend so the
  // credential is stored only as a hash — the operator receives a one-time
  // temporary password to hand to the customer.
  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUserForm.name || !newUserForm.phone || !newUserForm.email) {
      toast.error('Name, Phone and Email are required');
      return;
    }

    // A package plan is optional here: an operator can create a portal
    // account that has no service yet. The account becomes a subscriber when
    // a plan is purchased.
    setBusyUser('creating');
    const result = await apiPost('/api/users', {
      name: newUserForm.name,
      username: newUserForm.username || newUserForm.email.split('@')[0],
      phone: newUserForm.phone,
      email: newUserForm.email,
      // Never the operator's own input — the API generates a one-time
      // password and returns it exactly once.
      password: '',
      packageId: newUserForm.packageId || '',
      address: newUserForm.address,
      isVpn: newUserForm.isVpn,
      isSpam: newUserForm.isSpam,
      isScam: newUserForm.isScam,
      riskScore: newUserForm.riskScore,
    });
    setBusyUser(null);

    if (!result.success || !result.temporaryPassword) {
      toast.error(result.error || 'The user could not be created');
      return;
    }

    toast.success(
      `User ${newUserForm.name} created. Temporary password: ${result.temporaryPassword} — share it with the customer and ask them to change it on first sign-in.`,
      { duration: 30000 },
    );

    setAddUserOpen(false);
    setNewUserForm({
      name: '',
      username: '',
      phone: '',
      email: '',
      packageId: '',
      address: '',
      isVpn: false,
      isSpam: false,
      isScam: false,
      riskScore: 'low',
    });
    await fetchData();
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-primary/10 text-primary">
              <Users className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Subscribers & Security</h1>
              <p className="text-sm text-muted-foreground">
                Every subscriber, credentials, internet plan, fraud &amp; VPN intelligence, and access controls.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchData()}
            disabled={isLoading}
            className="gap-2 shadow-sm"
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>

          <Button
            size="sm"
            onClick={() => setAddUserOpen(true)}
            className="gap-2 shadow-md bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" />
            Add User
          </Button>
        </div>
      </div>

      {/* Top Metrics Cards */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <Card className="cursor-pointer hover:border-primary/50 transition-all shadow-sm" onClick={() => setActiveTab('all')}>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Total Users</span>
              <Users className="h-4 w-4 text-primary" />
            </div>
            <div className="text-2xl font-bold mt-1 text-foreground">{stats.total}</div>
            <p className="text-[11px] text-muted-foreground mt-0.5">Every registered account</p>
          </CardContent>
        </Card>

        <Card className="cursor-pointer hover:border-emerald-500/50 transition-all shadow-sm" onClick={() => setActiveTab('active')}>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Active Subscribers</span>
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            </div>
            <div className="text-2xl font-bold mt-1 text-emerald-600 dark:text-emerald-400">{stats.active}</div>
            <p className="text-[11px] text-muted-foreground mt-0.5">Online & verified</p>
          </CardContent>
        </Card>

        <Card className="cursor-pointer hover:border-blue-500/50 transition-all shadow-sm" onClick={() => setActiveTab('registered')}>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Registered</span>
              <UserPlus className="h-4 w-4 text-blue-500" />
            </div>
            <div className="text-2xl font-bold mt-1 text-blue-600 dark:text-blue-400">{stats.registered}</div>
            <p className="text-[11px] text-muted-foreground mt-0.5">Account created, no plan yet</p>
          </CardContent>
        </Card>

        <Card className="cursor-pointer hover:border-amber-500/50 transition-all shadow-sm" onClick={() => setActiveTab('vpn')}>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">VPN / Proxy</span>
              <Globe className="h-4 w-4 text-amber-500" />
            </div>
            <div className="text-2xl font-bold mt-1 text-amber-600 dark:text-amber-400">{stats.vpn}</div>
            <p className="text-[11px] text-muted-foreground mt-0.5">Commercial VPN detected</p>
          </CardContent>
        </Card>

        <Card className="cursor-pointer hover:border-orange-500/50 transition-all shadow-sm" onClick={() => setActiveTab('spam')}>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Spam Flagged</span>
              <AlertOctagon className="h-4 w-4 text-orange-500" />
            </div>
            <div className="text-2xl font-bold mt-1 text-orange-600 dark:text-orange-400">{stats.spam}</div>
            <p className="text-[11px] text-muted-foreground mt-0.5">Disposable email/bot</p>
          </CardContent>
        </Card>

        <Card className="cursor-pointer hover:border-rose-500/50 transition-all shadow-sm" onClick={() => setActiveTab('scam')}>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Scam / High Risk</span>
              <ShieldAlert className="h-4 w-4 text-rose-500" />
            </div>
            <div className="text-2xl font-bold mt-1 text-rose-600 dark:text-rose-400">{stats.scam}</div>
            <p className="text-[11px] text-muted-foreground mt-0.5">Threat telemetries</p>
          </CardContent>
        </Card>

        <Card className="cursor-pointer hover:border-red-500/50 transition-all shadow-sm" onClick={() => setActiveTab('blocked')}>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Blocked</span>
              <Ban className="h-4 w-4 text-rose-500" />
            </div>
            <div className="text-2xl font-bold mt-1 text-rose-600 dark:text-rose-400">{stats.blocked}</div>
            <p className="text-[11px] text-muted-foreground mt-0.5">Suspended / Barred</p>
          </CardContent>
        </Card>
      </div>

      {/* Filter Navigation Tabs */}
      <div className="flex flex-wrap items-center gap-2 border-b pb-3">
        <Button
          variant={activeTab === 'all' ? 'default' : 'ghost'}
          size="sm"
          onClick={() => setActiveTab('all')}
          className="gap-2 rounded-lg"
        >
          <Users className="h-4 w-4" />
          All Users
          <span className="ml-1 text-xs px-1.5 py-0.2 rounded-full bg-background/20 font-mono">
            {stats.total}
          </span>
        </Button>

        <Button
          variant={activeTab === 'active' ? 'default' : 'ghost'}
          size="sm"
          onClick={() => setActiveTab('active')}
          className="gap-2 rounded-lg text-emerald-600 dark:text-emerald-400"
        >
          <CheckCircle2 className="h-4 w-4" />
          Active Subscribers
          <span className="ml-1 text-xs px-1.5 py-0.2 rounded-full bg-emerald-500/10 font-mono">
            {stats.active}
          </span>
        </Button>

        <Button
          variant={activeTab === 'registered' ? 'default' : 'ghost'}
          size="sm"
          onClick={() => setActiveTab('registered')}
          className="gap-2 rounded-lg text-blue-600 dark:text-blue-400"
        >
          <UserPlus className="h-4 w-4" />
          Registered
          <span className="ml-1 text-xs px-1.5 py-0.2 rounded-full bg-blue-500/10 font-mono">
            {stats.registered}
          </span>
        </Button>

        <Button
          variant={activeTab === 'cancelled' ? 'default' : 'ghost'}
          size="sm"
          onClick={() => setActiveTab('cancelled')}
          className="gap-2 rounded-lg text-amber-600 dark:text-amber-400"
        >
          <Ban className="h-4 w-4" />
          Cancelled
          <span className="ml-1 text-xs px-1.5 py-0.2 rounded-full bg-amber-500/10 font-mono">
            {stats.cancelled}
          </span>
        </Button>

        <Button
          variant={activeTab === 'vpn' ? 'default' : 'ghost'}
          size="sm"
          onClick={() => setActiveTab('vpn')}
          className="gap-2 rounded-lg text-amber-600 dark:text-amber-400"
        >
          <Globe className="h-4 w-4" />
          Fraud / VPN Detection
          <span className="ml-1 text-xs px-1.5 py-0.2 rounded-full bg-amber-500/10 font-mono">
            {stats.vpn}
          </span>
        </Button>

        <Button
          variant={activeTab === 'spam' ? 'default' : 'ghost'}
          size="sm"
          onClick={() => setActiveTab('spam')}
          className="gap-2 rounded-lg text-orange-600 dark:text-orange-400"
        >
          <AlertOctagon className="h-4 w-4" />
          Spam List
          <span className="ml-1 text-xs px-1.5 py-0.2 rounded-full bg-orange-500/10 font-mono">
            {stats.spam}
          </span>
        </Button>

        <Button
          variant={activeTab === 'scam' ? 'default' : 'ghost'}
          size="sm"
          onClick={() => setActiveTab('scam')}
          className="gap-2 rounded-lg text-rose-600 dark:text-rose-400"
        >
          <ShieldAlert className="h-4 w-4" />
          Scam & Threat List
          <span className="ml-1 text-xs px-1.5 py-0.2 rounded-full bg-rose-500/10 font-mono">
            {stats.scam}
          </span>
        </Button>

        <Button
          variant={activeTab === 'blocked' ? 'default' : 'ghost'}
          size="sm"
          onClick={() => setActiveTab('blocked')}
          className="gap-2 rounded-lg text-rose-700 dark:text-rose-300"
        >
          <Ban className="h-4 w-4" />
          Blocked Subscribers
          <span className="ml-1 text-xs px-1.5 py-0.2 rounded-full bg-rose-500/10 font-mono">
            {stats.blocked}
          </span>
        </Button>
      </div>

      {/* Search and Secondary Filter */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by ID, Username, Name, Phone, Email, Address, or IP..."
            className="pl-9 bg-card"
          />
        </div>

        <div className="flex items-center gap-2">
          <Select value={riskFilter} onValueChange={setRiskFilter}>
            <SelectTrigger className="w-40 bg-card">
              <SelectValue placeholder="Risk Level" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Risk Levels</SelectItem>
              <SelectItem value="low">Low Risk (Clean)</SelectItem>
              <SelectItem value="medium">Medium Risk</SelectItem>
              <SelectItem value="high">High Risk</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Main Table Card */}
      <Card className="overflow-hidden border shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left border-collapse">
            <thead className="bg-muted/50 text-xs font-semibold text-muted-foreground uppercase border-b">
              <tr>
                <th className="py-3 px-4">User ID</th>
                <th className="py-3 px-4">User Info</th>
                <th className="py-3 px-4">Phone & Email</th>
                <th className="py-3 px-4">Installation Address</th>
                <th className="py-3 px-4">Internet Plan</th>
                <th className="py-3 px-4">Password</th>
                <th className="py-3 px-4">Fraud / Security Check</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-muted-foreground">
                    <div className="flex flex-col items-center justify-center space-y-2">
                      <Users className="h-8 w-8 text-muted-foreground/50" />
                      <p className="text-base font-medium">No users found</p>
                      <p className="text-xs">Try adjusting your search query or tab filters.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredUsers.map((user) => {
                  const isBlocked = user.status === 'blocked' || user.status === 'suspended';

                  return (
                    <tr
                      key={user.id}
                      className={`hover:bg-muted/30 transition-colors ${
                        isBlocked ? 'bg-rose-500/5' : ''
                      }`}
                    >
                      {/* User ID */}
                      <td className="py-3.5 px-4 font-mono text-xs whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold text-foreground bg-primary/10 text-primary px-2 py-0.5 rounded">
                            {user.id}
                          </span>
                          <button
                            type="button"
                            onClick={() => copyToClipboard(user.id, `id-${user.id}`)}
                            title="Copy User ID"
                            className="text-muted-foreground hover:text-foreground transition-colors p-1"
                          >
                            {copiedId === `id-${user.id}` ? (
                              <Check className="h-3 w-3 text-emerald-500" />
                            ) : (
                              <Copy className="h-3 w-3" />
                            )}
                          </button>
                        </div>
                      </td>

                      {/* User Info (Username + Full Name) */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <div>
                          <p className="font-semibold text-foreground text-sm flex items-center gap-1.5">
                            {user.name}
                          </p>
                          <p className="text-xs text-primary font-mono font-medium">
                            @{user.username || (user.email ? user.email.split('@')[0] : 'user')}
                          </p>
                        </div>
                      </td>

                      {/* Phone & Email */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <div className="space-y-0.5">
                          <p className="text-xs font-mono font-medium text-foreground flex items-center gap-1">
                            <Phone className="h-3 w-3 text-muted-foreground shrink-0" />
                            {user.phone}
                          </p>
                          <p className="text-xs text-muted-foreground flex items-center gap-1">
                            <Mail className="h-3 w-3 text-muted-foreground shrink-0" />
                            <span className="truncate max-w-[150px]" title={user.email}>
                              {user.email}
                            </span>
                          </p>
                        </div>
                      </td>

                      {/* Installation Address */}
                      <td className="py-3.5 px-4">
                        <div className="flex items-start gap-1 max-w-[200px]">
                          <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
                          <span className="text-xs text-foreground line-clamp-2" title={user.address}>
                            {user.address || 'Standard Installation Address'}
                          </span>
                        </div>
                      </td>

                      {/* Internet Plan — a registered account has no plan until
                          it purchases one. */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        {user.packageName ? (
                          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-secondary text-secondary-foreground text-xs font-medium border">
                            <Wifi className="h-3 w-3 text-primary" />
                            <span>{user.packageName}</span>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">No plan yet</span>
                        )}
                      </td>

                      {/* Password — never stored or shown; must be reset */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <div className="flex items-center gap-1.5 bg-muted/40 px-2 py-1 rounded border max-w-[160px]">
                          <Lock className="h-3 w-3 text-muted-foreground shrink-0" />
                          <span className="font-mono text-xs text-muted-foreground truncate">
                            Hashed only
                          </span>
                          <button
                            type="button"
                            aria-label="Reset password"
                            onClick={() => handleOpenPasswordModal(user)}
                            className="p-1 hover:text-primary text-muted-foreground transition-colors ml-auto"
                            title="Reset / Set New Password"
                          >
                            <KeyRound className="h-3 w-3" />
                          </button>
                        </div>
                      </td>

                      {/* Fraud / Security Check */}
                      <td className="py-3.5 px-4">
                        <div className="flex flex-col gap-1 items-start min-w-[130px]">
                          {user.isScam || user.riskScore === 'high' ? (
                            <Badge variant="destructive" className="gap-1 text-[11px] font-semibold py-0.5">
                              <ShieldAlert className="h-3 w-3" />
                              Scam Alert
                            </Badge>
                          ) : user.isSpam ? (
                            <Badge className="bg-orange-500 hover:bg-orange-600 text-white gap-1 text-[11px] font-semibold py-0.5 border-0">
                              <AlertOctagon className="h-3 w-3" />
                              Spam Flagged
                            </Badge>
                          ) : user.isVpn ? (
                            <Badge className="bg-amber-500 hover:bg-amber-600 text-white gap-1 text-[11px] font-semibold py-0.5 border-0">
                              <Globe className="h-3 w-3" />
                              VPN / Proxy
                            </Badge>
                          ) : (
                            <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 gap-1 text-[11px] font-medium py-0.5">
                              <CheckCircle2 className="h-3 w-3" />
                              Clean IP
                            </Badge>
                          )}

                          <div className="flex items-center gap-1 text-[10px] text-muted-foreground font-mono">
                            <span>Risk:</span>
                            <span className={
                              user.riskScore === 'high' ? 'text-rose-500 font-bold uppercase' :
                              user.riskScore === 'medium' ? 'text-amber-500 font-bold uppercase' :
                              'text-emerald-500 font-medium uppercase'
                            }>
                              {user.riskScore || 'low'}
                            </span>
                            {user.ipAddress && (
                              <span className="truncate max-w-[80px]" title={user.ipAddress}>• {user.ipAddress}</span>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Status — a registered account is not a subscriber, and a
                          cancelled account is no longer one either. */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        {(() => {
                          const s = String(user.status || '').toLowerCase();
                          const map: Record<string, { label: string; cls: string; dot: string }> = {
                            active:      { label: 'Subscriber',     cls: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30', dot: 'bg-emerald-500' },
                            registered:  { label: 'Registered',     cls: 'bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30', dot: 'bg-blue-500' },
                            cancelled:   { label: 'Cancelled',      cls: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30', dot: 'bg-amber-500' },
                            suspended:   { label: 'Suspended',      cls: 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30', dot: 'bg-rose-500' },
                            blocked:     { label: 'Blocked',        cls: 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30', dot: 'bg-rose-500' },
                            pending:     { label: 'Pending',        cls: 'bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30', dot: 'bg-blue-500' },
                            inactive:    { label: 'Inactive',       cls: 'bg-muted text-muted-foreground border-border', dot: 'bg-muted-foreground' },
                            deactivated: { label: 'Deactivated',    cls: 'bg-muted text-muted-foreground border-border', dot: 'bg-muted-foreground' },
                          };
                          const v = map[s] || { label: s || 'On File', cls: 'bg-muted text-muted-foreground border-border', dot: 'bg-muted-foreground' };
                          return (
                            <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold border ${v.cls}`}>
                              <span className={`h-1.5 w-1.5 rounded-full ${v.dot}`} />
                              {v.label}
                            </span>
                          );
                        })()}
                      </td>

                      {/* Actions */}
                      <td className="py-3.5 px-4 whitespace-nowrap text-right">
                        <div className="flex items-center justify-end gap-1">
                          {/* View Details */}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-foreground hover:bg-muted"
                            title="View Full Details"
                            onClick={() => {
                              setSelectedUser(user);
                              setViewDetailsOpen(true);
                            }}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>

                          {/* Block / Unblock */}
                          <Button
                            variant="ghost"
                            size="icon"
                            disabled={busyUser === user.id}
                            className={`h-8 w-8 ${
                              isBlocked
                                ? 'text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/40'
                                : 'text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/40'
                            }`}
                            title={busyUser === user.id ? 'Talking to the router…' : isBlocked ? 'Unblock User' : 'Block User'}
                            onClick={() => handleToggleBlock(user)}
                          >
                            {busyUser === user.id
                              ? <RefreshCw className="h-4 w-4 animate-spin" />
                              : isBlocked
                                ? <CheckCircle2 className="h-4 w-4" />
                                : <Ban className="h-4 w-4" />}
                          </Button>

                          {/* Set New Password */}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-amber-600 hover:text-amber-700 hover:bg-amber-50 dark:hover:bg-amber-950/40"
                            title="Set New Password"
                            onClick={() => handleOpenPasswordModal(user)}
                          >
                            <KeyRound className="h-4 w-4" />
                          </Button>

                          {/* Delete */}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-rose-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                            title="Deactivate User"
                            onClick={() => handleDeleteUser(user)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* ─────────────────────────────────────────────────────────────
          1. View Details Modal
      ───────────────────────────────────────────────────────────── */}
      <Dialog open={viewDetailsOpen} onOpenChange={setViewDetailsOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          {selectedUser && (
            <div>
              <DialogHeader>
                <div className="flex items-center justify-between pr-4">
                  <div>
                    <DialogTitle className="text-xl font-bold flex items-center gap-2">
                      <span>{selectedUser.name}</span>
                      <span className="font-mono text-xs px-2 py-0.5 rounded bg-primary/10 text-primary">
                        {selectedUser.id}
                      </span>
                    </DialogTitle>
                    <DialogDescription>
                      Full registration credentials, connection telemetry & fraud score analysis.
                    </DialogDescription>
                  </div>
                  <Badge variant={selectedUser.status === 'blocked' ? 'destructive' : 'default'} className="uppercase text-xs">
                    {selectedUser.status}
                  </Badge>
                </div>
              </DialogHeader>

              <div className="space-y-5 my-4">
                {/* Profile Grid */}
                <div className="grid grid-cols-2 gap-4 p-4 rounded-xl bg-muted/40 border">
                  <div>
                    <span className="text-xs text-muted-foreground font-medium">Username</span>
                    <p className="text-sm font-mono font-semibold text-primary">
                      @{selectedUser.username || (selectedUser.email ? selectedUser.email.split('@')[0] : 'user')}
                    </p>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground font-medium">Full Name</span>
                    <p className="text-sm font-semibold">{selectedUser.name}</p>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground font-medium">Phone Number</span>
                    <p className="text-sm font-mono font-medium">{selectedUser.phone}</p>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground font-medium">Email Address</span>
                    <p className="text-sm font-medium">{selectedUser.email}</p>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground font-medium">Internet Plan</span>
                    <p className="text-sm font-semibold text-foreground flex items-center gap-1.5 mt-0.5">
                      <Wifi className="h-3.5 w-3.5 text-primary" />
                      {selectedUser.packageName || 'No plan yet'}
                    </p>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground font-medium">Joined Date</span>
                    <p className="text-sm font-medium">{formatDate(selectedUser.joinDate)}</p>
                  </div>
                  {/* Subscription lifecycle — kept on the profile so the
                      purchase and cancellation dates are always available. */}
                  <div>
                    <span className="text-xs text-muted-foreground font-medium">Subscribed On</span>
                    <p className="text-sm font-medium">
                      {selectedUser.subscriptionStartedAt
                        ? formatDate(selectedUser.subscriptionStartedAt)
                        : 'Not yet'}
                    </p>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground font-medium">Cancelled On</span>
                    <p className="text-sm font-medium">
                      {selectedUser.subscriptionCancelledAt
                        ? formatDate(selectedUser.subscriptionCancelledAt)
                        : '—'}
                    </p>
                  </div>
                  <div className="col-span-2">
                    <span className="text-xs text-muted-foreground font-medium">Installation Address</span>
                    <p className="text-sm font-medium text-foreground mt-0.5 flex items-start gap-1.5">
                      <MapPin className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                      {selectedUser.address || 'Standard Installation Address'}
                    </p>
                  </div>
                </div>

                {/* Password & Security Section */}
                <div className="p-4 rounded-xl border bg-card space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                      <Lock className="h-3.5 w-3.5 text-primary" />
                      Account Password & Authentication
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleOpenPasswordModal(selectedUser)}
                      className="gap-1.5 text-xs h-7"
                    >
                      <KeyRound className="h-3.5 w-3.5" />
                      Set New Password
                    </Button>
                  </div>

                  <div className="flex items-center justify-between bg-muted/60 p-3 rounded-lg border font-mono text-sm">
                    <div>
                      <span className="text-xs text-muted-foreground block font-sans">Password</span>
                      <span className="font-bold text-muted-foreground font-sans">
                        Not shown — passwords are stored as hashes only
                      </span>
                      <span className="text-[10px] text-muted-foreground block font-sans mt-0.5">
                        Use the Reset button to issue a fresh one
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        title="Issue a new password"
                        onClick={() => {
                          setViewDetailsOpen(false);
                          handleOpenPasswordModal(selectedUser);
                        }}
                      >
                        <KeyRound className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Fraud, VPN & Risk Telemetry */}
                <div className="p-4 rounded-xl border bg-card space-y-3">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                    <Shield className="h-3.5 w-3.5 text-primary" />
                    Fraud, VPN & Risk Telemetry
                  </span>

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    <div className="p-2.5 rounded-lg bg-muted/40 border">
                      <span className="text-xs text-muted-foreground block">VPN / Proxy Status</span>
                      <div className="mt-1">
                        {selectedUser.isVpn ? (
                          <Badge className="bg-amber-500 text-white gap-1 text-xs">
                            <Globe className="h-3 w-3" />
                            VPN Detected
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-emerald-600 gap-1 text-xs">
                            <CheckCircle2 className="h-3 w-3" />
                            Clean Residential
                          </Badge>
                        )}
                      </div>
                      {selectedUser.vpnProvider && (
                        <p className="text-[11px] text-muted-foreground mt-1 truncate" title={selectedUser.vpnProvider}>
                          {selectedUser.vpnProvider}
                        </p>
                      )}
                    </div>

                    <div className="p-2.5 rounded-lg bg-muted/40 border">
                      <span className="text-xs text-muted-foreground block">Spam Classification</span>
                      <div className="mt-1">
                        {selectedUser.isSpam ? (
                          <Badge className="bg-orange-500 text-white gap-1 text-xs">
                            <AlertOctagon className="h-3 w-3" />
                            Spam Flagged
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-emerald-600 gap-1 text-xs">
                            <CheckCircle2 className="h-3 w-3" />
                            No Spam Flag
                          </Badge>
                        )}
                      </div>
                    </div>

                    <div className="p-2.5 rounded-lg bg-muted/40 border">
                      <span className="text-xs text-muted-foreground block">Scam / Threat Level</span>
                      <div className="mt-1">
                        {selectedUser.isScam ? (
                          <Badge variant="destructive" className="gap-1 text-xs">
                            <ShieldAlert className="h-3 w-3" />
                            Scam Flagged
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-emerald-600 gap-1 text-xs">
                            <CheckCircle2 className="h-3 w-3" />
                            Verified Safe
                          </Badge>
                        )}
                      </div>
                    </div>

                    <div className="p-2.5 rounded-lg bg-muted/40 border">
                      <span className="text-xs text-muted-foreground block">Client IP Address</span>
                      <p className="text-xs font-mono font-bold mt-1 text-foreground">
                        {selectedUser.ipAddress || '103.147.218.42'}
                      </p>
                    </div>

                    <div className="p-2.5 rounded-lg bg-muted/40 border">
                      <span className="text-xs text-muted-foreground block">MAC Address</span>
                      <p className="text-xs font-mono font-bold mt-1 text-foreground">
                        {selectedUser.macAddress || 'AA:BB:CC:DD:EE:FF'}
                      </p>
                    </div>

                    <div className="p-2.5 rounded-lg bg-muted/40 border">
                      <span className="text-xs text-muted-foreground block">Overall Risk Score</span>
                      <span className={`text-xs font-bold uppercase block mt-1 ${
                        selectedUser.riskScore === 'high' ? 'text-rose-600' :
                        selectedUser.riskScore === 'medium' ? 'text-amber-600' :
                        'text-emerald-600'
                      }`}>
                        {selectedUser.riskScore || 'low'} Risk
                      </span>
                    </div>
                  </div>

                  {selectedUser.riskReason && (
                    <div className="p-2.5 rounded-lg bg-muted/30 border text-xs text-muted-foreground">
                      <strong className="text-foreground">Analysis Note:</strong> {selectedUser.riskReason}
                    </div>
                  )}

                  {/* Manual Flag Adjustment Controls */}
                  <div className="flex flex-wrap items-center gap-2 pt-2 border-t">
                    <span className="text-xs text-muted-foreground">Admin Overrides:</span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs gap-1"
                      onClick={async () => {
                        const updated = {
                          ...selectedUser,
                          isVpn: !selectedUser.isVpn,
                          vpnProvider: !selectedUser.isVpn ? 'Manual VPN Flag' : null,
                        };
                        await updateSubscriber(updated);
                        setSelectedUser(updated);
                        toast.success('VPN detection flag toggled');
                      }}
                    >
                      <Globe className="h-3 w-3 text-amber-500" />
                      Toggle VPN ({selectedUser.isVpn ? 'On' : 'Off'})
                    </Button>

                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs gap-1"
                      onClick={async () => {
                        const updated = {
                          ...selectedUser,
                          isSpam: !selectedUser.isSpam,
                        };
                        await updateSubscriber(updated);
                        setSelectedUser(updated);
                        toast.success('Spam detection flag toggled');
                      }}
                    >
                      <AlertOctagon className="h-3 w-3 text-orange-500" />
                      Toggle Spam ({selectedUser.isSpam ? 'On' : 'Off'})
                    </Button>

                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs gap-1"
                      onClick={async () => {
                        const nextScam = !selectedUser.isScam;
                        const updated: Subscriber = {
                          ...selectedUser,
                          isScam: nextScam,
                          riskScore: nextScam ? 'high' : 'low',
                          status: nextScam ? 'blocked' : 'active',
                        };
                        await updateSubscriber(updated);
                        setSelectedUser(updated);
                        toast.success('Scam flag toggled');
                      }}
                    >
                      <ShieldAlert className="h-3 w-3 text-rose-500" />
                      Toggle Scam ({selectedUser.isScam ? 'On' : 'Off'})
                    </Button>
                  </div>
                </div>
              </div>

              <DialogFooter className="flex flex-col sm:flex-row items-center justify-between gap-2 border-t pt-3">
                <Button
                  variant={selectedUser.status === 'blocked' ? 'default' : 'destructive'}
                  size="sm"
                  disabled={busyUser === selectedUser.id}
                  onClick={() => handleToggleBlock(selectedUser)}
                  className="gap-1.5 w-full sm:w-auto"
                >
                  {busyUser === selectedUser.id ? (
                    <>
                      <RefreshCw className="h-4 w-4 animate-spin" />
                      Talking to the router…
                    </>
                  ) : selectedUser.status === 'blocked' ? (
                    <>
                      <CheckCircle2 className="h-4 w-4" />
                      Unblock User
                    </>
                  ) : (
                    <>
                      <Ban className="h-4 w-4" />
                      Block User
                    </>
                  )}
                </Button>

                <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => handleDeleteUser(selectedUser)}
                    className="gap-1.5"
                  >
                    <Trash2 className="h-4 w-4" />
                    Deactivate User
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setViewDetailsOpen(false)}>
                    Close
                  </Button>
                </div>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ─────────────────────────────────────────────────────────────
          2. Reset / Set New Password Modal
      ───────────────────────────────────────────────────────────── */}
      <Dialog open={passwordModalOpen} onOpenChange={setPasswordModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="h-5 w-5 text-amber-500" />
              Set New Password
            </DialogTitle>
            <DialogDescription>
              Update or reset password for user{' '}
              <strong className="text-foreground">{userForPasswordReset?.name}</strong> ({userForPasswordReset?.id}).
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="new-pass">New Password</Label>
                <button
                  type="button"
                  onClick={generateRandomPassword}
                  className="text-xs text-primary hover:underline font-medium"
                >
                  Generate Strong Password
                </button>
              </div>
              <Input
                id="new-pass"
                type="text"
                placeholder="Enter new secure password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="font-mono text-sm"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="confirm-pass">Confirm Password</Label>
              <Input
                id="confirm-pass"
                type="text"
                placeholder="Confirm new password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="font-mono text-sm"
              />
            </div>

            <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-3 text-xs text-amber-700 dark:text-amber-300">
              New credentials will immediately be updated in PostgreSQL and synced to NextLink directory.
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setPasswordModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSavePassword} className="bg-primary text-primary-foreground gap-1.5">
              <KeyRound className="h-4 w-4" />
              Save New Password
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─────────────────────────────────────────────────────────────
          3. Add User Modal
      ───────────────────────────────────────────────────────────── */}
      <Dialog open={addUserOpen} onOpenChange={setAddUserOpen}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="h-5 w-5 text-primary" />
              Create New User Account
            </DialogTitle>
            <DialogDescription>
              Register a new user account with internet plan, credentials and security parameters.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateUser} className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Full Name *</Label>
                <Input
                  required
                  placeholder="e.g. Asif Mahmud"
                  value={newUserForm.name}
                  onChange={(e) => setNewUserForm({ ...newUserForm, name: e.target.value })}
                />
              </div>

              <div className="space-y-1.5">
                <Label>Username</Label>
                <Input
                  placeholder="e.g. asif2026"
                  value={newUserForm.username}
                  onChange={(e) => setNewUserForm({ ...newUserForm, username: e.target.value })}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Phone Number *</Label>
                <Input
                  required
                  placeholder="017XXXXXXXX"
                  value={newUserForm.phone}
                  onChange={(e) => setNewUserForm({ ...newUserForm, phone: e.target.value })}
                />
              </div>

              <div className="space-y-1.5">
                <Label>Email Address *</Label>
                <Input
                  required
                  type="email"
                  placeholder="asif@example.com"
                  value={newUserForm.email}
                  onChange={(e) => setNewUserForm({ ...newUserForm, email: e.target.value })}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Temporary Password</Label>
                {/* No password field — the API generates a one-time temporary
                    password and shows it to you once after creation. */}
                <div className="text-xs text-muted-foreground bg-muted/50 border rounded-lg px-3 py-2.5 leading-relaxed">
                  Auto-generated on save — you will see the one-time password once, right after the account is created.
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Internet Plan</Label>
                <Select
                  value={newUserForm.packageId || 'none'}
                  onValueChange={(val) =>
                    setNewUserForm({ ...newUserForm, packageId: val === 'none' ? '' : val })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select Plan" />
                  </SelectTrigger>
                  <SelectContent>
                    {/* No plan is valid: the account is created as a portal
                        account and becomes a subscriber when a plan is bought. */}
                    <SelectItem value="none">No plan yet (account only)</SelectItem>
                    {packages.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name} - ${p.price}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Installation Address</Label>
              <Input
                placeholder="House 12, Road 4, Sector 7, Uttara"
                value={newUserForm.address}
                onChange={(e) => setNewUserForm({ ...newUserForm, address: e.target.value })}
              />
            </div>

            {/* Security Simulation */}
            <div className="border rounded-xl p-3 bg-muted/30 space-y-2">
              <span className="text-xs font-semibold text-muted-foreground block">
                Security & Telemetry Flags (Optional simulation)
              </span>
              <div className="flex flex-wrap gap-4 text-xs">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={newUserForm.isVpn}
                    onChange={(e) => setNewUserForm({ ...newUserForm, isVpn: e.target.checked })}
                    className="rounded border-gray-300"
                  />
                  <span>Simulate VPN / Proxy</span>
                </label>

                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={newUserForm.isSpam}
                    onChange={(e) => setNewUserForm({ ...newUserForm, isSpam: e.target.checked })}
                    className="rounded border-gray-300"
                  />
                  <span>Simulate Spam Flag</span>
                </label>

                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={newUserForm.isScam}
                    onChange={(e) => setNewUserForm({ ...newUserForm, isScam: e.target.checked })}
                    className="rounded border-gray-300"
                  />
                  <span>Simulate Scam Threat</span>
                </label>
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAddUserOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" className="bg-primary text-primary-foreground" disabled={busyUser === 'creating'}>
                {busyUser === 'creating' ? 'Creating…' : 'Create User'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
