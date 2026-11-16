import React from 'react';
import {
  LayoutDashboard,
  Globe,
  Users,
  Package,
  PackageCheck,
  Receipt,
  Ban,
  Bot,
  ClipboardList,
  Ticket,
  Wrench,
  Gift,
  Zap,
  Radio,
  Activity,
  Network,
  BarChart3,
  Shield,
  Settings,
  User,
  Bell,
  LucideIcon,
} from 'lucide-react';

export interface NavItemConfig {
  label: string;
  key: string;
  href: string;
  iconName: string;
  icon: LucideIcon;
  aliases?: string[];
  description: string;
}

/**
 * Canonical 21 modules for NextLink Admin Navigation.
 * Must permanently display in the Admin Sidebar in this exact order:
 * 1. Dashboard, 2. Frontend CMS, 3. User Details, 4. Packages, 5. Subscriber Details,
 * 6. Billing, 7. Cancel Invoices, 8. Billing Engine, 9. Operations, 10. Tickets,
 * 11. Technicians, 12. Referral Rewards, 13. Boost Bandwidth, 14. Live Latency & Ping,
 * 15. Bandwidth & Traffic, 16. Cloud Peering Hubs, 17. Reports, 18. Role Management,
 * 19. Settings, 20. Profile, 21. Notifications.
 */
export const ADMIN_NAV_ITEMS: NavItemConfig[] = [
  {
    label: 'Dashboard',
    key: 'dashboard',
    href: '/dashboard',
    iconName: 'LayoutDashboard',
    icon: LayoutDashboard,
    aliases: ['/'],
    description: 'ISP operations and system overview',
  },
  {
    label: 'Frontend CMS',
    key: 'cms',
    href: '/cms',
    iconName: 'Globe',
    icon: Globe,
    description: 'Manage banners, packages, and news content',
  },
  {
    label: 'User Details',
    key: 'user_details',
    href: '/users',
    iconName: 'Users',
    icon: Users,
    aliases: ['/subscribers', '/user-details'],
    description: 'User accounts, risk scoring, and authentication',
  },
  {
    label: 'Packages',
    key: 'packages',
    href: '/packages',
    iconName: 'Package',
    icon: Package,
    description: 'Internet plans, bandwidth limits, and pricing catalogue',
  },
  {
    label: 'Subscriber Details',
    key: 'subscriber_details',
    href: '/orders',
    iconName: 'PackageCheck',
    icon: PackageCheck,
    aliases: ['/subscriber-details', '/subscribers/orders'],
    description: 'Subscriber line provisioning and order tracking',
  },
  {
    label: 'Billing',
    key: 'billing',
    href: '/billing',
    iconName: 'Receipt',
    icon: Receipt,
    aliases: ['/payment-operations'],
    description: 'Subscriber invoices, payments, and offline receipt collection',
  },
  {
    label: 'Cancel Invoices',
    key: 'cancel_invoices',
    href: '/cancellations',
    iconName: 'Ban',
    icon: Ban,
    aliases: ['/cancel-invoices', '/cancel_invoices'],
    description: 'Invoice cancellations, dispute auditing, and voids',
  },
  {
    label: 'Billing Engine',
    key: 'billing_engine',
    href: '/billing-engine',
    iconName: 'Bot',
    icon: Bot,
    aliases: ['/billing_engine'],
    description: 'Automated recurring billing cycles and billing generator',
  },
  {
    label: 'Operations',
    key: 'operations',
    href: '/operations',
    iconName: 'ClipboardList',
    icon: ClipboardList,
    description: 'Field operations, line installs, and provisioning queues',
  },
  {
    label: 'Tickets',
    key: 'tickets',
    href: '/tickets',
    iconName: 'Ticket',
    icon: Ticket,
    description: 'Customer support tickets, SLAs, and technical resolution',
  },
  {
    label: 'Technicians',
    key: 'technicians',
    href: '/technicians',
    iconName: 'Wrench',
    icon: Wrench,
    description: 'Field technician roster, dispatching, and zones',
  },
  {
    label: 'Referral Rewards',
    key: 'referral_rewards',
    href: '/referrals',
    iconName: 'Gift',
    icon: Gift,
    aliases: ['/referral-rewards'],
    description: 'Customer referral credits and promotional campaigns',
  },
  {
    label: 'Boost Bandwidth',
    key: 'boost_bandwidth',
    href: '/boost',
    iconName: 'Zap',
    icon: Zap,
    aliases: ['/boost-bandwidth'],
    description: 'On-demand turbo speed boost activations',
  },
  {
    label: 'Live Latency & Ping',
    key: 'live_latency',
    href: '/latency',
    iconName: 'Radio',
    icon: Radio,
    aliases: ['/live-latency'],
    description: 'Real-time telemetry, ping monitors, and POP latencies',
  },
  {
    label: 'Bandwidth & Traffic',
    key: 'bandwidth_traffic',
    href: '/traffic',
    iconName: 'Activity',
    icon: Activity,
    aliases: ['/bandwidth-traffic'],
    description: 'Live interface traffic telemetry and throughput charts',
  },
  {
    label: 'Cloud Peering Hubs',
    key: 'cloud_peering',
    href: '/peering',
    iconName: 'Network',
    icon: Network,
    aliases: ['/peering-hubs'],
    description: 'Tier-1 CDN peering, BDIX, and direct connect hubs',
  },
  {
    label: 'Reports',
    key: 'reports',
    href: '/reports',
    iconName: 'BarChart3',
    icon: BarChart3,
    description: 'Revenue, subscriber growth, and operational analytics',
  },
  {
    label: 'Role Management',
    key: 'role_management',
    href: '/roles',
    iconName: 'Shield',
    icon: Shield,
    aliases: ['/role-management'],
    description: 'RBAC permissions matrix and staff administrative roles',
  },
  {
    label: 'Settings',
    key: 'settings',
    href: '/settings',
    iconName: 'Settings',
    icon: Settings,
    description: 'Global system configuration, gateways, and backup',
  },
  {
    label: 'Profile',
    key: 'profile',
    href: '/profile',
    iconName: 'User',
    icon: User,
    description: 'Current administrator account profile and security credentials',
  },
  {
    label: 'Notifications',
    key: 'notifications',
    href: '/notifications',
    iconName: 'Bell',
    icon: Bell,
    description: 'Real-time system alerts, billing events, and ticket notices',
  },
];

