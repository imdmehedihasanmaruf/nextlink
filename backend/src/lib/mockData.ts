export type SubscriberStatus = 'active' | 'suspended' | 'pending' | 'inactive';
export type InvoiceStatus = 'paid' | 'unpaid' | 'overdue';
export type TicketStatus = 'open' | 'in-progress' | 'resolved' | 'closed';
export type TicketPriority = 'low' | 'medium' | 'high' | 'critical';
export type TechnicianStatus = 'available' | 'busy' | 'off-duty';
export type UserRole = 'super_admin' | 'billing' | 'support' | 'technician';

export interface Package {
  id: string;
  name: string;
  downloadSpeed: number;
  uploadSpeed: number;
  price: number;
  duration: number; // days
  description: string;
  subscriberCount: number;
}

export interface Subscriber {
  id: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  zone: string;
  packageId: string;
  packageName: string;
  status: SubscriberStatus;
  dueDate: string;
  joinDate: string;
  connectionType: string;
  ipAddress: string;
  macAddress: string;
  balance: number;
  totalPaid: number;
}

export interface Invoice {
  id: string;
  subscriberId: string;
  subscriberName: string;
  phone: string;
  packageName: string;
  amount: number;
  status: InvoiceStatus;
  issueDate: string;
  dueDate: string;
  paidDate?: string;
  month: string;
}

export interface Ticket {
  id: string;
  subscriberId: string;
  subscriberName: string;
  phone: string;
  subject: string;
  description: string;
  priority: TicketPriority;
  status: TicketStatus;
  assignedTo?: string;
  createdAt: string;
  updatedAt: string;
  messages: TicketMessage[];
}

export interface TicketMessage {
  id: string;
  author: string;
  role: string;
  content: string;
  timestamp: string;
}

export interface Technician {
  id: string;
  name: string;
  phone: string;
  email: string;
  zone: string;
  status: TechnicianStatus;
  activeJobs: number;
  completedJobs: number;
}

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  phone: string;
  status: 'active' | 'inactive';
  lastLogin: string;
}

export interface RevenueData {
  month: string;
  revenue: number;
  collection: number;
  pending: number;
}

export interface SubscriberGrowth {
  month: string;
  total: number;
  new: number;
  churned: number;
}

// ─── Packages (Worldwide Fiber Plans in USD) ────────────────────────────────
export const mockPackages: Package[] = [
  { id: 'PKG-001', name: 'Starter Fiber 50', downloadSpeed: 50, uploadSpeed: 50, price: 29, duration: 30, description: 'Symmetrical 50 Mbps fiber with unlimited global bandwidth', subscriberCount: 85 },
  { id: 'PKG-002', name: 'Turbo 150', downloadSpeed: 150, uploadSpeed: 150, price: 49, duration: 30, description: 'Direct Tier-1 cloud peering with ultra-low latency', subscriberCount: 142 },
  { id: 'PKG-003', name: 'Ultra Gigabit 500', downloadSpeed: 500, uploadSpeed: 500, price: 79, duration: 30, description: 'Dedicated public IPv4 & 4K/8K bufferless streaming', subscriberCount: 93 },
  { id: 'PKG-004', name: 'Gigabit Extreme 1000', downloadSpeed: 1000, uploadSpeed: 1000, price: 109, duration: 30, description: 'Blazing 1 Gbps symmetrical pipe for power users & studios', subscriberCount: 47 },
  { id: 'PKG-005', name: 'Enterprise Cloud 2500', downloadSpeed: 2500, uploadSpeed: 2500, price: 199, duration: 30, description: '2.5 Gbps with BGP failover and /29 IPv4 subnet', subscriberCount: 18 },
];

