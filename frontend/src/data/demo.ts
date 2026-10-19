export type Package = { id: string; name: string; speed: number; price: number; installationFee: number; bdix: number; features: string[]; popular?: boolean };
export type Subscriber = { id: string; name: string; phone: string; area: string; packageName: string; status: "Active" | "Suspended" | "Pending" | "Terminated"; balance: number };
export type Invoice = { id: string; subscriber: string; period: string; due: string; amount: number; status: "Paid" | "Unpaid" | "Overdue" };
export type Ticket = { id: string; subscriber: string; subject: string; category: string; priority: "Low" | "Normal" | "High" | "Urgent"; status: "Open" | "In progress" | "Resolved"; technician: string };

export const demoPackages: Package[] = [
    { id: "home-20", name: "Home 20", speed: 20, price: 700, installationFee: 1000, bdix: 100, features: ["Unlimited data", "BDIX speeds up to 100 Mbps", "24/7 support"] },
    { id: "home-40", name: "Home 40", speed: 40, price: 1000, installationFee: 1000, bdix: 150, features: ["Unlimited data", "BDIX speeds up to 150 Mbps", "Priority support"], popular: true },
    { id: "home-80", name: "Home 80", speed: 80, price: 1600, installationFee: 500, bdix: 200, features: ["Unlimited data", "BDIX speeds up to 200 Mbps", "Priority support"] },
    { id: "pro-150", name: "Pro 150", speed: 150, price: 2500, installationFee: 0, bdix: 300, features: ["Unlimited data", "BDIX speeds up to 300 Mbps", "Business-grade support"] },
];
export const demoSubscribers: Subscriber[] = [
    { id: "ISP-1048", name: "Nusrat Jahan", phone: "017••••1842", area: "Dhanmondi", packageName: "Home 40", status: "Active", balance: 1000 },
    { id: "ISP-1049", name: "Tanvir Ahmed", phone: "018••••7291", area: "Mohammadpur", packageName: "Home 20", status: "Suspended", balance: 700 },
    { id: "ISP-1050", name: "Samia Rahman", phone: "019••••3064", area: "Mirpur 10", packageName: "Home 80", status: "Active", balance: 0 },
    { id: "ISP-1051", name: "Arif Hossain", phone: "016••••5520", area: "Uttara", packageName: "Pro 150", status: "Pending", balance: 2500 },
    { id: "ISP-1052", name: "Rumana Akter", phone: "013••••0198", area: "Bashundhara", packageName: "Home 40", status: "Active", balance: 1000 },
];
export const demoInvoices: Invoice[] = [
    { id: "INV-2026-1048", subscriber: "Nusrat Jahan", period: "October 2026", due: "2026-10-20", amount: 1000, status: "Unpaid" },
    { id: "INV-2026-1049", subscriber: "Tanvir Ahmed", period: "October 2026", due: "2026-10-15", amount: 700, status: "Overdue" },
    { id: "INV-2026-1050", subscriber: "Samia Rahman", period: "October 2026", due: "2026-10-20", amount: 1600, status: "Paid" },
    { id: "INV-2026-1042", subscriber: "Nusrat Jahan", period: "September 2026", due: "2026-09-20", amount: 1000, status: "Paid" },
];
export const demoTickets: Ticket[] = [
    { id: "TKT-2841", subscriber: "Nusrat Jahan", subject: "Intermittent connection", category: "Connectivity", priority: "High", status: "In progress", technician: "Rafiq Hasan" },
    { id: "TKT-2842", subscriber: "Samia Rahman", subject: "Router configuration help", category: "Technical", priority: "Normal", status: "Open", technician: "Unassigned" },
    { id: "TKT-2843", subscriber: "Arif Hossain", subject: "New connection installation", category: "Installation", priority: "Urgent", status: "Open", technician: "Imran Ali" },
    { id: "TKT-2838", subscriber: "Rumana Akter", subject: "Billing question", category: "Billing", priority: "Low", status: "Resolved", technician: "Maliha Noor" },
];
export const demoNews = [
    { slug: "service-expansion", title: "Bringing reliable fibre to more neighbourhoods", category: "Network updates", date: "12 Oct 2026", excerpt: "Our fibre expansion is reaching more homes across Dhaka this month." },
    { slug: "customer-care", title: "A simpler way to get the help you need", category: "Company news", date: "04 Oct 2026", excerpt: "We are improving our support experience with clearer updates and faster responses." },
    { slug: "network-maintenance", title: "Planned network maintenance notice", category: "Service notice", date: "27 Sep 2026", excerpt: "A scheduled maintenance window helps us keep your connection dependable." },
];
export const adminNav = [
    { label: "Overview", href: "/admin/dashboard", icon: "⌂" }, { label: "Subscribers", href: "/admin/subscribers", icon: "◎" }, { label: "Packages", href: "/admin/packages", icon: "◇" }, { label: "Billing", href: "/admin/billing", icon: "▤" }, { label: "Payments", href: "/admin/payments", icon: "↗" }, { label: "Support tickets", href: "/admin/tickets", icon: "◌" }, { label: "Technicians", href: "/admin/technicians", icon: "⌁" }, { label: "MikroTik", href: "/admin/mikrotik", icon: "⌘" }, { label: "Reports", href: "/admin/reports", icon: "▥" }, { label: "Staff & roles", href: "/admin/staff", icon: "♧" }, { label: "Settings", href: "/admin/settings", icon: "⚙" },
];
export const clientNav = [
    { label: "Overview", href: "/client/dashboard", icon: "⌂" }, { label: "My bills", href: "/client/bills", icon: "▤" }, { label: "Payments", href: "/client/payments", icon: "↗" }, { label: "My package", href: "/client/packages", icon: "◇" }, { label: "Profile", href: "/client/profile", icon: "◎" }, { label: "Support", href: "/client/support", icon: "◌" },
];
export const adminTitles: Record<string, { title: string; description: string }> = {
    subscribers: { title: "Subscribers", description: "Manage customer accounts, connections and service plans." }, packages: { title: "Internet packages", description: "Configure the plans available to your customers." }, billing: { title: "Billing & invoices", description: "Review monthly invoices and outstanding balances." }, payments: { title: "Payments", description: "Review transaction records and manual payment requests." }, tickets: { title: "Support tickets", description: "Keep customer conversations and service requests moving." }, technicians: { title: "Technicians", description: "Coordinate field staff, availability and assigned work." }, mikrotik: { title: "Router management", description: "Review demo router inventory, profiles and sync history." }, reports: { title: "Reports & analytics", description: "Explore sample trends across billing, subscribers and support." }, staff: { title: "Staff & roles", description: "Manage the demo team and review role permissions." }, settings: { title: "System settings", description: "Review company and service configuration for this demo." },
};
