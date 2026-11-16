'use client';

import Link from 'next/link';
import { Menu, Bell, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/store/authStore';
import { useNotificationPermission } from '@/components/NotificationSidebar';

interface HeaderProps {
  onMobileMenuOpen: () => void;
  onOpenNotifications?: () => void;
  unreadCount?: number;
  title?: string;
}

export function Header({
  onMobileMenuOpen,
  onOpenNotifications,
  unreadCount = 0,
  title,
}: HeaderProps) {
  const { user } = useAuthStore();
  const canViewNotifications = useNotificationPermission();

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b bg-background/95 backdrop-blur px-4 md:px-6 gap-4 shrink-0">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="md:hidden" onClick={onMobileMenuOpen}>
          <Menu className="h-5 w-5" />
        </Button>
        {title && <h1 className="text-lg font-semibold hidden sm:block">{title}</h1>}
      </div>

      <div className="flex items-center gap-2">
        {/* Settings Button */}
        <Link href="/settings">
          <Button variant="ghost" size="icon" title="System Settings">
            <Settings className="h-5 w-5" />
          </Button>
        </Link>

        {/* Notifications Bell -> Slide-in Sidebar (Requirement 13) */}
        {canViewNotifications && (
          <Button
            variant="ghost"
            size="icon"
            className="relative"
            title="Open Notifications Sidebar"
            aria-label="Notifications"
            onClick={onOpenNotifications}
          >
            <Bell className="h-5 w-5" />
            {unreadCount > 0 && (
              <span
                data-testid="header-notif-badge"
                className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[9px] font-bold text-white shadow"
              >
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </Button>
        )}

        {/* Clickable Profile Button */}
        {user && (
          <Link href="/profile">
            <div
              className="flex items-center gap-2 rounded-lg border px-3 py-1.5 hover:bg-muted/80 transition-colors cursor-pointer"
              title="View / Edit Admin Profile"
            >
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-white">
                {user.name.charAt(0)}
              </div>
              <div className="hidden sm:block text-left">
                <p className="text-sm font-medium leading-none">{user.name}</p>
                <p className="text-xs text-muted-foreground capitalize">
                  {user.role.replace('_', ' ')}
                </p>
              </div>
            </div>
          </Link>
        )}
      </div>
    </header>
  );
}