// ─── Subscribers (Worldwide Metro Zones) ─────────────────────────────────────
export const mockSubscribers: Subscriber[] = [
  { id: 'SUB-001', name: 'Alexander Wright', phone: '+1 (212) 555-0143', email: 'alex.wright@example.com', address: '450 Lexington Ave, Ste 1200', zone: 'New York Metro', packageId: 'PKG-003', packageName: 'Ultra Gigabit 500', status: 'active', dueDate: '2024-02-05', joinDate: '2022-06-15', connectionType: 'Fiber', ipAddress: '198.51.100.12', macAddress: 'AA:BB:CC:DD:EE:01', balance: -79, totalPaid: 948 },
  { id: 'SUB-002', name: 'Elena Rostova', phone: '+44 20 7946 0912', email: 'elena.rostova@example.co.uk', address: '12 Bishopsgate, Flat 4B', zone: 'London Central', packageId: 'PKG-003', packageName: 'Ultra Gigabit 500', status: 'active', dueDate: '2024-02-10', joinDate: '2021-03-22', connectionType: 'Fiber', ipAddress: '198.51.100.15', macAddress: 'AA:BB:CC:DD:EE:02', balance: 0, totalPaid: 2844 },
  { id: 'SUB-003', name: 'Lucas Müller', phone: '+49 69 1234 5678', email: 'lucas.mueller@example.de', address: 'Taunusanlage 8', zone: 'Frankfurt & Rhine', packageId: 'PKG-002', packageName: 'Turbo 150', status: 'suspended', dueDate: '2024-01-15', joinDate: '2023-01-10', connectionType: 'Fiber', ipAddress: '198.51.100.22', macAddress: 'AA:BB:CC:DD:EE:03', balance: -98, totalPaid: 588 },
  { id: 'SUB-004', name: 'Kenji Sato', phone: '+81 3 5555 0198', email: 'kenji.sato@example.jp', address: 'Roppongi Hills 6-10-1', zone: 'Tokyo & Kanto', packageId: 'PKG-004', packageName: 'Gigabit Extreme 1000', status: 'active', dueDate: '2024-02-20', joinDate: '2020-11-05', connectionType: 'Fiber', ipAddress: '198.51.100.30', macAddress: 'AA:BB:CC:DD:EE:04', balance: 109, totalPaid: 3924 },
  { id: 'SUB-005', name: 'Chloe Dupont', phone: '+1 (415) 555-0182', email: 'chloe.dupont@example.com', address: '100 Market St, Suite 500', zone: 'Silicon Valley', packageId: 'PKG-002', packageName: 'Turbo 150', status: 'active', dueDate: '2024-02-08', joinDate: '2022-08-18', connectionType: 'Fiber', ipAddress: '198.51.100.41', macAddress: 'AA:BB:CC:DD:EE:05', balance: 0, totalPaid: 1176 },
  { id: 'SUB-006', name: 'Marcus Vance', phone: '+65 6789 0123', email: 'marcus.vance@example.sg', address: '1 Raffles Place, #28-01', zone: 'Singapore CBD', packageId: 'PKG-005', packageName: 'Enterprise Cloud 2500', status: 'active', dueDate: '2024-02-15', joinDate: '2019-07-30', connectionType: 'Fiber', ipAddress: '198.51.100.55', macAddress: 'AA:BB:CC:DD:EE:06', balance: 199, totalPaid: 11940 },
  { id: 'SUB-007', name: 'Liam O\'Connor', phone: '+61 2 9876 5432', email: 'liam.oc@example.com.au', address: '200 George St', zone: 'Sydney Metro', packageId: 'PKG-001', packageName: 'Starter Fiber 50', status: 'pending', dueDate: '2024-02-01', joinDate: '2023-12-01', connectionType: 'Fiber', ipAddress: '198.51.100.62', macAddress: 'AA:BB:CC:DD:EE:07', balance: -29, totalPaid: 58 },
  { id: 'SUB-008', name: 'Sophia Martinez', phone: '+1 (305) 555-0147', email: 'sophia.m@example.com', address: '801 Brickell Ave, Penthouse 3', zone: 'New York Metro', packageId: 'PKG-003', packageName: 'Ultra Gigabit 500', status: 'active', dueDate: '2024-02-12', joinDate: '2021-09-14', connectionType: 'Fiber', ipAddress: '198.51.100.77', macAddress: 'AA:BB:CC:DD:EE:08', balance: 79, totalPaid: 2291 },
  { id: 'SUB-009', name: 'David Chen', phone: '+1 (408) 555-0199', email: 'david.chen@example.com', address: '500 Castro St', zone: 'Silicon Valley', packageId: 'PKG-002', packageName: 'Turbo 150', status: 'active', dueDate: '2024-02-18', joinDate: '2022-04-20', connectionType: 'Fiber', ipAddress: '198.51.100.88', macAddress: 'AA:BB:CC:DD:EE:09', balance: 0, totalPaid: 1078 },
  { id: 'SUB-010', name: 'Isabella Rossi', phone: '+39 02 1234 5678', email: 'isabella.rossi@example.it', address: 'Corso Vittorio Emanuele 14', zone: 'London Central', packageId: 'PKG-001', packageName: 'Starter Fiber 50', status: 'inactive', dueDate: '2023-12-01', joinDate: '2021-05-05', connectionType: 'Fiber', ipAddress: '198.51.100.99', macAddress: 'AA:BB:CC:DD:EE:10', balance: -58, totalPaid: 696 },
  { id: 'SUB-011', name: 'Julian Becker', phone: '+49 30 9876 5432', email: 'julian.becker@example.de', address: 'Friedrichstraße 45', zone: 'Frankfurt & Rhine', packageId: 'PKG-003', packageName: 'Ultra Gigabit 500', status: 'active', dueDate: '2024-02-25', joinDate: '2020-02-10', connectionType: 'Fiber', ipAddress: '198.51.100.111', macAddress: 'AA:BB:CC:DD:EE:11', balance: 158, totalPaid: 3792 },
  { id: 'SUB-012', name: 'Camille Laurent', phone: '+33 1 4268 5500', email: 'camille.l@example.fr', address: '25 Boulevard Haussmann', zone: 'London Central', packageId: 'PKG-002', packageName: 'Turbo 150', status: 'active', dueDate: '2024-02-14', joinDate: '2023-03-07', connectionType: 'Fiber', ipAddress: '198.51.100.112', macAddress: 'AA:BB:CC:DD:EE:12', balance: 0, totalPaid: 588 },
  { id: 'SUB-013', name: 'Mateo Fernandez', phone: '+34 91 555 4321', email: 'mateo.f@example.es', address: 'Paseo de la Castellana 89', zone: 'Frankfurt & Rhine', packageId: 'PKG-001', packageName: 'Starter Fiber 50', status: 'suspended', dueDate: '2024-01-20', joinDate: '2022-11-15', connectionType: 'Fiber', ipAddress: '198.51.100.113', macAddress: 'AA:BB:CC:DD:EE:13', balance: -58, totalPaid: 348 },
  { id: 'SUB-014', name: 'Emily Watson', phone: '+1 (617) 555-0177', email: 'emily.w@example.com', address: '75 State Street, 19th Floor', zone: 'New York Metro', packageId: 'PKG-004', packageName: 'Gigabit Extreme 1000', status: 'active', dueDate: '2024-02-22', joinDate: '2021-01-28', connectionType: 'Fiber', ipAddress: '198.51.100.114', macAddress: 'AA:BB:CC:DD:EE:14', balance: 109, totalPaid: 3924 },
  { id: 'SUB-015', name: 'Astrid Lind', phone: '+46 8 123 4567', email: 'astrid.lind@example.se', address: 'Kungsgatan 32', zone: 'London Central', packageId: 'PKG-002', packageName: 'Turbo 150', status: 'active', dueDate: '2024-02-09', joinDate: '2022-07-04', connectionType: 'Fiber', ipAddress: '198.51.100.115', macAddress: 'AA:BB:CC:DD:EE:15', balance: 49, totalPaid: 980 },
  { id: 'SUB-016', name: 'Tariq Al-Mansoor', phone: '+971 4 312 0000', email: 'tariq.m@example.ae', address: 'Dubai Marina Tower 2', zone: 'Singapore CBD', packageId: 'PKG-003', packageName: 'Ultra Gigabit 500', status: 'active', dueDate: '2024-02-17', joinDate: '2020-09-11', connectionType: 'Fiber', ipAddress: '198.51.100.116', macAddress: 'AA:BB:CC:DD:EE:16', balance: 158, totalPaid: 3239 },
  { id: 'SUB-017', name: 'Lars Nielsen', phone: '+45 33 12 34 56', email: 'lars.nielsen@example.dk', address: 'Vesterbrogade 12', zone: 'Frankfurt & Rhine', packageId: 'PKG-001', packageName: 'Starter Fiber 50', status: 'active', dueDate: '2024-02-11', joinDate: '2023-05-20', connectionType: 'Fiber', ipAddress: '198.51.100.117', macAddress: 'AA:BB:CC:DD:EE:17', balance: 0, totalPaid: 261 },
  { id: 'SUB-018', name: 'Jessica Taylor', phone: '+1 (206) 555-0165', email: 'jtaylor@example.com', address: '1201 Third Ave, Ste 400', zone: 'Silicon Valley', packageId: 'PKG-005', packageName: 'Enterprise Cloud 2500', status: 'active', dueDate: '2024-02-28', joinDate: '2019-04-16', connectionType: 'Fiber', ipAddress: '198.51.100.118', macAddress: 'AA:BB:CC:DD:EE:18', balance: 398, totalPaid: 11542 },
  { id: 'SUB-019', name: 'Min-jun Kim', phone: '+82 2 3456 7890', email: 'minjun.kim@example.kr', address: 'Teheran-ro 152, Gangnam', zone: 'Tokyo & Kanto', packageId: 'PKG-002', packageName: 'Turbo 150', status: 'pending', dueDate: '2024-02-03', joinDate: '2024-01-15', connectionType: 'Fiber', ipAddress: '198.51.100.119', macAddress: 'AA:BB:CC:DD:EE:19', balance: -49, totalPaid: 0 },
  { id: 'SUB-020', name: 'Sebastian Cruz', phone: '+1 (312) 555-0188', email: 'scruz@example.com', address: '233 S Wacker Dr', zone: 'New York Metro', packageId: 'PKG-004', packageName: 'Gigabit Extreme 1000', status: 'active', dueDate: '2024-02-16', joinDate: '2021-06-30', connectionType: 'Fiber', ipAddress: '198.51.100.120', macAddress: 'AA:BB:CC:DD:EE:20', balance: 218, totalPaid: 3488 },
];

