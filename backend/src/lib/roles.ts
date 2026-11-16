export interface Role {
  id: string;
  name: string;
  key: string;
  description: string;
  permissions: string[];
  userCount: number;
  isSystem: boolean;
}

export const defaultRoles: Role[] = [
  {
    id: 'ROLE-001',
    name: 'Super Admin',
    key: 'super_admin',
    description: 'Full root access to all ISP infrastructure, billing, and system configuration',
    permissions: [
      'dashboard', 'subscribers', 'packages', 'billing', 'view_cancel_invoices', 'export_cancel_invoices', 'tickets', 'technicians', 
      'referral_rewards', 'boost_bandwidth', 'live_latency', 'interface_traffic', 'peering_hubs',
      'reports', 'cms', 'settings', 'roles', 'notifications'
    ],
    userCount: 1,
    isSystem: true,
  },
  {
    id: 'ROLE-002',
    name: 'Billing Operations Manager',
    key: 'billing',
    description: 'Manages billing statements, invoices, receipts, and accounting reports',
    permissions: ['dashboard', 'subscribers', 'billing', 'view_cancel_invoices', 'export_cancel_invoices', 'referral_rewards', 'reports', 'notifications'],
    userCount: 1,
    isSystem: true,
  },
  {
    id: 'ROLE-003',
    name: 'Tier-3 Technical Support Lead',
    key: 'support',
    description: 'Handles support tickets, customer communications, and network diagnostics',
    permissions: ['dashboard', 'subscribers', 'tickets', 'technicians', 'boost_bandwidth', 'live_latency', 'notifications'],
    userCount: 1,
    isSystem: true,
  },
  {
    id: 'ROLE-004',
    name: 'Field Optical Engineer',
    key: 'technician',
    description: 'Assigned to physical optical fiber drops, field maintenance, and installations',
    permissions: ['dashboard', 'tickets', 'technicians', 'live_latency', 'interface_traffic', 'notifications'],
    userCount: 1,
    isSystem: true,
  },
  {
    id: 'ROLE-005',
    name: 'NOC Network Operator',
    key: 'noc_operator',
    description: 'Monitors real-time BGP routing, POP latency, and gateway health',
    permissions: ['dashboard', 'reports', 'tickets', 'live_latency', 'interface_traffic', 'peering_hubs', 'notifications'],
    userCount: 2,
    isSystem: false,
  },
];
