"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Activity, ArrowDownRight, ArrowRight, ArrowUpRight, Boxes, BriefcaseBusiness, CircleDollarSign, Clock3, CreditCard, FileClock, FileText, LifeBuoy, PackageCheck, RefreshCw, ShieldCheck, TicketCheck, UserRound, Users, Wifi, CalendarClock, TrendingUp, Gauge, Inbox, ChartNoAxesCombined, type LucideIcon } from "lucide-react";
import { ApiError } from "@/services/api-client";
import { ispApi, type DashboardMetrics, type ReportOverview } from "@/services/isp-api";

const currency = (value: number | string | undefined) => `৳${Number(value ?? 0).toLocaleString("en-BD")}`;
const titleCase = (text: string) => text.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

function Widget({ title, href, children, className = "" }: { title: string; href?: string; children: React.ReactNode; className?: string }) {
    return <section className={`admin-widget ${className}`}><header><h2>{title}</h2>{href && <Link href={href} aria-label={`Open ${title}`}>View <ArrowRight size={13} /></Link>}</header>{children}</section>;
}

function MetricWidget({ title, value, icon: Icon, href, tone = "" }: { title: string; value: string; icon: LucideIcon; href: string; tone?: string }) {
    return <Widget title={title} href={href} className="admin-metric-widget"><div className={`admin-metric-icon ${tone}`}><Icon size={18} /></div><strong>{value}</strong></Widget>;
}

function BarChart({ series }: { series: ReportOverview["monthly_series"] }) {
    const max = Math.max(1, ...series.flatMap((item) => [item.collected, item.invoiced]));
    return <div className="admin-chart" role="img" aria-label="Monthly collected payments and invoiced totals"><div className="admin-chart-bars">{series.map((item) => <div className="admin-chart-column" key={item.label}><div className="admin-chart-track"><span className="admin-chart-invoiced" style={{ height: `${item.invoiced / max * 100}%` }} /><span className="admin-chart-collected" style={{ height: `${item.collected / max * 100}%` }} /></div><small>{item.label}</small></div>)}</div><div className="admin-chart-legend"><span><i className="collected-key" /> Collected</span><span><i className="invoiced-key" /> Invoiced</span></div></div>;
}

function HorizontalBars({ items, nameKey, valueKey, empty }: { items: { [key: string]: string | number }[]; nameKey: string; valueKey: string; empty: string }) {
    if (!items.length) return <p className="admin-widget-empty">{empty}</p>;
    const max = Math.max(1, ...items.map((item) => Number(item[valueKey])));
    return <div className="admin-horizontal-bars">{items.slice(0, 5).map((item) => <div className="admin-horizontal-row" key={String(item[nameKey])}><div><span>{titleCase(String(item[nameKey]))}</span><strong>{item[valueKey]}</strong></div><i><b style={{ width: `${Number(item[valueKey]) / max * 100}%` }} /></i></div>)}</div>;
}