// ─── Invoices (USD Amounts) ──────────────────────────────────────────────────
export const mockInvoices: Invoice[] = [
  { id: 'INV-2024-001', subscriberId: 'SUB-001', subscriberName: 'Alexander Wright', phone: '+1 (212) 555-0143', packageName: 'Ultra Gigabit 500', amount: 79, status: 'unpaid', issueDate: '2024-01-01', dueDate: '2024-02-05', month: 'February 2024' },
  { id: 'INV-2024-002', subscriberId: 'SUB-002', subscriberName: 'Elena Rostova', phone: '+44 20 7946 0912', packageName: 'Ultra Gigabit 500', amount: 79, status: 'paid', issueDate: '2024-01-01', dueDate: '2024-02-10', paidDate: '2024-01-30', month: 'February 2024' },
  { id: 'INV-2024-003', subscriberId: 'SUB-003', subscriberName: 'Lucas Müller', phone: '+49 69 1234 5678', packageName: 'Turbo 150', amount: 49, status: 'overdue', issueDate: '2023-12-01', dueDate: '2024-01-15', month: 'January 2024' },
  { id: 'INV-2024-004', subscriberId: 'SUB-004', subscriberName: 'Kenji Sato', phone: '+81 3 5555 0198', packageName: 'Gigabit Extreme 1000', amount: 109, status: 'paid', issueDate: '2024-01-01', dueDate: '2024-02-20', paidDate: '2024-01-25', month: 'February 2024' },
  { id: 'INV-2024-005', subscriberId: 'SUB-005', subscriberName: 'Chloe Dupont', phone: '+1 (415) 555-0182', packageName: 'Turbo 150', amount: 49, status: 'unpaid', issueDate: '2024-01-01', dueDate: '2024-02-08', month: 'February 2024' },
  { id: 'INV-2024-006', subscriberId: 'SUB-006', subscriberName: 'Marcus Vance', phone: '+65 6789 0123', packageName: 'Enterprise Cloud 2500', amount: 199, status: 'paid', issueDate: '2024-01-01', dueDate: '2024-02-15', paidDate: '2024-01-28', month: 'February 2024' },
  { id: 'INV-2024-007', subscriberId: 'SUB-007', subscriberName: 'Liam O\'Connor', phone: '+61 2 9876 5432', packageName: 'Starter Fiber 50', amount: 29, status: 'overdue', issueDate: '2023-12-01', dueDate: '2024-01-20', month: 'January 2024' },
  { id: 'INV-2024-008', subscriberId: 'SUB-008', subscriberName: 'Sophia Martinez', phone: '+1 (305) 555-0147', packageName: 'Ultra Gigabit 500', amount: 79, status: 'paid', issueDate: '2024-01-01', dueDate: '2024-02-12', paidDate: '2024-01-20', month: 'February 2024' },
  { id: 'INV-2024-009', subscriberId: 'SUB-009', subscriberName: 'David Chen', phone: '+1 (408) 555-0199', packageName: 'Turbo 150', amount: 49, status: 'unpaid', issueDate: '2024-01-01', dueDate: '2024-02-18', month: 'February 2024' },
  { id: 'INV-2024-010', subscriberId: 'SUB-010', subscriberName: 'Isabella Rossi', phone: '+39 02 1234 5678', packageName: 'Starter Fiber 50', amount: 29, status: 'overdue', issueDate: '2023-11-01', dueDate: '2023-12-01', month: 'December 2023' },
  { id: 'INV-2024-011', subscriberId: 'SUB-011', subscriberName: 'Julian Becker', phone: '+49 30 9876 5432', packageName: 'Ultra Gigabit 500', amount: 79, status: 'paid', issueDate: '2024-01-01', dueDate: '2024-02-25', paidDate: '2024-01-15', month: 'February 2024' },
  { id: 'INV-2024-012', subscriberId: 'SUB-012', subscriberName: 'Camille Laurent', phone: '+33 1 4268 5500', packageName: 'Turbo 150', amount: 49, status: 'paid', issueDate: '2024-01-01', dueDate: '2024-02-14', paidDate: '2024-02-01', month: 'February 2024' },
  { id: 'INV-2024-013', subscriberId: 'SUB-013', subscriberName: 'Mateo Fernandez', phone: '+34 91 555 4321', packageName: 'Starter Fiber 50', amount: 29, status: 'overdue', issueDate: '2023-12-01', dueDate: '2024-01-20', month: 'January 2024' },
  { id: 'INV-2024-014', subscriberId: 'SUB-014', subscriberName: 'Emily Watson', phone: '+1 (617) 555-0177', packageName: 'Gigabit Extreme 1000', amount: 109, status: 'unpaid', issueDate: '2024-01-01', dueDate: '2024-02-22', month: 'February 2024' },
  { id: 'INV-2024-015', subscriberId: 'SUB-015', subscriberName: 'Astrid Lind', phone: '+46 8 123 4567', packageName: 'Turbo 150', amount: 49, status: 'paid', issueDate: '2024-01-01', dueDate: '2024-02-09', paidDate: '2024-01-22', month: 'February 2024' },
];

