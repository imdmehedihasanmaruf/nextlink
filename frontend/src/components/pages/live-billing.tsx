"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { ApiError } from "@/services/api-client";
import { ispApi, type Invoice, type Subscriber } from "@/services/isp-api";
import { ArrowDownToLine, ArrowRight, CalendarClock, ChevronDown, FileText, Pencil, Plus, RefreshCw, Search, X } from "lucide-react";

type InvoiceForm = { subscriber_id: string; billing_period_start: string; billing_period_end: string; due_date: string };
const initialForm: InvoiceForm = { subscriber_id: "", billing_period_start: "", billing_period_end: "", due_date: "" };
const currency = (n: number | string) => `৳${Number(n).toLocaleString("en-BD")}`;
const localDate = (date: string) => new Date(`${date}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const formatStatus = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

export function LiveBilling() {
    const [rows, setRows] = useState<Invoice[]>([]);
    const [subscribers, setSubscribers] = useState<Subscriber[]>([]);
    const [query, setQuery] = useState("");
    const [status, setStatus] = useState("");
    const [page, setPage] = useState(1);
    const [pages, setPages] = useState(1);
    const [total, setTotal] = useState(0);
    const [busy, setBusy] = useState(true);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [modalOpen, setModalOpen] = useState(false);
    const [form, setForm] = useState<InvoiceForm>(initialForm);
    const [saving, setSaving] = useState(false);
    const [actionError, setActionError] = useState("");

    const load = useCallback(async () => {
        setBusy(true); setError("");
        try {
            const result = await ispApi.invoices(query.trim(), page, 20, status);
            setRows(result.items);
            setTotal(result.meta.total);
            setPages(result.meta.last_page ?? Math.max(1, Math.ceil(result.meta.total / result.meta.per_page)));
        } catch (cause) { setError(cause instanceof ApiError ? cause.message : "Could not load invoice records."); }
        finally { setBusy(false); }
    }, [query, page, status]);

    useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 180); return () => window.clearTimeout(timer); }, [load]);
    useEffect(() => { ispApi.subscribers("", 1, 100, "active").then((result) => setSubscribers(result.items)).catch(() => setSubscribers([])); }, []);

    const summary = useMemo(() => ({
        paid: rows.filter((row) => row.status === "paid").reduce((sum, row) => sum + Number(row.amount), 0),
        unpaid: rows.filter((row) => row.status === "unpaid").reduce((sum, row) => sum + Number(row.amount), 0),
        overdue: rows.filter((row) => row.status === "overdue").reduce((sum, row) => sum + Number(row.amount), 0),
    }), [rows]);

    function openCreate() { setForm(initialForm); setActionError(""); setModalOpen(true); }
    function updateField(key: keyof InvoiceForm, value: string) { setForm((current) => ({ ...current, [key]: value })); }

    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault(); setSaving(true); setActionError(""); setNotice("");
        const payload = {
            subscriber_id: Number(form.subscriber_id),
            billing_period_start: form.billing_period_start,
            billing_period_end: form.billing_period_end,
            due_date: form.due_date,
        };
        try {
            await ispApi.createInvoice(payload);
            setModalOpen(false); setNotice("Invoice generated successfully.");
            await load();
        } catch (cause) { setActionError(cause instanceof ApiError ? cause.message : "Unable to generate invoice."); }
        finally { setSaving(false); }
    }

    function exportCsv() {
        const columns = ["Invoice #", "Subscriber", "Period Start", "Period End", "Due Date", "Amount", "Status", "Paid At"];
        const quote = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
        const lines = [columns, ...rows.map((row) => [row.invoice_number, row.subscriber_name || "Unknown", row.billing_period_start, row.billing_period_end, row.due_date, row.amount, row.status, row.paid_at || "—"])].map((line) => line.map(quote).join(","));
        const url = URL.createObjectURL(new Blob([lines.join("\r\n")], { type: "text/csv;charset=utf-8" }));
        const anchor = document.createElement("a"); anchor.href = url; anchor.download = `invoices-page-${page}.csv`; anchor.click(); URL.revokeObjectURL(url);
    }

    return <div className="billing-management">
        <header className="subscriber-page-heading"><div><span className="eyebrow">INVOICE MANAGEMENT</span><h1>Billing</h1><p>Generate, review, and track subscriber invoices and payments.</p></div><div className="subscriber-heading-actions"><button type="button" className="button button-outline" onClick={exportCsv} disabled={!rows.length}><ArrowDownToLine size={15} /> Export page</button><button type="button" className="button button-dark" onClick={openCreate}><Plus size={15} /> Generate invoice</button></div></header>
        <div className="subscriber-summary"><article><span><FileText size={17} /></span><small>All matching records</small><strong>{total}</strong></article><article><span className="green"><CalendarClock size={17} /></span><small>Total paid (this page)</small><strong>{currency(summary.paid)}</strong></article><article><span className="orange"><FileText size={17} /></span><small>Total unpaid (this page)</small><strong>{currency(summary.unpaid)}</strong></article><article><span className="violet"><CalendarClock size={17} /></span><small>Total overdue (this page)</small><strong>{currency(summary.overdue)}</strong></article></div>
        {notice && <div className="inline-success" role="status">{notice}<button type="button" onClick={() => setNotice("")} aria-label="Dismiss"><X size={15} /></button></div>}
        <section className="data-panel subscriber-table-panel"><div className="data-panel-heading"><div><h2>Invoice directory</h2><p>{busy ? "Refreshing records…" : `${total} matching invoice${total === 1 ? "" : "s"}`}</p></div><button type="button" className="button button-outline" onClick={() => void load()} disabled={busy}><RefreshCw size={14} /> Refresh</button></div>
            <div className="subscriber-filters"><label className="subscriber-search"><Search size={16} /><input value={query} onChange={(event) => { setPage(1); setQuery(event.target.value); }} placeholder="Search invoice #, subscriber name…" /></label><label className="subscriber-status-filter"><span>Status</span><select value={status} onChange={(event) => { setPage(1); setStatus(event.target.value); }}><option value="">All statuses</option><option value="paid">Paid</option><option value="unpaid">Unpaid</option><option value="overdue">Overdue</option></select><ChevronDown size={14} /></label></div>
            {error ? <div role="alert" className="empty-state"><strong>Could not load invoice records</strong><p>{error}</p><button type="button" className="button button-outline" onClick={() => void load()}>Try again</button></div> : busy && rows.length === 0 ? <div role="status" className="empty-state">Loading invoice records…</div> : rows.length === 0 ? <div className="empty-state"><span><FileText size={20} /></span><strong>{query || status ? "No matching invoices" : "No invoices yet"}</strong><p>{query || status ? "Change the search or status filter and try again." : "Generate an invoice to start billing subscribers."}</p>{!query && !status && <button type="button" className="button button-dark" onClick={openCreate}><Plus size={14} /> Generate invoice</button>}</div> : <div className="table-wrap"><table className="data-table subscriber-table"><thead><tr><th>Invoice</th><th>Subscriber</th><th>Billing period</th><th>Due date</th><th>Amount</th><th>Status</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><strong>{row.invoice_number}</strong></td><td>{row.subscriber_name || "Unknown"}<small>{row.subscriber_number || `ID ${row.subscriber_id}`}</small></td><td>{localDate(row.billing_period_start)} – {localDate(row.billing_period_end)}</td><td>{localDate(row.due_date)}</td><td><strong>{currency(row.amount)}</strong></td><td><span className={`status-badge status-${row.status.toLowerCase()}`}>{formatStatus(row.status)}</span></td></tr>)}</tbody></table></div>}
            <footer className="subscriber-pagination"><span>Showing {rows.length ? (page - 1) * 20 + 1 : 0}–{Math.min(page * 20, total)} of {total}</span><div><button type="button" disabled={page <= 1 || busy} onClick={() => setPage(page - 1)}>Previous</button><span>Page {page} of {pages}</span><button type="button" disabled={page >= pages || busy} onClick={() => setPage(page + 1)}>Next</button></div></footer>
        </section>
        {modalOpen && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setModalOpen(false); }}><section className="modal-card subscriber-modal" role="dialog" aria-modal="true" aria-labelledby="invoice-modal-title"><button type="button" className="modal-close" onClick={() => setModalOpen(false)} aria-label="Close" disabled={saving}><X size={18} /></button><span className="eyebrow">GENERATE INVOICE</span><h2 id="invoice-modal-title">Create new invoice</h2><p>Generate a billing invoice for a subscriber.</p><form onSubmit={submit}><div className="subscriber-form-grid"><label className="field-label">Subscriber<select required value={form.subscriber_id} onChange={(event) => updateField("subscriber_id", event.target.value)}><option value="">Select subscriber</option>{subscribers.map((s) => <option key={s.id} value={s.id}>{s.name || s.subscriber_number} ({s.package_name || "No package"})</option>)}</select></label><label className="field-label">Billing period start<input required type="date" value={form.billing_period_start} onChange={(event) => updateField("billing_period_start", event.target.value)} /></label><label className="field-label">Billing period end<input required type="date" value={form.billing_period_end} onChange={(event) => updateField("billing_period_end", event.target.value)} /></label><label className="field-label">Due date<input required type="date" value={form.due_date} onChange={(event) => updateField("due_date", event.target.value)} /></label></div>{actionError && <p className="field-error" role="alert">{actionError}</p>}<div className="modal-actions"><button type="button" className="button button-outline" onClick={() => setModalOpen(false)} disabled={saving}>Cancel</button><button type="submit" className="button button-dark" disabled={saving}>{saving ? "Generating…" : "Generate invoice"} <ArrowRight size={14} /></button></div></form></section></div>}
    </div>;
}