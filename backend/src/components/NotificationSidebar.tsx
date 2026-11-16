'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  Bell,
  X,
  Check,
  CheckCheck,
  MailOpen,
  Mail,
  Trash2,
  ExternalLink,
  AlertCircle,
  Receipt,
  Users,
  Ticket,
  Zap,
  Gift,
  RefreshCw,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { apiFetch, getApiToken } from '@/lib/apiClient';
import { useAuthStore } from '@/store/authStore';
import { useAdminDataStore } from '@/store/adminDataStore';

export interface NotificationRecord {
  id: string;
  userId: string;
  recipientType: string;
  roleTarget?: string | null;
  type: string;
  title: string;
  message: string;
  link?: string | null;
  isRead: boolean;
  createdAt: string;
}

interface NotificationSidebarProps {
  open: boolean;
  onClose: () => void;
  onUnreadCountChange?: (count: number) => void;
}

export function useNotificationPermission(): boolean {
  const { user } = useAuthStore();
  const roles = useAdminDataStore((s) => s.roles);
  if (!user) return false;
  if (user.role === 'super_admin') return true;
  const activeRole = roles.find((r: any) => r.key === user.role);
  if (!activeRole || !Array.isArray(activeRole.permissions) || activeRole.permissions.length === 0) {
    return true;
  }
  return activeRole.permissions.includes('notifications');
}

