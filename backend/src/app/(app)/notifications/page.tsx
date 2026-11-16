'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Bell,
  CheckCheck,
  Trash2,
  RefreshCw,
  MailOpen,
  Mail,
  ExternalLink,
  Receipt,
  Ticket,
  Users,
  Zap,
  Gift,
  AlertCircle,
  Search,
  Filter,
  CheckCircle2,
  Clock,
  ShieldAlert,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { apiFetch } from '@/lib/apiClient';
import { useAuthStore } from '@/store/authStore';

export interface NotificationItem {
  id: string;
  userId?: string;
  recipientType?: string;
  roleTarget?: string | null;
  type: string;
  title: string;
  message: string;
  link?: string | null;
  isRead: boolean;
  createdAt: string;
}

export default function NotificationsPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterTab, setFilterTab] = useState<'all' | 'unread' | 'billing' | 'tickets' | 'users' | 'boost'>('all');

  const adminHeaders = useCallback((): Record<string, string> => {
    const h: Record<string, string> = {};
    if (user?.role) h['x-admin-role'] = String(user.role);
    if (user?.id) h['x-admin-id'] = String(user.id);
    return h;
  }, [user?.role, user?.id]);

  const fetchNotifications = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await apiFetch('/api/notifications?limit=200', {
        headers: adminHeaders(),
      });
      if (res.success && Array.isArray(res.notifications)) {
        setItems(res.notifications);
        const count = Number(
          res.unreadCount ?? res.notifications.filter((n: NotificationItem) => !n.isRead).length
        );
        setUnreadCount(count);
      }
    } catch {
      // transient network error
    } finally {
      if (!silent) setLoading(false);
    }
  }, [adminHeaders]);

  useEffect(() => {
    fetchNotifications(false);
    const interval = setInterval(() => {
      fetchNotifications(true);
    }, 5000);
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  const handleToggleRead = async (item: NotificationItem, targetRead: boolean) => {
    setBusyId(item.id);
    try {
      const res = await apiFetch(`/api/notifications/${encodeURIComponent(item.id)}/read`, {
        method: 'PATCH',
        headers: adminHeaders(),
        body: JSON.stringify({ isRead: targetRead }),
      });
      if (res.success) {
        setItems((prev) =>
          prev.map((n) => (n.id === item.id ? { ...n, isRead: targetRead } : n))
        );
        const count = Number(
          res.unreadCount ??
            items.map((n) => (n.id === item.id ? { ...n, isRead: targetRead } : n)).filter((n) => !n.isRead).length
        );
        setUnreadCount(count);
      } else {
        toast.error(res.error || 'Could not update notification');
      }
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (id: string) => {
    setBusyId(id);
    try {
      const res = await apiFetch(`/api/notifications/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: adminHeaders(),
      });
      if (res.success) {
        const remaining = items.filter((n) => n.id !== id);
        setItems(remaining);
        const count = Number(res.unreadCount ?? remaining.filter((n) => !n.isRead).length);
        setUnreadCount(count);
        toast.success('Notification removed');
      } else {
        toast.error(res.error || 'Could not delete notification');
      }
    } finally {
      setBusyId(null);
    }
  };

  const handleMarkAllRead = async () => {
    setBusyId('mark-all');
    try {
      const res = await apiFetch('/api/notifications/mark-all-read', {
        method: 'POST',
        headers: adminHeaders(),
      });
      if (res.success) {
        setItems((prev) => prev.map((n) => ({ ...n, isRead: true })));
        setUnreadCount(0);
        toast.success('All notifications marked as read');
      } else {
        toast.error(res.error || 'Could not mark notifications as read');
      }
    } finally {
      setBusyId(null);
    }
  };

  const handleClearAll = async () => {
    setBusyId('clear-all');
    try {
      const res = await apiFetch('/api/notifications', {
        method: 'DELETE',
        headers: adminHeaders(),
      });
      if (res.success) {
        setItems([]);
        setUnreadCount(0);
        toast.success('All notifications cleared');
      } else {
        toast.error(res.error || 'Could not clear notifications');
      }
    } finally {
      setBusyId(null);
    }
  };

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      // Tab filter
      if (filterTab === 'unread' && item.isRead) return false;
      const type = (item.type || '').toLowerCase();
      if (filterTab === 'billing' && !type.includes('payment') && !type.includes('invoice')) return false;
      if (filterTab === 'tickets' && !type.includes('ticket') && !type.includes('technician')) return false;
      if (filterTab === 'users' && !type.includes('user') && !type.includes('register') && !type.includes('subscriber')) return false;
      if (filterTab === 'boost' && !type.includes('boost') && !type.includes('bandwidth') && !type.includes('latency')) return false;

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesTitle = (item.title || '').toLowerCase().includes(q);
        const matchesMsg = (item.message || '').toLowerCase().includes(q);
        const matchesType = type.includes(q);
        if (!matchesTitle && !matchesMsg && !matchesType) return false;
      }

      return true;
    });
  }, [items, filterTab, searchQuery]);

  const renderTypeIcon = (type: string) => {
    const t = String(type || '').toLowerCase();
    if (t.includes('ticket') || t.includes('technician')) {
      return (
        <div className="h-9 w-9 rounded-xl bg-amber-500/10 text-amber-600 flex items-center justify-center shrink-0">
          <Ticket className="h-5 w-5" />
        </div>
      );
    }
    if (t.includes('payment') || t.includes('invoice') || t.includes('billing')) {
      return (
        <div className="h-9 w-9 rounded-xl bg-rose-500/10 text-rose-600 flex items-center justify-center shrink-0">
          <Receipt className="h-5 w-5" />
        </div>
      );
    }
    if (t.includes('user') || t.includes('register') || t.includes('subscriber')) {
      return (
        <div className="h-9 w-9 rounded-xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center shrink-0">
          <Users className="h-5 w-5" />
        </div>
      );
    }
    if (t.includes('boost')) {
      return (
        <div className="h-9 w-9 rounded-xl bg-purple-500/10 text-purple-600 flex items-center justify-center shrink-0">
          <Zap className="h-5 w-5" />
        </div>
      );
    }
    if (t.includes('referral')) {
      return (
        <div className="h-9 w-9 rounded-xl bg-blue-500/10 text-blue-600 flex items-center justify-center shrink-0">
          <Gift className="h-5 w-5" />
        </div>
      );
    }
    return (
      <div className="h-9 w-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
        <AlertCircle className="h-5 w-5" />
      </div>
    );
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-12">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b pb-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Bell className="h-5 w-5" />
            </div>
            <h1 className="text-2xl font-black tracking-tight text-foreground">
              Notifications & System Alerts
            </h1>
            {unreadCount > 0 && (
              <Badge className="bg-red-600 text-white font-bold px-2 py-0.5 text-xs">
                {unreadCount} New
              </Badge>
            )}
          </div>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1">
            Real-time feed of subscriber signups, billing events, technician dispatches, and infrastructure alerts.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchNotifications(false)}
            disabled={loading}
            className="gap-1.5 shadow-xs"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={handleMarkAllRead}
            disabled={unreadCount === 0 || busyId === 'mark-all'}
            className="gap-1.5 shadow-xs"
          >
            <CheckCheck className="h-4 w-4 text-emerald-600" />
            <span>Mark All Read</span>
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={handleClearAll}
            disabled={items.length === 0 || busyId === 'clear-all'}
            className="gap-1.5 shadow-xs text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/20"
          >
            <Trash2 className="h-4 w-4" />
            <span>Clear All</span>
          </Button>
        </div>
      </div>

      {/* Stats Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card className="shadow-xs">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-muted-foreground">Total Alerts</p>
              <p className="text-2xl font-bold mt-0.5">{items.length}</p>
            </div>
            <div className="h-9 w-9 rounded-xl bg-muted flex items-center justify-center text-muted-foreground">
              <Bell className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-xs border-amber-200 dark:border-amber-900/40">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-amber-600 dark:text-amber-400">Unread</p>
              <p className="text-2xl font-bold text-amber-600 dark:text-amber-400 mt-0.5">{unreadCount}</p>
            </div>
            <div className="h-9 w-9 rounded-xl bg-amber-500/10 flex items-center justify-center text-amber-600">
              <Clock className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-xs">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-muted-foreground">Billing & Invoices</p>
              <p className="text-2xl font-bold mt-0.5">
                {items.filter((i) => (i.type || '').toLowerCase().includes('invoice') || (i.type || '').toLowerCase().includes('payment')).length}
              </p>
            </div>
            <div className="h-9 w-9 rounded-xl bg-rose-500/10 flex items-center justify-center text-rose-600">
              <Receipt className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-xs">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-muted-foreground">Support & Techs</p>
              <p className="text-2xl font-bold mt-0.5">
                {items.filter((i) => (i.type || '').toLowerCase().includes('ticket') || (i.type || '').toLowerCase().includes('tech')).length}
              </p>
            </div>
            <div className="h-9 w-9 rounded-xl bg-blue-500/10 flex items-center justify-center text-blue-600">
              <Ticket className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filter and Search Bar */}
      <Card className="shadow-xs">
        <CardContent className="p-3.5 space-y-3">
          <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
            {/* Filter Tabs */}
            <div className="flex flex-wrap items-center gap-1.5">
              {[
                { id: 'all', label: `All (${items.length})` },
                { id: 'unread', label: `Unread (${unreadCount})` },
                { id: 'billing', label: 'Billing' },
                { id: 'tickets', label: 'Tickets' },
                { id: 'users', label: 'Subscribers' },
                { id: 'boost', label: 'Turbo / Speed' },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setFilterTab(tab.id as any)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                    filterTab === tab.id
                      ? 'bg-primary text-primary-foreground shadow-xs'
                      : 'bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Search Input */}
            <div className="relative w-full md:w-64">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Search alerts..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 h-9 text-xs"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Notifications List */}
      <Card className="shadow-xs overflow-hidden">
        <CardContent className="p-0 divide-y">
          {loading && items.length === 0 ? (
            <div className="p-8 space-y-3">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="animate-pulse flex gap-3 p-4 rounded-xl border">
                  <div className="h-9 w-9 rounded-xl bg-muted shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 w-1/3 bg-muted rounded" />
                    <div className="h-3 w-3/4 bg-muted rounded" />
                  </div>
                </div>
              ))}
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="p-12 text-center space-y-3">
              <div className="h-12 w-12 rounded-full bg-muted/60 flex items-center justify-center mx-auto text-muted-foreground">
                <Bell className="h-6 w-6" />
              </div>
              <h3 className="text-base font-bold text-foreground">
                {filterTab === 'unread' ? 'No unread notifications' : 'No notifications found'}
              </h3>
              <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                {searchQuery
                  ? 'No notifications match your current search query.'
                  : 'New automated events, user registrations, and invoice receipts will be captured here.'}
              </p>
            </div>
          ) : (
            filteredItems.map((item) => (
              <div
                key={item.id}
                className={`p-4 sm:p-5 transition-colors hover:bg-muted/30 flex flex-col sm:flex-row sm:items-start justify-between gap-4 ${
                  !item.isRead ? 'bg-primary/5 border-l-4 border-l-primary' : ''
                }`}
              >
                <div className="flex items-start gap-3.5 flex-1 min-w-0">
                  {renderTypeIcon(item.type)}
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4
                        className={`text-sm ${
                          !item.isRead ? 'font-black text-foreground' : 'font-semibold text-foreground/80'
                        }`}
                      >
                        {item.title}
                      </h4>
                      {!item.isRead && (
                        <Badge className="bg-primary/20 text-primary text-[10px] px-1.5 py-0">
                          Unread
                        </Badge>
                      )}
                      <span className="text-[11px] text-muted-foreground font-mono ml-auto sm:ml-0">
                        {item.createdAt
                          ? new Date(item.createdAt).toLocaleString('en-US', {
                              month: 'short',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })
                          : ''}
                      </span>
                    </div>

                    <p className="text-xs sm:text-sm text-muted-foreground mt-1 leading-relaxed">
                      {item.message}
                    </p>

                    {item.link && (
                      <div className="mt-2.5">
                        <Link
                          href={item.link}
                          onClick={() => {
                            if (!item.isRead) handleToggleRead(item, true);
                          }}
                          className="inline-flex items-center gap-1.5 text-xs font-bold text-primary hover:underline"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          <span>View Details & Actions</span>
                        </Link>
                      </div>
                    )}
                  </div>
                </div>

                {/* Row Action Buttons */}
                <div className="flex items-center gap-1.5 self-end sm:self-center shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 w-full sm:w-auto justify-end">
                  {!item.isRead ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busyId === item.id}
                      onClick={() => handleToggleRead(item, true)}
                      className="h-8 text-xs gap-1 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/20"
                      title="Mark as Read"
                    >
                      <MailOpen className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">Mark Read</span>
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busyId === item.id}
                      onClick={() => handleToggleRead(item, false)}
                      className="h-8 text-xs gap-1 text-muted-foreground hover:text-foreground"
                      title="Mark as Unread"
                    >
                      <Mail className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">Mark Unread</span>
                    </Button>
                  )}

                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busyId === item.id}
                    onClick={() => handleDelete(item.id)}
                    className="h-8 text-xs gap-1 text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/20"
                    title="Delete Notification"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Delete</span>
                  </Button>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
