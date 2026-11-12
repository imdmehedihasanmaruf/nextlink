'use client';
import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, Users, Package, Receipt, Ticket, Wrench, BarChart3,
  Settings, Wifi, ChevronLeft, ChevronRight, X, LogOut, Shield, Globe, User,
  Gift, Zap, Radio, Activity, Network, PackageCheck, Bot, ClipboardList,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/authStore';
import { useAdminDataStore } from '@/store/adminDataStore';
import { useSettingsStore, useAdminTranslation } from '@/store/settingsStore';
import type { UserRole } from '@/lib/mockData';

interface NavItem {
  label: string;
  key: string;
  href: string;
  icon: React.ReactNode;
  roles: UserRole[];
  /** The permission key used by the role matrix to gate this item. */
  permission: string;
}

const navItems: NavItem[] = [
  { label: 'Dashboard', key: 'dashboard', href: '/dashboard', icon: <LayoutDashboard className="h-5 w-5" />, roles: ['super_admin', 'billing', 'support', 'technician', 'noc_operator'], permission: 'dashboard' },
  { label: 'Frontend CMS', key: 'cms', href: '/cms', icon: <Globe className="h-5 w-5" />, roles: ['super_admin', 'billing', 'support'], permission: 'cms' },
  { label: 'Subscribers', key: 'subscribers', href: '/users', icon: <Users className="h-5 w-5" />, roles: ['super_admin', 'billing', 'support'], permission: 'subscribers' },
  { label: 'Packages', key: 'packages', href: '/packages', icon: <Package className="h-5 w-5" />, roles: ['super_admin'], permission: 'packages' },
  { label: 'Subscriber Details', key: 'orders', href: '/orders', icon: <PackageCheck className="h-5 w-5" />, roles: ['super_admin', 'billing', 'support'], permission: 'billing' },
  { label: 'Billing', key: 'billing', href: '/billing', icon: <Receipt className="h-5 w-5" />, roles: ['super_admin', 'billing'], permission: 'billing' },
  { label: 'Billing Engine', key: 'billing_engine', href: '/billing-engine', icon: <Bot className="h-5 w-5" />, roles: ['super_admin', 'billing'], permission: 'billing' },
  { label: 'Operations', key: 'operations', href: '/operations', icon: <ClipboardList className="h-5 w-5" />, roles: ['super_admin', 'billing', 'support'], permission: 'subscribers' },
  { label: 'Tickets', key: 'tickets', href: '/tickets', icon: <Ticket className="h-5 w-5" />, roles: ['super_admin', 'support', 'technician', 'noc_operator'], permission: 'tickets' },
  { label: 'Technicians', key: 'technicians', href: '/technicians', icon: <Wrench className="h-5 w-5" />, roles: ['super_admin', 'support', 'technician', 'noc_operator'], permission: 'technicians' },
  { label: 'Referral Rewards', key: 'referral_rewards', href: '/referrals', icon: <Gift className="h-5 w-5" />, roles: ['super_admin', 'billing', 'support'], permission: 'referral_rewards' },
  { label: 'Boost Bandwidth', key: 'boost_bandwidth', href: '/boost', icon: <Zap className="h-5 w-5" />, roles: ['super_admin', 'support', 'technician'], permission: 'boost_bandwidth' },
  { label: 'Live Latency & Ping', key: 'live_latency', href: '/latency', icon: <Radio className="h-5 w-5" />, roles: ['super_admin', 'support', 'technician', 'noc_operator'], permission: 'live_latency' },
  { label: 'Bandwidth & Traffic', key: 'interface_traffic', href: '/traffic', icon: <Activity className="h-5 w-5" />, roles: ['super_admin', 'support', 'technician', 'noc_operator'], permission: 'interface_traffic' },
  { label: 'Cloud Peering Hubs', key: 'peering_hubs', href: '/peering', icon: <Network className="h-5 w-5" />, roles: ['super_admin', 'support', 'noc_operator'], permission: 'peering_hubs' },
  { label: 'Reports', key: 'reports', href: '/reports', icon: <BarChart3 className="h-5 w-5" />, roles: ['super_admin', 'billing', 'noc_operator'], permission: 'reports' },
  { label: 'Role Management', key: 'roles', href: '/roles', icon: <Shield className="h-5 w-5" />, roles: ['super_admin'], permission: 'roles' },
  { label: 'Settings', key: 'settings', href: '/settings', icon: <Settings className="h-5 w-5" />, roles: ['super_admin'], permission: 'settings' },
  { label: 'Profile', key: 'profile', href: '/profile', icon: <User className="h-5 w-5" />, roles: ['super_admin', 'billing', 'support', 'technician', 'noc_operator'], permission: 'dashboard' },
];