export function NotificationSidebar({
  open,
  onClose,
  onUnreadCountChange,
}: NotificationSidebarProps) {
  const router = useRouter();
  const { user } = useAuthStore();
  const hasPermission = useNotificationPermission();
  const [items, setItems] = useState<NotificationRecord[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const eventSourceRef = useRef<EventSource | null>(null);

  const adminHeaders = useCallback((): Record<string, string> => {
    const h: Record<string, string> = {};
    if (user?.role) h['x-admin-role'] = String(user.role);
    if (user?.id) h['x-admin-id'] = String(user.id);
    return h;
  }, [user?.role, user?.id]);

  const fetchNotifications = useCallback(async (silent = false) => {
    if (!hasPermission || !user) {
      setItems([]);
      setUnreadCount(0);
      setLoading(false);
      return;
    }
    if (!silent) setLoading(true);
    try {
      const res = await apiFetch('/api/notifications?limit=100', {
        headers: adminHeaders(),
      });
      if (res.success && Array.isArray(res.notifications)) {
        setItems(res.notifications);
        const count = Number(res.unreadCount ?? res.notifications.filter((n: NotificationRecord) => !n.isRead).length);
        setUnreadCount(count);
        onUnreadCountChange?.(count);
      }
    } catch {
      // ignore transient errors during background polling
    } finally {
      if (!silent) setLoading(false);
    }
  }, [hasPermission, user, adminHeaders, onUnreadCountChange]);

  useEffect(() => {
    fetchNotifications(false);
    const interval = setInterval(() => {
      fetchNotifications(true);
    }, 4000);
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  // Connect to SSE stream for instant push delivery when available
  useEffect(() => {
    if (!hasPermission || !user) return;
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') return;
    const token = getApiToken();
    const qs = new URLSearchParams();
    if (token) qs.set('token', token);
    if (user.role) qs.set('adminRole', String(user.role));
    if (user.id) qs.set('adminId', String(user.id));

    try {
      const es = new EventSource(`/api/notifications/stream?${qs.toString()}`);
      eventSourceRef.current = es;
      es.onmessage = (evt) => {
        try {
          const payload = JSON.parse(evt.data);
          if (payload?.event) {
            fetchNotifications(true);
          }
        } catch {
          // ignore malformed event
        }
      };
      es.onerror = () => {
        es.close();
      };
      return () => {
        es.close();
      };
    } catch {
      return undefined;
    }
  }, [hasPermission, user, fetchNotifications]);

  const handleToggleRead = async (item: NotificationRecord, targetRead: boolean) => {
    setBusyId(item.id);
    try {
      const res = await apiFetch(`/api/notifications/${encodeURIComponent(item.id)}/read`, {
        method: 'PATCH',
        headers: adminHeaders(),
        body: JSON.stringify({ isRead: targetRead }),
      });
      if (res.success) {
        setItems((prev) =>
          prev.map((n) => (n.id === item.id ? { ...n, isRead: targetRead } : n)),
        );
        const nextUnread = Number(
          res.unreadCount ??
            items.map((n) => (n.id === item.id ? { ...n, isRead: targetRead } : n)).filter((n) => !n.isRead).length,
        );
        setUnreadCount(nextUnread);
        onUnreadCountChange?.(nextUnread);
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
        const nextUnread = Number(res.unreadCount ?? remaining.filter((n) => !n.isRead).length);
        setUnreadCount(nextUnread);
        onUnreadCountChange?.(nextUnread);
        toast.success('Notification deleted');
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
        onUnreadCountChange?.(0);
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
        onUnreadCountChange?.(0);
        toast.success('All notifications cleared');
      } else {
        toast.error(res.error || 'Could not clear notifications');
      }
    } finally {
      setBusyId(null);
    }
  };

  const handleOpenLink = async (item: NotificationRecord) => {
    if (!item.isRead) {
      await handleToggleRead(item, true);
    }
    onClose();
    if (item.link) {
      router.push(item.link);
    }
  };

  const renderIcon = (type: string) => {
    const t = String(type || '').toLowerCase();
    if (t.includes('ticket') || t.includes('technician')) {
      return (
        <div className="h-8 w-8 rounded-full bg-amber-500/10 text-amber-600 flex items-center justify-center shrink-0">
          <Ticket className="h-4 w-4" />
        </div>
      );
    }
    if (t.includes('payment') || t.includes('invoice') || t.includes('late_fee')) {
      return (
        <div className="h-8 w-8 rounded-full bg-rose-500/10 text-rose-600 flex items-center justify-center shrink-0">
          <Receipt className="h-4 w-4" />
        </div>
      );
    }
    if (t.includes('user') || t.includes('register')) {
      return (
        <div className="h-8 w-8 rounded-full bg-emerald-500/10 text-emerald-600 flex items-center justify-center shrink-0">
          <Users className="h-4 w-4" />
        </div>
      );
    }
    if (t.includes('boost')) {
      return (
        <div className="h-8 w-8 rounded-full bg-purple-500/10 text-purple-600 flex items-center justify-center shrink-0">
          <Zap className="h-4 w-4" />
        </div>
      );
    }
    if (t.includes('referral')) {
      return (
        <div className="h-8 w-8 rounded-full bg-blue-500/10 text-blue-600 flex items-center justify-center shrink-0">
          <Gift className="h-4 w-4" />
        </div>
      );
    }
    return (
      <div className="h-8 w-8 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
        <AlertCircle className="h-4 w-4" />
      </div>
    );
  };

  const displayedItems = filter === 'unread' ? items.filter((i) => !i.isRead) : items;

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-xs transition-opacity"
        onClick={onClose}
      />

      {/* Slide-in Sidebar Panel */}
      <aside
        aria-label="Notifications Sidebar"
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l bg-card text-card-foreground shadow-2xl animate-in slide-in-from-right duration-200"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b px-5 py-4 bg-muted/30">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Bell className="h-4 w-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold leading-none">Notifications</h2>
                {unreadCount > 0 && (
                  <Badge className="bg-rose-600 text-white text-[10px] px-1.5 py-0 h-4 font-bold">
                    {unreadCount} unread
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Real-time operational & billing events
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => fetchNotifications(false)}
              title="Refresh notifications"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={onClose}
              title="Close notifications"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Filter & Bulk Actions Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-5 py-2.5 bg-background text-xs">
          <div className="flex items-center gap-1 rounded-lg bg-muted p-0.5">
            <button
              type="button"
              onClick={() => setFilter('all')}
              className={`px-2.5 py-1 rounded-md font-semibold transition-colors ${
                filter === 'all' ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground'
              }`}
            >
              All ({items.length})
            </button>
            <button
              type="button"
              onClick={() => setFilter('unread')}
              className={`px-2.5 py-1 rounded-md font-semibold transition-colors ${
                filter === 'unread' ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground'
              }`}
            >
              Unread ({unreadCount})
            </button>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={unreadCount === 0 || busyId === 'mark-all'}
              onClick={handleMarkAllRead}
              className="h-7 px-2.5 text-xs gap-1"
            >
              <CheckCheck className="h-3.5 w-3.5" />
              Mark all as read
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={items.length === 0 || busyId === 'clear-all'}
              onClick={handleClearAll}
              className="h-7 px-2.5 text-xs gap-1 text-rose-600 border-rose-200 hover:bg-rose-50 dark:hover:bg-rose-950/30"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Clear all
            </Button>
          </div>
        </div>

        {/* Notification List */}
        <div className="flex-1 overflow-y-auto divide-y">
          {!hasPermission ? (
            <div className="p-8 text-center space-y-2">
              <AlertCircle className="h-8 w-8 mx-auto text-amber-500" />
              <p className="text-sm font-semibold">Access Restricted</p>
              <p className="text-xs text-muted-foreground">
                Your current role does not have permission to view notifications.
              </p>
            </div>
          ) : loading && items.length === 0 ? (
            <div className="p-5 space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="animate-pulse flex gap-3 p-3 rounded-xl border">
                  <div className="h-8 w-8 rounded-full bg-muted shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3.5 w-2/3 bg-muted rounded" />
                    <div className="h-3 w-full bg-muted rounded" />
                  </div>
                </div>
              ))}
            </div>
          ) : displayedItems.length === 0 ? (
            <div className="p-10 text-center space-y-2">
              <Bell className="h-9 w-9 mx-auto text-muted-foreground/40" />
              <p className="text-sm font-semibold text-muted-foreground">
                {filter === 'unread' ? 'No unread notifications' : 'No notifications'}
              </p>
              <p className="text-xs text-muted-foreground">
                New tickets, user signups, and payment alerts will appear here in real time.
              </p>
            </div>
          ) : (
            displayedItems.map((item) => (
              <div
                key={item.id}
                className={`p-4 transition-colors hover:bg-muted/40 ${
                  !item.isRead ? 'bg-primary/5 border-l-2 border-l-primary' : ''
                }`}
              >
                <div className="flex items-start gap-3">
                  {renderIcon(item.type)}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <p
                        className={`text-sm leading-snug ${
                          !item.isRead ? 'font-bold text-foreground' : 'font-medium text-muted-foreground'
                        }`}
                      >
                        {item.title}
                      </p>
                      <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                        {item.createdAt
                          ? new Date(item.createdAt).toLocaleString('en-GB', {
                              day: '2-digit',
                              month: 'short',
                              hour: '2-digit',
                              minute: '2-digit',
                            })
                          : ''}
                      </span>
                    </div>

                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                      {item.message}
                    </p>

                    {/* Per-Notification Actions: Mark Read / Unread, Open Link, Delete */}
                    <div className="flex flex-wrap items-center gap-2 mt-3 pt-2 border-t border-border/50">
                      {item.link && (
                        <button
                          type="button"
                          onClick={() => handleOpenLink(item)}
                          className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline"
                        >
                          <ExternalLink className="h-3 w-3" />
                          Open Link
                        </button>
                      )}

                      {!item.isRead ? (
                        <button
                          type="button"
                          disabled={busyId === item.id}
                          onClick={() => handleToggleRead(item, true)}
                          className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 hover:underline"
                        >
                          <MailOpen className="h-3 w-3" />
                          Mark as Read
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={busyId === item.id}
                          onClick={() => handleToggleRead(item, false)}
                          className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-600 hover:underline"
                        >
                          <Mail className="h-3 w-3" />
                          Mark as Unread
                        </button>
                      )}

                      <button
                        type="button"
                        disabled={busyId === item.id}
                        onClick={() => handleDelete(item.id)}
                        className="inline-flex items-center gap-1 text-[11px] font-medium text-rose-600 hover:underline ml-auto"
                      >
                        <Trash2 className="h-3 w-3" />
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </aside>
    </div>
  );
}