const STORAGE_ACTIVE_NAV_KEY = 'nextlink_admin_active_nav';
const STORAGE_COLLAPSED_KEY = 'nextlink_admin_sidebar_collapsed';

/**
 * Check whether a given navigation item is active for the current pathname.
 */
export function isNavItemActive(pathname: string, item: NavItemConfig): boolean {
  if (!pathname) return false;

  // Exact match
  if (pathname === item.href) return true;

  // Exact match on known aliases
  if (item.aliases && item.aliases.includes(pathname)) return true;

  // Subpath matching (avoid prefix collisions like /billing matching /billing-engine)
  if (item.href === '/billing') {
    return pathname.startsWith('/billing/') && !pathname.startsWith('/billing-engine');
  }

  if (pathname.startsWith(item.href + '/')) {
    return true;
  }

  // Subpath on aliases
  if (item.aliases) {
    for (const alias of item.aliases) {
      if (pathname.startsWith(alias + '/')) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Find the matching NavItemConfig for a pathname.
 */
export function getActiveNavItem(pathname: string): NavItemConfig | undefined {
  return ADMIN_NAV_ITEMS.find((item) => isNavItemActive(pathname, item));
}

/**
 * LocalStorage persistence for active nav item across page reloads.
 */
export function getPersistedActiveHref(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(STORAGE_ACTIVE_NAV_KEY);
  } catch {
    return null;
  }
}

export function setPersistedActiveHref(href: string): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_ACTIVE_NAV_KEY, href);
  } catch {
    // ignore
  }
}

/**
 * LocalStorage persistence for sidebar collapsed state across page reloads.
 */
export function getPersistedSidebarCollapsed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const val = localStorage.getItem(STORAGE_COLLAPSED_KEY);
    return val === 'true';
  } catch {
    return false;
  }
}

export function setPersistedSidebarCollapsed(collapsed: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_COLLAPSED_KEY, String(collapsed));
  } catch {
    // ignore
  }
}
