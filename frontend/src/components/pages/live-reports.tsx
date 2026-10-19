"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError } from "@/services/api-client";
import { ispApi, type ReportOverview } from "@/services/isp-api";
import { ArrowDownToLine, ArrowRight, ArrowUpRight, BarChart3, Calendar, CheckCircle2, Clock3, Download, FileText, RefreshCw, Wifi, X } from "lucide-react";

const currency = (n: number | string) => `৳${Number(n).toLocaleString("en-BD")}`;
const percentChange = (current: number, previous: number) => {
    if (previous === 0) return current > 0 ? "+100%" : "0%";
    const change = ((current - previous) / previous) * 100;
    return `${change >= 0 ? "+" : ""}${change.toFixed(1)}%`;
};

export function LiveReports() {
    const [data, setData] = useState<ReportOverview | null>(null);
    const [busy, setBusy] = useState(true);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [period, setPeriod] = useState<"week" | "month" | "quarter" | "year">("month");

    const load = useCallback(async () => {
        setBusy(true); setError("");
        try { setData(await ispApi.reportOverview()); }
        catch (cause) { setError(cause instanceof ApiError ? cause.message : "Could not load reports."); }
        finally { setBusy(false); }
    }, []);

    useEffect(() => { void load(); }, [load]);

    const summary = useMemo(() => {
        if (!data) return null;
        const growthRate = data.new_subscribers_previous_month > 0
            ? ((data.new_subscribers_this_month - data.new_subscribers_previous_month) / data.new_subscribers_previous_month) * 100
            : 0;
        return {
            collectionRate: data.collection_rate,
            growthRate: growthRate,
            totalInvoiced: data.collected_total + data.unpaid_balance,
            avgTicketValue: data.month_collected / Math.max(1, data.month_collected > 0 ? 1 : 0),
        };
    }, [data]);

    function exportReport() {
        if (!data) return;
        const report = {
            generated_at: new Date().toISOString(),
            revenue: {
                collected_total: data.collected_total,
                unpaid_balance: data.unpaid_balance,
                overdue_invoices: data.overdue_invoices,
                today_collected: data.today_collected,
                month_collected: data.month_collected,
                previous_month_collected: data.previous_month_collected,
                collection_rate: data.collection_rate,
            },
            subscribers: {
                total: data.subscriber_status.reduce((sum, s) => sum + s.total, 0),
                by_status: data.subscriber_status,
                new_this_month: data.new_subscribers_this_month,
                new_previous_month: data.new_subscribers_previous_month,
                top_packages: data.top_packages,
            },
            tickets: {
                open: data.recent_tickets.filter((t) => t.status === "open").length,
                in_progress: data.recent_tickets.filter((t) => t.status === "in_progress").length,
                resolved: data.recent_tickets.filter((t) => ["resolved", "closed"].includes(t.status)).length,
                by_priority: data.tickets_by_priority,
                resolved_this_month: data.tickets_resolved_this_month,
            },
            payments: {
                pending: data.pending_payments,
                failed: data.failed_payments,
                by_method: data.payment_methods,
            },
        };
        const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `isp-report-${new Date().toISOString().split("T")[0]}.json`;
        anchor.click();
        URL.revokeObjectURL(url);
        setNotice("Report exported successfully.");
    }

    function exportCsv() {
        if (!data) return;
        const lines = [
            ["Metric", "Value"],
            ["Total Collected", currency(data.collected_total)],
            ["Unpaid Balance", currency(data.unpaid_balance)],
            ["Overdue Invoices", data.overdue_invoices],
            ["Collected This Month", currency(data.month_collected)],
            ["Collection Rate", `${data.collection_rate}%`],
            ["New Subscribers (This Month)", data.new_subscribers_this_month],
            ["Tickets Resolved (This Month)", data.tickets_resolved_this_month],
            ["Failed Payments", data.failed_payments],
            ["", ""],
            ["Subscriber Status", "Count"],
            ...data.subscriber_status.map((s) => [s.status, s.total]),
        ];
        const blob = new Blob([lines.map((l) => l.join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `isp-report-${new Date().toISOString().split("T")[0]}.csv`;
        anchor.click();
        URL.revokeObjectURL(url);
        setNotice("CSV report exported.");
    }

    if (error) {
        return (
            <div className="reports-management">
                <header className="subscriber-page-heading"><div><span className="eyebrow">BUSINESS INTELLIGENCE</span><h1>Reports & Analytics</h1><p>Revenue, subscriber, and operational metrics.</p></div></header>
                <div role="alert" className="empty-state"><strong>Could not load reports</strong><p>{error}</p><button type="button" className="button button-outline" onClick={() => void load()}>Try again</button></div>
            </div>
        );
    }

    if (!data) {
        return (
            <div className="reports-management">
                <header className="subscriber-page-heading"><div><span className="eyebrow">BUSINESS INTELLIGENCE</span><h1>Reports & Analytics</h1><p>Revenue, subscriber, and operational metrics.</p></div></header>
                <div role="status" className="empty-state">Loading reports…</div>
            </div>
        );
    }

    return (
        <div className="reports-management">
            <header className="subscriber-page-heading">
                <div>
                    <span className="eyebrow">BUSINESS INTELLIGENCE</span>
                    <h1>Reports & Analytics</h1>
                    <p>Revenue, subscriber, and operational metrics overview.</p>
                </div>
                <div className="subscriber-heading-actions">
                    <button type="button" className="button button-outline" onClick={exportCsv}><Download size={15} /> Export CSV</button>
                    <button type="button" className="button button-outline" onClick={exportReport}><FileText size={15} /> Export JSON</button>
                    <button type="button" className="button button-outline" onClick={() => void load()} disabled={busy}><RefreshCw size={14} className={busy ? "spin" : ""} /> Refresh</button>
                </div>
            </header>
            {notice && <div className="inline-success" role="status">{notice}<button type="button" onClick={() => setNotice("")} aria-label="Dismiss"><X size={15} /></button></div>}
            <div className="report-controls">
                <label><span>Report period</span><select value={period} onChange={(e) => setPeriod(e.target.value as typeof period)}><option value="week">Last 7 days</option><option value="month">This month</option><option value="quarter">This quarter</option><option value="year">This year</option></select></label>
            </div>
            {/* KPI Grid */}
            <div className="kpi-grid">
                <article className="kpi-card"><div className="kpi-icon kpi-green"><ArrowUpRight size={18} /></div><span className="kpi-label">Revenue Collected</span><strong className="kpi-value">{currency(data.month_collected)}</strong><span className="kpi-change"><ArrowUpRight size={13} /> {percentChange(data.month_collected, data.previous_month_collected)} vs last month</span></article>
                <article className="kpi-card"><div className="kpi-icon kpi-orange"><Clock3 size={18} /></div><span className="kpi-label">Outstanding Balance</span><strong className="kpi-value">{currency(data.unpaid_balance)}</strong><span className="kpi-change">{data.overdue_invoices} overdue invoices</span></article>
                <article className="kpi-card"><div className="kpi-icon"><Wifi size={18} /></div><span className="kpi-label">Total Subscribers</span><strong className="kpi-value">{data.subscriber_status.reduce((sum, s) => sum + s.total, 0)}</strong><span className="kpi-change"><ArrowUpRight size={13} /> {percentChange(data.new_subscribers_this_month, data.new_subscribers_previous_month)} new this month</span></article>
                <article className="kpi-card"><div className="kpi-icon kpi-violet"><CheckCircle2 size={18} /></div><span className="kpi-label">Collection Rate</span><strong className="kpi-value">{data.collection_rate}%</strong><span className="kpi-change">{data.pending_payments} pending payments</span></article>
            </div>
            <div className="kpi-grid kpi-grid-three">
                <article className="kpi-card"><div className="kpi-icon kpi-green"><CheckCircle2 size={18} /></div><span className="kpi-label">Tickets Resolved</span><strong className="kpi-value">{data.tickets_resolved_this_month}</strong><span className="kpi-change">This month</span></article>
                <article className="kpi-card"><div className="kpi-icon kpi-orange"><Clock3 size={18} /></div><span className="kpi-label">Invoices Due Soon</span><strong className="kpi-value">{data.invoices_due_soon}</strong><span className="kpi-change">Next 7 days</span></article>
                <article className="kpi-card"><div className="kpi-icon"><X size={18} /></div><span className="kpi-label">Failed Payments</span><strong className="kpi-value">{data.failed_payments}</strong><span className="kpi-change">Require attention</span></article>
            </div>
            {/* Charts Grid */}
            <div className="dashboard-grid">
                {/* Revenue Chart */}
                <section className="data-panel chart-panel">
                    <div className="data-panel-heading"><div><h2>Revenue Trend</h2><p>Monthly collected vs invoiced</p></div></div>
                    <div className="chart-legend"><span><i className="legend-dot lime" />Collected</span><span><i className="legend-dot muted" />Invoiced</span></div>
                    <div className="bar-chart">
                        {data.monthly_series.slice(-7).map((m) => (
                            <div className="bar-column" key={m.label}>
                                <div className="bar-track">
                                    <span className="bar-out" style={{ height: `${Math.min(100, (m.invoiced / Math.max(1, data.month_collected)) * 100)}%` }} />
                                    <span className="bar-in" style={{ height: `${Math.min(100, (m.collected / Math.max(1, data.month_collected)) * 100)}%` }} />
                                </div>
                                <span>{m.label}</span>
                            </div>
                        ))}
                    </div>
                    <div className="chart-axis"><span>৳0</span><span>৳{Math.round(data.month_collected / 10000)}L</span></div>
                </section>
                {/* Subscriber Distribution */}
                <section className="data-panel">
                    <div className="data-panel-heading"><div><h2>Subscriber Distribution</h2><p>By package</p></div></div>
                    <div className="package-distribution">
                        {data.package_distribution.slice(0, 5).map((p, i) => {
                            const total = data.package_distribution.reduce((sum, pkg) => sum + pkg.subscribers, 0);
                            const pct = total > 0 ? (p.subscribers / total) * 100 : 0;
                            return (
                                <div key={p.name} className="distro-row">
                                    <span className="distro-label">{p.name}</span>
                                    <div className="distro-bar"><div style={{ width: `${pct}%` }} /></div>
                                    <span className="distro-value">{p.subscribers} ({pct.toFixed(0)}%)</span>
                                </div>
                            );
                        })}
                    </div>
                </section>
            </div>
            {/* Tables Grid */}
            <div className="dashboard-grid dashboard-grid-three">
                {/* Recent Invoices */}
                <section className="data-panel">
                    <div className="data-panel-heading"><div><h2>Recent Invoices</h2><p>Latest billing activity</p></div></div>
                    <ul className="admin-widget-list">
                        {data.recent_invoices.slice(0, 5).map((inv) => (
                            <li key={inv.id}>
                                <span className="admin-list-avatar invoice"><FileText size={14} /></span>
                                <span><strong>{inv.invoice_number}</strong><small>{inv.subscriber_name || "Unknown"}</small></span>
                                <em>{currency(inv.amount)}</em>
                            </li>
                        ))}
                    </ul>
                </section>
                {/* Recent Tickets */}
                <section className="data-panel">
                    <div className="data-panel-heading"><div><h2>Recent Tickets</h2><p>Support queue</p></div></div>
                    <ul className="admin-widget-list">
                        {data.recent_tickets.slice(0, 5).map((t) => (
                            <li key={t.id}>
                                <span className={`admin-list-avatar ${t.priority === "urgent" ? "urgent" : t.priority === "high" ? "high" : ""}`}><BarChart3 size={14} /></span>
                                <span><strong>{t.subject}</strong><small>{t.subscriber_name || "Unknown"}</small></span>
                                <span className={`status-badge status-${t.status.replace("_", "-")}`}>{t.status.replace("_", " ")}</span>
                            </li>
                        ))}
                    </ul>
                </section>
                {/* Payment Methods */}
                <section className="data-panel">
                    <div className="data-panel-heading"><div><h2>Payments by Method</h2><p>Transaction distribution</p></div></div>
                    <ul className="admin-widget-list">
                        {data.payment_methods.map((pm) => (
                            <li key={pm.method}>
                                <span className="admin-list-avatar"><CheckCircle2 size={14} /></span>
                                <span><strong>{pm.method.charAt(0).toUpperCase() + pm.method.slice(1)}</strong></span>
                                <em>{pm.total} transactions</em>
                            </li>
                        ))}
                    </ul>
                </section>
            </div>
            {/* Subscriber Status Table */}
            <section className="data-panel">
                <div className="data-panel-heading"><div><h2>Subscriber Status Overview</h2><p>Current account breakdown</p></div></div>
                <div className="table-wrap">
                    <table className="data-table">
                        <thead><tr><th>Status</th><th>Count</th><th>Percentage</th></tr></thead>
                        <tbody>
                            {data.subscriber_status.map((s) => {
                                const total = data.subscriber_status.reduce((sum, st) => sum + st.total, 0);
                                const pct = total > 0 ? (s.total / total) * 100 : 0;
                                return (
                                    <tr key={s.status}>
                                        <td><span className={`status-badge status-${s.status.toLowerCase()}`}>{s.status.replace("_", " ")}</span></td>
                                        <td><strong>{s.total}</strong></td>
                                        <td><div className="distro-mini"><div style={{ width: `${pct}%` }} /></div><small>{pct.toFixed(1)}%</small></td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </section>
        </div>
    );
}