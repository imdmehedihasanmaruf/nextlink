"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError } from "@/services/api-client";
import { ispApi, type Payment } from "@/services/isp-api";
import { ArrowDownToLine, ArrowRight, CheckCircle2, ChevronDown, CreditCard, RefreshCw, Search, ShieldCheck, X } from "lucide-react";

const currency = (n: number | string) => `৳${Number(n).toLocaleString("en-BD")}`;
const localDate = (date: string) => new Date(`${date}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const formatStatus = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const methodLabels: Record<string, string> = { bkash: "bKash", nagad: "Nagad", rocket: "Rocket", sslcommerz: "SSLCommerz", cash: "Cash", manual: "Manual" };

export function LivePayments() {
    const [rows, setRows] = useState<Payment[]>([]);
    const [query, setQuery] = useState("");
    const [status, setStatus] = useState("");
    const [method, setMethod] = useState("");
    const [page, setPage] = useState(1);
    const [pages, setPages] = useState(1);
    const [total, setTotal] = useState(0);
    const [busy, setBusy] = useState(true);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [verifyingId, setVerifyingId] = useState<number | null>(null);

    const load = useCallback(async () => {
        setBusy(true); setError("");
        try {
            const result = await ispApi.payments(query.trim(), page, 20, status, method);
            setRows(result.items);
            setTotal(result.meta.total);
            setPages(result.meta.last_page ?? Math.max(1, Math.ceil(result.meta.total / result.meta.per_page)));
        } catch (cause) { setError(cause instanceof ApiError ? cause.message : "Could not load payment records."); }
        finally { setBusy(false); }
    }, [query, page, status, method]);

    useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 180); return () => window.clearTimeout(timer); }, [load]);

    const summary = useMemo(() => ({
        verified: rows.filter((row) => row.status === "verified").reduce((sum, row) => sum + Number(row.amount), 0),
        pending: rows.filter((row) => row.status === "pending").reduce((sum, row) => sum + Number(row.amount), 0),
        failed: rows.filter((row) => row.status === "failed").length,
    }), [rows]);

    async function verify(payment: Payment, newStatus: "verified" | "failed") {
        const confirmed = window.confirm(`${newStatus === "verified" ? "Verify" : "Mark as failed"} payment ${payment.id}?`);
        if (!confirmed) return;
        setVerifyingId(payment.id); setNotice("");
        try {
            await ispApi.verifyPayment(payment.id, newStatus);
            setNotice(newStatus === "verified" ? "Payment verified successfully." : "Payment marked as failed.");
            await load();
        } catch (cause) { setError(cause instanceof ApiError ? cause.message : "Unable to verify payment."); }
        finally { setVerifyingId(null); }
    }

    function exportCsv() {
        const columns = ["ID", "Subscriber", "Invoice #", "Method", "Reference", "Amount", "Status", "Date"];
        const quote = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
        const lines = [columns, ...rows.map((row) => [row.id, row.subscriber_name || "Unknown", row.invoice_number || "—", methodLabels[row.method] || row.method, row.transaction_reference || "—", row.amount, row.status, row.created_at ? localDate(row.created_at) : "—"])].map((line) => line.map(quote).join(","));
        const url = URL.createObjectURL(new Blob([lines.join("\r\n")], { type: "text/csv;charset=utf-8" }));
        const anchor = document.createElement("a"); anchor.href = url; anchor.download = `payments-page-${page}.csv`; anchor.click(); URL.revokeObjectURL(url);
    }

    return <div className="payments-management">
        <header className="subscriber-page-heading"><div><span className="eyebrow">PAYMENT MANAGEMENT</span><h1>Payments</h1><p>Track, verify, and manage subscriber payments and transactions.</p></div><div className="subscriber-heading-actions"><button type="button" className="button button-outline" onClick={exportCsv} disabled={!rows.length}><ArrowDownToLine size={15} /> Export page</button></div></header>
        <div className="subscriber-summary"><article><span><CreditCard size={17} /></span><small>All matching records</small><strong>{total}</strong></article><article><span className="green"><CheckCircle2 size={17} /></span><small>Verified (this page)</small><strong>{currency(summary.verified)}</strong></article><article><span className="orange"><CreditCard size={17} /></span><small>Pending (this page)</small><strong>{currency(summary.pending)}</strong></article><article><span className="violet"><X size={17} /></span><small>Failed (this page)</small><strong>{summary.failed}</strong></article></div>
        {notice && <div className="inline-success" role="status">{notice}<button type="button" onClick={() => setNotice("")} aria-label="Dismiss"><X size={15} /></button></div>}
        {error && <div className="inline-error" role="alert">{error}<button type="button" onClick={() => setError("")} aria-label="Dismiss"><X size={15} /></button></div>}
        <section className="data-panel subscriber-table-panel"><div className="data-panel-heading"><div><h2>Transaction history</h2><p>{busy ? "Refreshing records…" : `${total} matching payment${total === 1 ? "" : "s"}`}</p></div><button type="button" className="button button-outline" onClick={() => void load()} disabled={busy}><RefreshCw size={14} /> Refresh</button></div>
            <div className="subscriber-filters"><label className="subscriber-search"><Search size={16} /><input value={query} onChange={(event) => { setPage(1); setQuery(event.target.value); }} placeholder="Search ID, reference, subscriber…" /></label><label className="subscriber-status-filter"><span>Status</span><select value={status} onChange={(event) => { setPage(1); setStatus(event.target.value); }}><option value="">All statuses</option><option value="verified">Verified</option><option value="pending">Pending</option><option value="failed">Failed</option></select><ChevronDown size={14} /></label><label className="subscriber-status-filter"><span>Method</span><select value={method} onChange={(event) => { setPage(1); setMethod(event.target.value); }}><option value="">All methods</option><option value="bkash">bKash</option><option value="nagad">Nagad</option><option value="rocket">Rocket</option><option value="sslcommerz">SSLCommerz</option><option value="cash">Cash</option><option value="manual">Manual</option></select><ChevronDown size={14} /></label></div>
            {error ? <div role="alert" className="empty-state"><strong>Could not load payment records</strong><p>{error}</p><button type="button" className="button button-outline" onClick={() => void load()}>Try again</button></div> : busy && rows.length === 0 ? <div role="status" className="empty-state">Loading payment records…</div> : rows.length === 0 ? <div className="empty-state"><span><CreditCard size={20} /></span><strong>{query || status || method ? "No matching payments" : "No payment records yet"}</strong><p>{query || status || method ? "Change the search or filters and try again." : "Payments will appear here once subscribers make transactions."}</p></div> : <div className="table-wrap"><table className="data-table subscriber-table"><thead><tr><th>Transaction</th><th>Subscriber</th><th>Invoice</th><th>Method</th><th>Reference</th><th>Amount</th><th>Status</th><th>Actions</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><strong>TXN-{String(row.id).padStart(5, "0")}</strong><small>{row.created_at ? localDate(row.created_at) : "—"}</small></td><td>{row.subscriber_name || "Unknown"}<small>{row.subscriber_number || `ID ${row.subscriber_id}`}</small></td><td>{row.invoice_number || "—"}</td><td><span className="method-pill">{methodLabels[row.method] || row.method}</span></td><td className="reference-cell">{row.transaction_reference || "—"}</td><td><strong>{currency(row.amount)}</strong></td><td><span className={`status-badge status-${row.status.toLowerCase()}`}>{formatStatus(row.status)}</span></td><td><div className="subscriber-row-actions">{row.status === "pending" && <><button type="button" className="table-icon-button success" aria-label="Verify payment" title="Verify" onClick={() => verify(row, "verified")} disabled={verifyingId === row.id}><CheckCircle2 size={14} /></button><button type="button" className="table-icon-button danger" aria-label="Mark as failed" title="Fail" onClick={() => verify(row, "failed")} disabled={verifyingId === row.id}><X size={14} /></button></>}</div></td></tr>)}</tbody></table></div>}
            <footer className="subscriber-pagination"><span>Showing {rows.length ? (page - 1) * 20 + 1 : 0}–{Math.min(page * 20, total)} of {total}</span><div><button type="button" disabled={page <= 1 || busy} onClick={() => setPage(page - 1)}>Previous</button><span>Page {page} of {pages}</span><button type="button" disabled={page >= pages || busy} onClick={() => setPage(page + 1)}>Next</button></div></footer>
        </section>
    </div>;
}