// ─── Tickets (Global Support Inquiries) ───────────────────────────────────────
export const mockTickets: Ticket[] = [
  {
    id: 'TKT-001', subscriberId: 'SUB-001', subscriberName: 'Alexander Wright', phone: '+1 (212) 555-0143',
    subject: 'Intermittent optical loss during evening peak', description: 'Experiencing micro-packet drops between 8 PM and 11 PM on the Manhattan metro ring.',
    priority: 'high', status: 'in-progress', assignedTo: 'TECH-001', createdAt: '2024-02-01T09:30:00Z', updatedAt: '2024-02-01T14:00:00Z',
    messages: [
      { id: 'MSG-001', author: 'Alexander Wright', role: 'Subscriber', content: 'Connection experiences packet loss during peak streaming hours.', timestamp: '2024-02-01T09:30:00Z' },
      { id: 'MSG-002', author: 'Support Team', role: 'Support', content: 'We have dispatched a field engineer to inspect the optical splitter at the local distribution node.', timestamp: '2024-02-01T10:15:00Z' },
      { id: 'MSG-003', author: 'David Miller', role: 'Technician', content: 'Inspecting OLT port signal power. Attenuation calibrated to -18 dBm.', timestamp: '2024-02-01T14:00:00Z' },
    ]
  },
  {
    id: 'TKT-002', subscriberId: 'SUB-003', subscriberName: 'Lucas Müller', phone: '+49 69 1234 5678',
    subject: 'Automated invoice payment query', description: 'Inquiring about international SEPA bank direct debit setup for monthly invoicing.',
    priority: 'medium', status: 'open', assignedTo: undefined, createdAt: '2024-02-02T11:00:00Z', updatedAt: '2024-02-02T11:00:00Z',
    messages: [
      { id: 'MSG-004', author: 'Lucas Müller', role: 'Subscriber', content: 'Can I set up direct IBAN debit for automatic payment reconciliation?', timestamp: '2024-02-02T11:00:00Z' },
    ]
  },
  {
    id: 'TKT-003', subscriberId: 'SUB-005', subscriberName: 'Chloe Dupont', phone: '+1 (415) 555-0182',
    subject: 'Request for Static IPv4 allocation', description: 'Need dedicated IPv4 address for remote hosting and homelab server.',
    priority: 'medium', status: 'resolved', assignedTo: 'TECH-002', createdAt: '2024-01-28T08:00:00Z', updatedAt: '2024-01-30T16:00:00Z',
    messages: [
      { id: 'MSG-005', author: 'Chloe Dupont', role: 'Subscriber', content: 'Requesting static IPv4 assignment for my router gateway.', timestamp: '2024-01-28T08:00:00Z' },
      { id: 'MSG-006', author: 'Support Team', role: 'Support', content: 'Static IP 198.51.100.41 has been mapped and reserved in DHCP pool.', timestamp: '2024-01-29T10:00:00Z' },
      { id: 'MSG-007', author: 'Support Team', role: 'Support', content: 'Reverse DNS PTR record configured successfully. Ticket marked resolved.', timestamp: '2024-01-30T16:00:00Z' },
    ]
  },
  {
    id: 'TKT-004', subscriberId: 'SUB-006', subscriberName: 'Marcus Vance', phone: '+65 6789 0123',
    subject: 'BGP peering failover testing', description: 'Scheduled failover test for the secondary 2.5 Gbps redundant circuit.',
    priority: 'critical', status: 'open', assignedTo: 'TECH-005', createdAt: '2024-02-03T07:00:00Z', updatedAt: '2024-02-03T07:00:00Z',
    messages: [
      { id: 'MSG-008', author: 'Marcus Vance', role: 'Subscriber', content: 'Confirming maintenance window for secondary route failover drill.', timestamp: '2024-02-03T07:00:00Z' },
    ]
  },
  {
    id: 'TKT-005', subscriberId: 'SUB-004', subscriberName: 'Kenji Sato', phone: '+81 3 5555 0198',
    subject: 'Plan upgrade to Gigabit Extreme 1000', description: 'Successfully migrated from Turbo 150 to Gigabit Extreme 1000.',
    priority: 'low', status: 'closed', assignedTo: 'TECH-004', createdAt: '2024-01-20T12:00:00Z', updatedAt: '2024-01-22T10:00:00Z',
    messages: [
      { id: 'MSG-009', author: 'Kenji Sato', role: 'Subscriber', content: 'Please upgrade my line profile to 1 Gbps symmetrical.', timestamp: '2024-01-20T12:00:00Z' },
      { id: 'MSG-010', author: 'Support Team', role: 'Support', content: 'Bandwidth queue resized to 1000M down / 1000M up. Verified on OLT.', timestamp: '2024-01-22T10:00:00Z' },
    ]
  },
];