export function AdminDashboardAnalytics() {
    const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
    const [report, setReport] = useState<ReportOverview | null>(null);
    const [name, setName] = useState("administrator");
    const [busy, setBusy] = useState(true);
    const [error, setError] = useState("");
    const load = useCallback(async () => {
        setBusy(true); setError("");
        try {
            const [dashboard, overview, user] = await Promise.all([ispApi.dashboard(), ispApi.reportOverview(), ispApi.me()]);
            setMetrics(dashboard); setReport(overview); setName(user.name);
        } catch (cause) { setError(cause instanceof ApiError ? cause.message : "Could not load dashboard information."); }
        finally { setBusy(false); }
    }, []);
    useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);
    if (busy && (!metrics || !report)) return <div className="admin-dashboard-loading" role="status"><RefreshCw size={18} /> Loading live dashboard…</div>;
    if (error || !metrics || !report) return <section className="data-panel admin-dashboard-error" role="alert"><h1>Dashboard unavailable</h1><p>{error || "Dashboard data is unavailable."}</p><button className="button button-dark" onClick={() => void load()}>Retry <RefreshCw size={14} /></button></section>;

    const widgets = [
        <MetricWidget key="subscribers" title="Total subscribers" value={String(metrics.total_subscribers)} icon={Users} href="/admin/subscribers" />,
        <MetricWidget key="active" title="Active connections" value={String(metrics.active_connections)} icon={Wifi} href="/admin/subscribers" tone="green" />,
        <MetricWidget key="suspended" title="Suspended" value={String(metrics.suspended_connections)} icon={ArrowDownRight} href="/admin/subscribers" tone="orange" />,
        <MetricWidget key="pending" title="Pending connections" value={String(metrics.pending_connections)} icon={Clock3} href="/admin/subscribers" tone="orange" />,
        <MetricWidget key="open" title="Open support tickets" value={String(metrics.open_tickets)} icon={LifeBuoy} href="/admin/tickets" tone="violet" />,
        <MetricWidget key="revenue" title="Monthly recurring revenue" value={currency(metrics.monthly_recurring_revenue)} icon={CircleDollarSign} href="/admin/reports" tone="violet" />,
        <MetricWidget key="unpaid" title="Unpaid invoice balance" value={currency(metrics.unpaid_invoice_total)} icon={FileText} href="/admin/billing" tone="orange" />,
        <MetricWidget key="collected" title="Collected payments" value={currency(report.collected_total)} icon={CreditCard} href="/admin/payments" tone="green" />,
        <MetricWidget key="pending-payments" title="Payments to review" value={String(report.pending_payments)} icon={FileClock} href="/admin/payments" tone="orange" />,
        <MetricWidget key="overdue" title="Overdue invoices" value={String(report.overdue_invoices)} icon={FileText} href="/admin/billing" tone="orange" />,
        <MetricWidget key="packages" title="Active packages" value={String(report.active_packages)} icon={PackageCheck} href="/admin/packages" />,
        <MetricWidget key="roles" title="Staff accounts" value={String(report.role_counts.reduce((sum, row) => sum + Number(row.total), 0))} icon={BriefcaseBusiness} href="/admin/staff" />,
        <MetricWidget key="today-collections" title="Collected today" value={currency(report.today_collected)} icon={CircleDollarSign} href="/admin/payments" tone="green" />,
        <MetricWidget key="month-collections" title="Collected this month" value={currency(report.month_collected)} icon={TrendingUp} href="/admin/payments" tone="green" />,
        <MetricWidget key="due-soon" title="Invoices due in 7 days" value={String(report.invoices_due_soon)} icon={CalendarClock} href="/admin/billing" tone="orange" />,
        <MetricWidget key="new-subs" title="New subscribers this month" value={String(report.new_subscribers_this_month)} icon={UserRound} href="/admin/subscribers" />,
        <MetricWidget key="collection-rate" title="Invoice collection rate" value={`${report.collection_rate}%`} icon={Gauge} href="/admin/reports" tone="violet" />,
        <MetricWidget key="applications" title="Pending applications" value={String(report.pending_applications)} icon={Inbox} href="/admin/subscribers" tone="orange" />,
        <MetricWidget key="failed-payments" title="Failed payments" value={String(report.failed_payments)} icon={ArrowDownRight} href="/admin/payments" tone="orange" />,
        <MetricWidget key="resolved-tickets" title="Tickets resolved this month" value={String(report.tickets_resolved_this_month)} icon={TicketCheck} href="/admin/tickets" tone="green" />,
        <Widget key="revenue-chart" title="Revenue & invoices · six months" href="/admin/reports" className="admin-widget-wide"><BarChart series={report.monthly_series} /></Widget>,
        <Widget key="status" title="Subscriber status" href="/admin/subscribers"><HorizontalBars items={report.subscriber_status} nameKey="status" valueKey="total" empty="No subscriber records yet." /></Widget>,
        <Widget key="plans" title="Package adoption" href="/admin/packages"><HorizontalBars items={report.package_distribution} nameKey="name" valueKey="subscribers" empty="No package assignments yet." /></Widget>,
        <Widget key="methods" title="Payment methods" href="/admin/payments"><HorizontalBars items={report.payment_methods} nameKey="method" valueKey="total" empty="No verified payment records yet." /></Widget>,
        <Widget key="staff-roles" title="Staff by role" href="/admin/staff"><HorizontalBars items={report.role_counts.filter((item) => item.role !== "subscriber")} nameKey="role" valueKey="total" empty="No staff records yet." /></Widget>,
        <Widget key="recent-subscribers" title="Recently added subscribers" href="/admin/subscribers"><ul className="admin-widget-list">{report.recent_subscribers.length ? report.recent_subscribers.map((item) => <li key={item.id}><span className="admin-list-avatar"><UserRound size={14} /></span><span><strong>{item.name || item.subscriber_number || `Subscriber ${item.id}`}</strong><small>{item.subscriber_number || "Number pending"}</small></span><em>{titleCase(item.status)}</em></li>) : <li className="admin-widget-empty">No subscriber records yet.</li>}</ul></Widget>,
        <Widget key="recent-invoices" title="Recent invoices" href="/admin/billing"><ul className="admin-widget-list">{report.recent_invoices.length ? report.recent_invoices.map((item) => <li key={item.id}><span className="admin-list-avatar invoice"><FileText size={14} /></span><span><strong>{item.invoice_number}</strong><small>{item.subscriber_name || "Subscriber"}</small></span><em>{currency(item.amount)}</em></li>) : <li className="admin-widget-empty">No invoices yet.</li>}</ul></Widget>,
        <Widget key="recent-tickets" title="Recent support tickets" href="/admin/tickets"><ul className="admin-widget-list">{report.recent_tickets.length ? report.recent_tickets.map((item) => <li key={item.id}><span className="admin-list-avatar ticket"><TicketCheck size={14} /></span><span><strong>{item.subject}</strong><small>{item.subscriber_name || "Subscriber"} · {titleCase(item.priority)}</small></span><em>{titleCase(item.status)}</em></li>) : <li className="admin-widget-empty">No support tickets yet.</li>}</ul></Widget>,
        <Widget key="collections-compare" title="Collections · this month vs previous" href="/admin/reports"><div className="admin-compare"><div><span>This month</span><strong>{currency(report.month_collected)}</strong><i><b style={{ width: `${Math.min(100, report.month_collected / Math.max(1, report.month_collected, report.previous_month_collected) * 100)}%` }} /></i></div><div><span>Previous month</span><strong>{currency(report.previous_month_collected)}</strong><i><b className="previous-month-bar" style={{ width: `${Math.min(100, report.previous_month_collected / Math.max(1, report.month_collected, report.previous_month_collected) * 100)}%` }} /></i></div><small><ChartNoAxesCombined size={13} /> Based on verified payment records</small></div></Widget>,
        <Widget key="quick-access" title="Management areas" className="admin-widget-wide"><div className="admin-quick-links">{[{ label: "Subscribers", href: "/admin/subscribers", icon: Users }, { label: "Packages", href: "/admin/packages", icon: Boxes }, { label: "Billing", href: "/admin/billing", icon: FileText }, { label: "Payments", href: "/admin/payments", icon: CreditCard }, { label: "Support", href: "/admin/tickets", icon: LifeBuoy }, { label: "Technicians", href: "/admin/technicians", icon: BriefcaseBusiness }, { label: "MikroTik", href: "/admin/mikrotik", icon: Activity }, { label: "Reports", href: "/admin/reports", icon: ArrowUpRight }, { label: "Staff & roles", href: "/admin/staff", icon: ShieldCheck }, { label: "Settings", href: "/admin/settings", icon: Boxes }].map(({ label, href, icon: Icon }) => <Link href={href} key={href}><Icon size={16} /><span>{label}</span><ArrowRight size={13} /></Link>)}</div></Widget>,
        <Widget key="ticket-priority" title="Open tickets by priority" href="/admin/tickets"><HorizontalBars items={report.tickets_by_priority} nameKey="priority" valueKey="total" empty="No open tickets." /></Widget>,
        <Widget key="ticket-resolution" title="Ticket status breakdown" href="/admin/tickets"><HorizontalBars items={report.ticket_resolution} nameKey="status" valueKey="total" empty="No support tickets yet." /></Widget>,
        <Widget key="top-packages" title="Top packages by subscribers" href="/admin/packages"><HorizontalBars items={report.top_packages} nameKey="name" valueKey="subscribers" empty="No package assignments yet." /></Widget>,
        <Widget key="application-status" title="Connection applications" href="/admin/subscribers"><HorizontalBars items={report.application_status} nameKey="status" valueKey="total" empty="No application data available." /></Widget>,
    ];

    return <div className="admin-dashboard"><header className="admin-dashboard-heading"><div><span className="eyebrow">LIVE OPERATIONS</span><h1>Welcome, {name}</h1><p>Live overview from your ISP management database.</p></div><button type="button" className="button button-outline" onClick={() => void load()} disabled={busy}><RefreshCw size={15} /> Refresh</button></header><div className="admin-widget-grid">{widgets}</div><p className="admin-widget-footnote">Dashboard widgets: {widgets.length} · Updated from current database records</p></div>;
}
