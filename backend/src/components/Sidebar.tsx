'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Wifi,
  ChevronLeft,
  ChevronRight,
  X,
  LogOut,
  Shield,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/authStore';
import {
  ADMIN_NAV_ITEMS,
  isNavItemActive,
  getPersistedActiveHref,
  setPersistedActiveHref,
  getPersistedSidebarCollapsed,
  setPersistedSidebarCollapsed,
  NavItemConfig,
} from '@/lib/navigation';

interface SidebarProps {
  mobileOpen: boolean;
  onMobileClose: () => void;
  onOpenNotifications?: () => void;
  unreadCount?: number;
}

export function Sidebar({
  mobileOpen,
  onMobileClose,
  onOpenNotifications,
  unreadCount = 0,
}: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [persistedActive, setPersistedActive] = useState<string | null>(null);
  const pathname = usePathname();
  const { user, logout } = useAuthStore();

  // Load and sync collapsed state from localStorage across page reloads
  useEffect(() => {
    const savedCollapsed = getPersistedSidebarCollapsed();
    setCollapsed(savedCollapsed);

    const savedHref = getPersistedActiveHref();
    if (savedHref) {
      setPersistedActive(savedHref);
    }
  }, []);

  // Persist current active route to localStorage across page reloads
  useEffect(() => {
    if (pathname) {
      setPersistedActiveHref(pathname);
      setPersistedActive(pathname);
    }
  }, [pathname]);

  const handleToggleCollapse = () => {
    const next = !collapsed;
    setCollapsed(next);
    setPersistedSidebarCollapsed(next);
  };

  const sidebarContent = (
    <div className="flex h-full flex-col">
      {/* Brand Header */}
      <div
        className={cn(
          'flex items-center gap-3 border-b px-4 py-4 shrink-0 transition-all',
          collapsed && 'justify-center px-2'
        )}
      >
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm shrink-0">
          <Wifi className="h-5 w-5" />
        </div>
        {!collapsed && (
          <div className="min-w-0 flex-1">
            <span className="font-extrabold text-base tracking-tight leading-none text-foreground block truncate">
              NextLink
            </span>
            <p className="text-[11px] text-muted-foreground font-medium mt-0.5 truncate">
              ISP Admin Console
            </p>
          </div>
        )}
      </div>

      {/* Nav List: Permanently displays all 21 modules without ever disappearing */}
      <nav
        aria-label="Admin Navigation"
        className="flex-1 overflow-y-auto py-3 px-2 scrollbar-thin scrollbar-thumb-muted-foreground/20"
      >
        <ul className="space-y-1">
          {ADMIN_NAV_ITEMS.map((item: NavItemConfig, index: number) => {
            const Icon = item.icon;
            const isCurrentActive = isNavItemActive(pathname, item);
            const isPersistedActive =
              !isCurrentActive &&
              persistedActive !== null &&
              isNavItemActive(persistedActive, item);
            const isActive = isCurrentActive || isPersistedActive;
            const isNotifications = item.key === 'notifications';

            return (
              <li key={item.key}>
                <Link
                  href={item.href}
                  onClick={() => {
                    onMobileClose();
                    setPersistedActiveHref(item.href);
                    setPersistedActive(item.href);
                    if (isNotifications && onOpenNotifications) {
                      // Also optionally ping notification drawer
                      onOpenNotifications();
                    }
                  }}
                  title={collapsed ? `${index + 1}. ${item.label}` : item.description}
                  className={cn(
                    'group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-150',
                    isActive
                      ? 'bg-primary text-primary-foreground shadow-xs'
                      : 'text-muted-foreground hover:bg-accent/80 hover:text-foreground',
                    collapsed && 'justify-center px-2'
                  )}
                >
                  <div className="relative shrink-0 flex items-center justify-center">
                    <Icon className="h-4.5 w-4.5 transition-transform group-hover:scale-105" />
                    {/* Collapsed notification badge */}
                    {isNotifications && collapsed && unreadCount > 0 && (
                      <span className="absolute -top-1.5 -right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[9px] font-bold text-white shadow-xs">
                        {unreadCount > 99 ? '99+' : unreadCount}
                      </span>
                    )}
                  </div>

                  {!collapsed && (
                    <div className="flex flex-1 items-center justify-between min-w-0">
                      <span className="truncate">{item.label}</span>
                      {isNotifications && unreadCount > 0 && (
                        <span className="ml-2 inline-flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-red-600 px-1.5 text-[10px] font-bold text-white shadow-xs">
                          {unreadCount > 99 ? '99+' : unreadCount}
                        </span>
                      )}
                    </div>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Administrator User Info & Session Controls */}
      <div className={cn('border-t p-3 shrink-0 bg-muted/20', collapsed && 'px-2')}>
        {!collapsed && user && (
          <Link
            href="/profile"
            onClick={onMobileClose}
            className="block mb-2 p-2 rounded-lg hover:bg-accent transition-colors"
            title="View Admin Profile & Roles"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary shrink-0">
                <Shield className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-foreground truncate">
                  {user.name}
                </p>
                <p className="text-[10px] text-muted-foreground capitalize font-medium truncate">
                  {user.role?.replace('_', ' ') || 'Administrator'}
                </p>
              </div>
            </div>
          </Link>
        )}

        <button
          type="button"
          onClick={() => {
            onMobileClose();
            logout();
          }}
          title={collapsed ? 'Logout Session' : undefined}
          className={cn(
            'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors',
            collapsed && 'justify-center px-2'
          )}
        >
          <LogOut className="h-4 w-4 shrink-0" />
          {!collapsed && <span>Logout</span>}
        </button>
      </div>

      {/* Collapse/Expand Toggle Button (Desktop) */}
      <button
        type="button"
        onClick={handleToggleCollapse}
        aria-label={collapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
        className="absolute -right-3 top-16 hidden md:flex h-6 w-6 items-center justify-center rounded-full border bg-background shadow-md hover:bg-accent transition-colors z-20"
      >
        {collapsed ? (
          <ChevronRight className="h-3.5 w-3.5" />
        ) : (
          <ChevronLeft className="h-3.5 w-3.5" />
        )}
      </button>
    </div>
  );

  return (
    <>
      {/* Desktop Sidebar */}
      <aside
        className={cn(
          'relative hidden md:flex flex-col h-full border-r bg-card transition-all duration-200 ease-in-out shrink-0 select-none',
          collapsed ? 'w-16' : 'w-64'
        )}
      >
        {sidebarContent}
      </aside>

      {/* Mobile Drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden animate-in fade-in duration-200">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-xs"
            onClick={onMobileClose}
          />
          <aside className="absolute left-0 top-0 h-full w-64 bg-card border-r shadow-2xl animate-in slide-in-from-left duration-200">
            <button
              type="button"
              onClick={onMobileClose}
              aria-label="Close menu"
              className="absolute right-3 top-3 p-1 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground z-10"
            >
              <X className="h-5 w-5" />
            </button>
            {sidebarContent}
          </aside>
        </div>
      )}
    </>
  );
}
