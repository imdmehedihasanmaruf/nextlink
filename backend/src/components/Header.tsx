'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { 
  Menu, 
  Bell, 
  Sun, 
  Moon, 
  Settings, 
  Check, 
  AlertCircle, 
  Receipt, 
  Users, 
  X,
  ExternalLink
} from 'lucide-react';
import { useTheme } from 'next-themes';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useAuthStore } from '@/store/authStore';
import { useAdminDataStore } from '@/store/adminDataStore';

interface HeaderProps {
  onMobileMenuOpen: () => void;
  title?: string;
}

interface NotificationItem {
  id: string;
  title: string;
  message: string;
  time: string;
  type: 'ticket' | 'billing' | 'system' | 'subscriber';
  link: string;
  read: boolean;
}

export function Header({ onMobileMenuOpen, title }: HeaderProps) {
  const { resolvedTheme, setTheme } = useTheme();
  const { user } = useAuthStore();
  const { tickets, invoices, subscribers } = useAdminDataStore();

  const [notifOpen, setNotifOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);

  // Real-time notifications derived from actual store data
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);

  useEffect(() => {
    const list: NotificationItem[] = [];
    tickets.filter(t => t.priority === 'high' || t.priority === 'critical').slice(0, 3).forEach(t => {
      list.push({
        id: `t-${t.id}`,
        title: `${t.priority.toUpperCase()} Ticket`,
        message: `${t.subscriberName}: ${t.subject}`,
        time: 'Active',
        type: 'ticket',
        link: '/tickets',
        read: false,
      });
    });
    invoices.filter(i => i.status === 'overdue').slice(0, 3).forEach(i => {
      list.push({
        id: `inv-${i.id}`,
        title: 'Overdue Invoice',
        message: `${i.subscriberName} owes $${i.amount}`,
        time: 'Due',
        type: 'billing',
        link: '/billing',
        read: false,
      });
    });
    setNotifications(list);
  }, [tickets, invoices]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (notifRef.current && !notifRef.current.contains(event.target as Node)) {
        setNotifOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const unreadCount = notifications.filter(n => !n.read).length;

  const markAllAsRead = () => {
    setNotifications(notifications.map(n => ({ ...n, read: true })));
  };

  const markAsRead = (id: string) => {
    setNotifications(notifications.map(n => n.id === id ? { ...n, read: true } : n));
  };

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b bg-background/95 backdrop-blur px-4 md:px-6 gap-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="md:hidden" onClick={onMobileMenuOpen}>
          <Menu className="h-5 w-5" />
        </Button>
        {title && <h1 className="text-lg font-semibold hidden sm:block">{title}</h1>}
      </div>

      <div className="flex items-center gap-2">
        {/* Dark/Light Mode Toggle */}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
          title={resolvedTheme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {resolvedTheme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
        </Button>

        {/* Settings Button (Requirement 30) */}
        <Link href="/settings">
          <Button variant="ghost" size="icon" title="System Settings">
            <Settings className="h-5 w-5" />
          </Button>
        </Link>

        {/* Notifications Popover (Requirement 30) */}
        <div className="relative" ref={notifRef}>
          <Button 
            variant="ghost" 
            size="icon" 
            className="relative" 
            title="Notifications"
            onClick={() => setNotifOpen(!notifOpen)}
          >
            <Bell className="h-5 w-5" />
            {unreadCount > 0 && (
              <span className="absolute 1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-600 text-[9px] font-bold text-white shadow">
                {unreadCount}
              </span>
            )}
          </Button>

          {notifOpen && (
            <div className="absolute right-0 mt-2 w-80 sm:w-96 rounded-2xl border bg-card p-0 shadow-2xl z-50 animate-in fade-in slide-in-from-top-2 overflow-hidden">
              <div className="flex items-center justify-between border-b p-4 bg-muted/30">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-bold">Notifications</h3>
                  {unreadCount > 0 && (
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 font-bold">
                      {unreadCount} new
                    </Badge>
                  )}
                </div>
                {unreadCount > 0 && (
                  <button 
                    onClick={markAllAsRead}
                    className="text-xs text-primary hover:underline font-semibold flex items-center gap-1"
                  >
                    <Check className="h-3 w-3" /> Mark all read
                  </button>
                )}
              </div>

              <div className="max-h-84 overflow-y-auto divide-y text-xs">
                {notifications.length > 0 ? (
                  notifications.map((item) => (
                    <Link
                      key={item.id}
                      href={item.link}
                      onClick={() => {
                        markAsRead(item.id);
                        setNotifOpen(false);
                      }}
                      className={`flex items-start gap-3 p-3.5 hover:bg-muted/50 transition-colors block ${
                        !item.read ? 'bg-primary/5' : ''
                      }`}
                    >
                      <div className="mt-0.5 shrink-0">
                        {item.type === 'ticket' && (
                          <div className="h-7 w-7 rounded-full bg-orange-500/10 text-orange-600 flex items-center justify-center">
                            <AlertCircle className="h-4 w-4" />
                          </div>
                        )}
                        {item.type === 'billing' && (
                          <div className="h-7 w-7 rounded-full bg-red-500/10 text-red-600 flex items-center justify-center">
                            <Receipt className="h-4 w-4" />
                          </div>
                        )}
                        {item.type === 'subscriber' && (
                          <div className="h-7 w-7 rounded-full bg-emerald-500/10 text-emerald-600 flex items-center justify-center">
                            <Users className="h-4 w-4" />
                          </div>
                        )}
                        {item.type === 'system' && (
                          <div className="h-7 w-7 rounded-full bg-blue-500/10 text-blue-600 flex items-center justify-center">
                            <Check className="h-4 w-4" />
                          </div>
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-1">
                          <p className={`font-semibold truncate ${!item.read ? 'text-foreground' : 'text-muted-foreground'}`}>
                            {item.title}
                          </p>
                          <span className="text-[10px] text-muted-foreground shrink-0">{item.time}</span>
                        </div>
                        <p className="text-muted-foreground text-[11px] mt-0.5 line-clamp-2">
                          {item.message}
                        </p>
                      </div>
                    </Link>
                  ))
                ) : (
                  <div className="py-8 text-center text-muted-foreground text-xs">
                    No active notifications
                  </div>
                )}
              </div>

              <div className="p-2 border-t bg-muted/20 text-center">
                <Link 
                  href="/tickets" 
                  onClick={() => setNotifOpen(false)}
                  className="text-xs font-semibold text-primary hover:underline inline-flex items-center gap-1"
                >
                  View All Operational Alerts <ExternalLink className="h-3 w-3" />
                </Link>
              </div>
            </div>
          )}
        </div>

        {/* Clickable Profile Button (Requirement 23) */}
        {user && (
          <Link href="/profile">
            <div className="flex items-center gap-2 rounded-lg border px-3 py-1.5 hover:bg-muted/80 transition-colors cursor-pointer" title="View / Edit Admin Profile">
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-white">
                {user.name.charAt(0)}
              </div>
              <div className="hidden sm:block text-left">
                <p className="text-sm font-medium leading-none">{user.name}</p>
                <p className="text-xs text-muted-foreground capitalize">{user.role.replace('_', ' ')}</p>
              </div>
            </div>
          </Link>
        )}
      </div>
    </header>
  );
}
