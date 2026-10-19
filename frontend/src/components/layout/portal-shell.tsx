"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Bell, ChevronDown, LogOut, Menu, Search, X, UserRound } from "lucide-react";
import { adminNav, clientNav } from "@/data/demo";
import { ispApi } from "@/services/isp-api";

export function PortalShell({ children, role }: { children: React.ReactNode; role: "admin" | "client" }) {
    const pathname = usePathname();
    const router = useRouter();
    const client = role === "client";
    const [menuOpen, setMenuOpen] = useState(false);
    const [searchOpen, setSearchOpen] = useState(false);
    const [userName, setUserName] = useState("Account");
    const [notificationsOpen, setNotificationsOpen] = useState(false);
    const [profileOpen, setProfileOpen] = useState(false);
    const [notifications, setNotifications] = useState<{ title: string; detail: string; href: string }[]>([]);
    const [searchTerm, setSearchTerm] = useState("");
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
    const nav = role === "admin" ? (pathname.startsWith("/technician") ? [{ label: "My work queue", href: "/technician", icon: "⌁" }, { label: "All tickets", href: "/admin/tickets", icon: "◌" }] : adminNav) : clientNav;
    const currentPage = nav.find((item) => item.href === pathname || (item.href !== "/admin/dashboard" && pathname.startsWith(`${item.href}/`)));

    useEffect(() => {
        let active = true;
        ispApi.me().then((user) => { if (active) setUserName(user.name); }).catch(() => { if (active) setUserName("Account"); });
        if (!client) {
            Promise.allSettled([ispApi.tickets(), ispApi.payments()]).then((results) => {
                if (!active) return;
                const items: { title: string; detail: string; href: string }[] = [];
                const tickets = results[0];
                if (tickets.status === "fulfilled") tickets.value.items.filter((ticket) => ["open", "in_progress"].includes(ticket.status)).slice(0, 5).forEach((ticket) => items.push({ title: ticket.subject, detail: `Ticket ${ticket.status.replace("_", " ")} · #${ticket.id}`, href: "/admin/tickets" }));
                const payments = results[1];
                if (payments.status === "fulfilled") payments.value.items.filter((payment) => payment.status === "pending").slice(0, 5).forEach((payment) => items.push({ title: "Payment requires review", detail: `${payment.method} · ৳${payment.amount}`, href: "/admin/payments" }));
                setNotifications(items);
            });
        }
        return () => { active = false; };
    }, [client]);

    async function logout() {
        try { await ispApi.logout(); }
        finally { router.replace(client ? "/client/login" : "/admin/login"); }
    }

    function searchRecords(value: string) {
        const query = value.trim();
        if (!query) return;
        if (client) router.push(`/client/support?search=${encodeURIComponent(query)}`);
        else {
            const destinations = [{ label: "Dashboard", href: "/admin/dashboard", keywords: "overview home" }, ...adminNav.map((item) => ({ ...item, keywords: item.label.toLowerCase() }))];
            const match = destinations.find((item) => `${item.label} ${item.keywords}`.toLowerCase().includes(query.toLowerCase()));
            router.push(match ? match.href : `/admin/subscribers?search=${encodeURIComponent(query)}`);
        }
        setSearchOpen(false);
    }

    return <div className={`portal${sidebarCollapsed ? " portal-sidebar-collapsed" : ""}`}>
        <aside className={menuOpen ? "sidebar sidebar-open" : "sidebar"}>
            <Link className="brand sidebar-brand" href={client ? "/client/dashboard" : pathname.startsWith("/technician") ? "/technician" : "/admin/dashboard"}>
                <span className="brand-mark">n</span><span>nex<span className="brand-light">link</span><small>{client ? "CUSTOMER PORTAL" : pathname.startsWith("/technician") ? "FIELD TEAM" : "NETWORK CONSOLE"}</small></span>
            </Link>
            <div className="sidebar-label">{client ? "YOUR ACCOUNT" : pathname.startsWith("/technician") ? "FIELD WORK" : "WORKSPACE"}</div>
            <nav className="sidebar-nav" aria-label="Main navigation">
                {nav.map((item) => <Link onClick={() => setMenuOpen(false)} className={pathname === item.href || (item.href !== "/admin/dashboard" && pathname.startsWith(`${item.href}/`)) ? "sidebar-link selected" : "sidebar-link"} href={item.href} key={item.href}><span className="sidebar-icon">{item.icon}</span>{item.label}</Link>)}
            </nav>
            <div className="sidebar-bottom">
                <div className="help-card"><span className="help-dot" /><div><strong>Need a hand?</strong><span>Contact support for assistance.</span><Link href={client ? "/client/support" : "/admin/tickets"}>Visit support →</Link></div></div>
                <button type="button" className="sidebar-user" onClick={logout} aria-label="Sign out">
                    <span className="avatar">{userName.slice(0, 1).toUpperCase()}</span><span><strong>{userName}</strong><small>{client ? "Subscriber" : "Staff account"}</small></span><LogOut size={15} />
                </button>
            </div>
        </aside>
        <div className="portal-main">
            <header className="portal-topbar">
                <button type="button" className="icon-button menu-toggle portal-menu" onClick={() => { if (window.matchMedia("(max-width: 768px)").matches) setMenuOpen((value) => !value); else setSidebarCollapsed((value) => !value); }} aria-label="Toggle sidebar" aria-expanded={!sidebarCollapsed}>{menuOpen ? <X /> : <Menu />}</button>
                <div className="crumb"><span>{client ? "Customer portal" : pathname.startsWith("/technician") ? "Field team" : "Workspace"}</span><span>/</span><strong>{currentPage?.label ?? "Overview"}</strong></div>
                <div className="topbar-actions">
                    {searchOpen && <div className="header-search-wrap"><input className="header-search-input" aria-label="Search records" autoFocus value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder={client ? "Search support tickets" : "Search subscribers or sections"} onKeyDown={(event) => { if (event.key === "Enter") searchRecords(searchTerm); if (event.key === "Escape") setSearchOpen(false); }} /><div className="header-search-hint">Press Enter to search{!client && " · Try ‘Billing’, ‘Reports’, or a subscriber name"}</div></div>}
                    <button type="button" className="icon-button" aria-label="Search records" aria-expanded={searchOpen} onClick={() => setSearchOpen((value) => !value)}><Search size={17} /></button>
                    <div className="header-notification-wrap"><button type="button" className="icon-button notification-button" aria-label={`Notifications, ${notifications.length} unread`} aria-expanded={notificationsOpen} onClick={() => setNotificationsOpen((value) => !value)}><Bell size={17} />{notifications.length > 0 && <span className="notification-count">{notifications.length > 9 ? "9+" : notifications.length}</span>}</button>{notificationsOpen && <div className="header-popover"><div className="popover-heading"><strong>Notifications</strong><span>{notifications.length}</span></div>{notifications.length === 0 ? <p className="popover-empty">You’re all caught up.</p> : <ul>{notifications.map((item, index) => <li key={`${item.href}-${index}`}><Link href={item.href} onClick={() => setNotificationsOpen(false)}><strong>{item.title}</strong><span>{item.detail}</span></Link></li>)}</ul>}</div>}</div>
                    <div className="header-account"><button type="button" className="header-profile-trigger" aria-expanded={profileOpen} onClick={() => setProfileOpen((value) => !value)}><span className="top-avatar">{userName.slice(0, 1).toUpperCase()}</span><span className="top-user-name">{userName}</span><ChevronDown size={15} /></button>{profileOpen && <div className="header-popover profile-popover"><Link href={client ? "/client/profile" : "/admin/profile"} onClick={() => setProfileOpen(false)}><UserRound size={15} /> My profile</Link><button type="button" onClick={logout}><LogOut size={15} /> Sign out</button></div>}</div>
                </div>
            </header>
            <main className="portal-content">{children}</main>
        </div>
    </div>;
}