// ─── Technicians (Worldwide NOC & Field Engineers) ───────────────────────────
export const mockTechnicians: Technician[] = [
  { id: 'TECH-001', name: 'David Miller', phone: '+1 (212) 555-0191', email: 'd.miller@nextlink.global', zone: 'New York Metro', status: 'busy', activeJobs: 2, completedJobs: 145 },
  { id: 'TECH-002', name: 'Oliver Smith', phone: '+44 20 7946 0888', email: 'o.smith@nextlink.global', zone: 'London Central', status: 'available', activeJobs: 0, completedJobs: 212 },
  { id: 'TECH-003', name: 'Hans Weber', phone: '+49 69 9876 5410', email: 'h.weber@nextlink.global', zone: 'Frankfurt & Rhine', status: 'busy', activeJobs: 1, completedJobs: 98 },
  { id: 'TECH-004', name: 'Takashi Tanaka', phone: '+81 3 5555 0222', email: 't.tanaka@nextlink.global', zone: 'Tokyo & Kanto', status: 'available', activeJobs: 0, completedJobs: 176 },
  { id: 'TECH-005', name: 'Raymond Tan', phone: '+65 6789 0555', email: 'r.tan@nextlink.global', zone: 'Singapore CBD', status: 'off-duty', activeJobs: 0, completedJobs: 89 },
];