interface SidebarProps {
  mobileOpen: boolean;
  onMobileClose: () => void;
}

export function Sidebar({ mobileOpen, onMobileClose }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();
  const { user, logout } = useAuthStore();
  const { t } = useAdminTranslation();

  // The sidebar is filtered by the role's permission matrix (the same matrix
  // the Role Management page edits and persists). Editing the matrix there
  // changes what the sidebar shows.
  const roles = useAdminDataStore((state) => state.roles);

  const activeRole = roles.find((role: any) => role.key === user?.role);
  const allowedPermissions: string[] = activeRole?.permissions || [];

  const allowedItems = navItems.filter(item => {
    if (!user) return false;
    const roleAllowed = item.roles.includes(user.role as UserRole);
    if (!roleAllowed) return false;
    // When the matrix is loaded, the permission gate is authoritative.
    if (allowedPermissions.length > 0) {
      return allowedPermissions.includes(item.permission);
    }
    return true;
  });

  const sidebarContent = (
    <div className="flex h-full flex-col">
      {/* Logo */}
      <div className={cn('flex items-center gap-3 border-b px-4 py-5', collapsed && 'justify-center px-2')}>
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-white">
          <Wifi className="h-5 w-5" />
        </div>
        {!collapsed && (
          <div>
            <span className="font-bold text-lg leading-none">NextLink</span>
            <p className="text-xs text-muted-foreground">ISP Admin</p>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-4">
        <ul className="space-y-1 px-2">
          {allowedItems.map((item) => {
            const isActive = pathname.startsWith(item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={onMobileClose}
                  title={collapsed ? item.label : undefined}
                  className={cn(
                    'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-primary text-white'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                    collapsed && 'justify-center px-2'
                  )}
                >
                  {item.icon}
                  {!collapsed && <span className="truncate">{item.label}</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* User info */}
      <div className={cn('border-t p-4', collapsed && 'px-2')}>
        {user && !collapsed && (
          <Link href="/profile" className="block mb-3 p-1.5 rounded-lg hover:bg-accent transition-colors" title="View / Edit Profile">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Shield className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{user.name}</p>
                <p className="text-xs text-muted-foreground capitalize">{user.role.replace('_', ' ')}</p>
              </div>
            </div>
          </Link>
        )}
        <button
          onClick={logout}
          title={collapsed ? 'Logout' : undefined}
          className={cn(
            'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors',
            collapsed && 'justify-center px-2'
          )}
        >
          <LogOut className="h-4 w-4" />
          {!collapsed && <span>Logout</span>}
        </button>
      </div>

      {/* Collapse button (desktop) */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="absolute -right-3 top-20 hidden md:flex h-6 w-6 items-center justify-center rounded-full border bg-background shadow-md hover:shadow-lg transition-shadow"
      >
        {collapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronLeft className="h-3 w-3" />}
      </button>
    </div>
  );

  return (
    <>
      {/* Desktop Sidebar */}
      <aside
        className={cn(
          'relative hidden md:flex flex-col h-full border-r bg-card sidebar-transition',
          collapsed ? 'w-16' : 'w-64'
        )}
      >
        {sidebarContent}
      </aside>

      {/* Mobile Drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={onMobileClose} />
          <aside className="absolute left-0 top-0 h-full w-64 bg-card border-r shadow-xl">
            <button
              onClick={onMobileClose}
              className="absolute right-4 top-4 p-1 rounded-md hover:bg-accent"
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
