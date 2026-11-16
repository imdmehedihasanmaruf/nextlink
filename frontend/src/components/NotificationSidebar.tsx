'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import {
  Bell,
  X,
  CheckCheck,
  MailOpen,
  Mail,
  Trash2,
  ExternalLink,
  AlertCircle,
  Receipt,
  Ticket,
  Zap,
  Gift,
  RefreshCw,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useAuthStore } from '@/store/authStore'
import { getSubscriberToken } from '@/lib/portalApi'

export interface SubscriberNotification {
  id: string
  userId: string
  recipientType: string
  type: string
  title: string
  message: string
  link?: string | null
  isRead: boolean
  createdAt: string
}

interface NotificationSidebarProps {
  open: boolean
  onClose: () => void
  onUnreadCountChange?: (count: number) => void
}

export function NotificationSidebar({
  open,
  onClose,
  onUnreadCountChange,
}: NotificationSidebarProps) {
  const router = useRouter()
  const { user, isAuthenticated } = useAuthStore()
  const [items, setItems] = useState<SubscriberNotification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'unread'>('all')
  const eventSourceRef = useRef<EventSource | null>(null)

  const buildHeaders = useCallback((): Record<string, string> => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    const token = getSubscriberToken()
    if (token) headers.Authorization = `Bearer ${token}`
    if (user?.id) headers['x-subscriber-id'] = String(user.id)
    return headers
  }, [user?.id])

  const fetchNotifications = useCallback(
    async (silent = false) => {
      if (!isAuthenticated || !user?.id) {
        setItems([])
        setUnreadCount(0)
        setLoading(false)
        return
      }
      if (!silent) setLoading(true)
      try {
        const res = await fetch(
          `/api/notifications?limit=80&subscriberId=${encodeURIComponent(user.id)}`,
          {
            method: 'GET',
            headers: buildHeaders(),
          },
        )
        const payload = await res.json().catch(() => ({}))
        if (payload?.success && Array.isArray(payload.notifications)) {
          setItems(payload.notifications)
          const count = Number(
            payload.unreadCount ??
              payload.notifications.filter((n: SubscriberNotification) => !n.isRead).length,
          )
          setUnreadCount(count)
          onUnreadCountChange?.(count)
        }
      } catch {
        // ignore transient errors during polling
      } finally {
        if (!silent) setLoading(false)
      }
    },
    [isAuthenticated, user?.id, buildHeaders, onUnreadCountChange],
  )

  useEffect(() => {
    fetchNotifications(false)
    const interval = setInterval(() => {
      fetchNotifications(true)
    }, 4000)
    return () => clearInterval(interval)
  }, [fetchNotifications])

  // Real-time SSE subscription
  useEffect(() => {
    if (!isAuthenticated || !user?.id) return
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') return
    const token = getSubscriberToken()
    const qs = new URLSearchParams({ subscriberId: String(user.id) })
    if (token) qs.set('token', token)

    try {
      const es = new EventSource(`/api/notifications/stream?${qs.toString()}`)
      eventSourceRef.current = es
      es.onmessage = (evt) => {
        try {
          const data = JSON.parse(evt.data)
          if (data?.event) {
            fetchNotifications(true)
          }
        } catch {
          // ignore
        }
      }
      es.onerror = () => {
        es.close()
      }
      return () => {
        es.close()
      }
    } catch {
      return undefined
    }
  }, [isAuthenticated, user?.id, fetchNotifications])

  const handleToggleRead = async (item: SubscriberNotification, targetRead: boolean) => {
    setBusyId(item.id)
    try {
      const res = await fetch(`/api/notifications/${encodeURIComponent(item.id)}/read`, {
        method: 'PATCH',
        headers: buildHeaders(),
        body: JSON.stringify({ isRead: targetRead }),
      })
      const payload = await res.json().catch(() => ({}))
      if (payload?.success) {
        const nextList = items.map((n) => (n.id === item.id ? { ...n, isRead: targetRead } : n))
        setItems(nextList)
        const nextUnread = nextList.filter((n) => !n.isRead).length
        setUnreadCount(nextUnread)
        onUnreadCountChange?.(nextUnread)
      }
    } finally {
      setBusyId(null)
    }
  }

  const handleDelete = async (id: string) => {
    setBusyId(id)
    try {
      const res = await fetch(`/api/notifications/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: buildHeaders(),
      })
      const payload = await res.json().catch(() => ({}))
      if (payload?.success) {
        const nextList = items.filter((n) => n.id !== id)
        setItems(nextList)
        const nextUnread = nextList.filter((n) => !n.isRead).length
        setUnreadCount(nextUnread)
        onUnreadCountChange?.(nextUnread)
      }
    } finally {
      setBusyId(null)
    }
  }

  const handleMarkAllRead = async () => {
    setBusyId('mark-all')
    try {
      const res = await fetch('/api/notifications/mark-all-read', {
        method: 'POST',
        headers: buildHeaders(),
      })
      const payload = await res.json().catch(() => ({}))
      if (payload?.success) {
        setItems((prev) => prev.map((n) => ({ ...n, isRead: true })))
        setUnreadCount(0)
        onUnreadCountChange?.(0)
      }
    } finally {
      setBusyId(null)
    }
  }

  const handleClearAll = async () => {
    setBusyId('clear-all')
    try {
      const res = await fetch('/api/notifications', {
        method: 'DELETE',
        headers: buildHeaders(),
      })
      const payload = await res.json().catch(() => ({}))
      if (payload?.success) {
        setItems([])
        setUnreadCount(0)
        onUnreadCountChange?.(0)
      }
    } finally {
      setBusyId(null)
    }
  }

  const handleOpenLink = async (item: SubscriberNotification) => {
    if (!item.isRead) {
      await handleToggleRead(item, true)
    }
    onClose()
    if (item.link) {
      router.push(item.link)
    }
  }

  const renderIcon = (type: string) => {
    const t = String(type || '').toLowerCase()
    if (t.includes('ticket') || t.includes('technician')) {
      return (
        <div className="h-8 w-8 rounded-full bg-amber-500/10 text-amber-600 flex items-center justify-center shrink-0">
          <Ticket size={16} />
        </div>
      )
    }
    if (t.includes('payment') || t.includes('invoice') || t.includes('late_fee')) {
      return (
        <div className="h-8 w-8 rounded-full bg-rose-500/10 text-rose-600 flex items-center justify-center shrink-0">
          <Receipt size={16} />
        </div>
      )
    }
    if (t.includes('boost')) {
      return (
        <div className="h-8 w-8 rounded-full bg-purple-500/10 text-purple-600 flex items-center justify-center shrink-0">
          <Zap size={16} />
        </div>
      )
    }
    if (t.includes('referral')) {
      return (
        <div className="h-8 w-8 rounded-full bg-emerald-500/10 text-emerald-600 flex items-center justify-center shrink-0">
          <Gift size={16} />
        </div>
      )
    }
    return (
      <div className="h-8 w-8 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
        <AlertCircle size={16} />
      </div>
    )
  }

  const displayedItems = filter === 'unread' ? items.filter((i) => !i.isRead) : items

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-xs transition-opacity"
        onClick={onClose}
      />

      {/* Slide-in Sidebar Panel */}
      <aside
        aria-label="Subscriber Notifications Sidebar"
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l bg-card text-card-foreground shadow-2xl animate-in slide-in-from-right duration-200"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b px-5 py-4 bg-muted/30">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Bell size={16} />
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
                Live billing, support &amp; network alerts
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => fetchNotifications(false)}
              title="Refresh notifications"
            >
              <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={onClose}
              title="Close notifications"
            >
              <X size={16} />
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
              <CheckCheck size={13} />
              Mark all as read
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={items.length === 0 || busyId === 'clear-all'}
              onClick={handleClearAll}
              className="h-7 px-2.5 text-xs gap-1 text-rose-600 border-rose-200 hover:bg-rose-50 dark:hover:bg-rose-950/30"
            >
              <Trash2 size={13} />
              Clear all
            </Button>
          </div>
        </div>

        {/* Notification List */}
        <div className="flex-1 overflow-y-auto divide-y">
          {loading && items.length === 0 ? (
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
              <Bell size={34} className="mx-auto text-muted-foreground/40" />
              <p className="text-sm font-semibold text-muted-foreground">
                {filter === 'unread' ? 'No unread notifications' : 'No notifications'}
              </p>
              <p className="text-xs text-muted-foreground">
                Invoices, payment receipts, ticket replies, and Turbo Boost alerts will appear here in real time.
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

                    <div className="flex flex-wrap items-center gap-2 mt-3 pt-2 border-t border-border/50">
                      {item.link && (
                        <button
                          type="button"
                          onClick={() => handleOpenLink(item)}
                          className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline"
                        >
                          <ExternalLink size={12} />
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
                          <MailOpen size={12} />
                          Mark as Read
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={busyId === item.id}
                          onClick={() => handleToggleRead(item, false)}
                          className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-600 hover:underline"
                        >
                          <Mail size={12} />
                          Mark as Unread
                        </button>
                      )}

                      <button
                        type="button"
                        disabled={busyId === item.id}
                        onClick={() => handleDelete(item.id)}
                        className="inline-flex items-center gap-1 text-[11px] font-medium text-rose-600 hover:underline ml-auto"
                      >
                        <Trash2 size={12} />
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
  )
}