// ─── Admin Users ──────────────────────────────────────────────────────────────
export const mockAdminUsers: AdminUser[] = [
  { id: 'ADM-001', name: 'Global NOC Director', email: 'admin@nextlink.global', role: 'super_admin', phone: '+1 (800) 550-0001', status: 'active', lastLogin: '2024-02-04T08:00:00Z' },
  { id: 'ADM-002', name: 'Global Billing Manager', email: 'billing@nextlink.global', role: 'billing', phone: '+1 (800) 550-0002', status: 'active', lastLogin: '2024-02-04T07:30:00Z' },
  { id: 'ADM-003', name: 'Tier-3 Support Lead', email: 'support@nextlink.global', role: 'support', phone: '+1 (800) 550-0003', status: 'active', lastLogin: '2024-02-03T18:00:00Z' },
  { id: 'ADM-004', name: 'Infrastructure Specialist', email: 'field@nextlink.global', role: 'technician', phone: '+1 (800) 550-0004', status: 'active', lastLogin: '2024-02-04T06:45:00Z' },
];

// ─── Revenue Data (USD) ───────────────────────────────────────────────────────
export const mockRevenueData: RevenueData[] = [
  { month: 'Aug', revenue: 28500, collection: 26500, pending: 2000 },
  { month: 'Sep', revenue: 29800, collection: 27500, pending: 2300 },
  { month: 'Oct', revenue: 31200, collection: 29000, pending: 2200 },
  { month: 'Nov', revenue: 32500, collection: 30200, pending: 2300 },
  { month: 'Dec', revenue: 31800, collection: 29500, pending: 2300 },
  { month: 'Jan', revenue: 34200, collection: 31800, pending: 2400 },
  { month: 'Feb', revenue: 35800, collection: 21500, pending: 14300 },
];

export const mockSubscriberGrowth: SubscriberGrowth[] = [
  { month: 'Aug', total: 320, new: 18, churned: 5 },
  { month: 'Sep', total: 334, new: 20, churned: 6 },
  { month: 'Oct', total: 352, new: 24, churned: 6 },
  { month: 'Nov', total: 371, new: 25, churned: 6 },
  { month: 'Dec', total: 388, new: 22, churned: 5 },
  { month: 'Jan', total: 407, new: 26, churned: 7 },
  { month: 'Feb', total: 420, new: 20, churned: 7 },
];

// ─── Derived Stats ────────────────────────────────────────────────────────────
export const dashboardStats = {
  totalSubscribers: mockSubscribers.length,
  activeSubscribers: mockSubscribers.filter(s => s.status === 'active').length,
  suspendedSubscribers: mockSubscribers.filter(s => s.status === 'suspended').length,
  pendingSubscribers: mockSubscribers.filter(s => s.status === 'pending').length,
  revenueThisMonth: 35800,
  collectedThisMonth: 21500,
  pendingPayments: mockInvoices.filter(i => i.status === 'unpaid' || i.status === 'overdue').length,
  openTickets: mockTickets.filter(t => t.status === 'open').length,
  resolvedTickets: mockTickets.filter(t => t.status === 'resolved').length,
};
