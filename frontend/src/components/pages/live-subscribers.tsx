"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { ApiError } from "@/services/api-client";
import { ispApi, type Package, type Subscriber } from "@/services/isp-api";
import { ArrowDownToLine, ArrowRight, ChevronDown, CircleAlert, Pencil, Plus, RefreshCw, Search, Trash2, Users, Wifi, X } from "lucide-react";

type SubscriberForm = { name: string; email: string; phone: string; address: string; connection_type: string; status: string; package_id: string };
const initialForm: SubscriberForm = { name: "", email: "", phone: "", address: "", connection_type: "pppoe", status: "pending", package_id: "" };
const formatStatus = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

export function LiveSubscribers() {
    const [rows, setRows] = useState<Subscriber[]>([]);
    const [packages, setPackages] = useState<Package[]>([]);
    const [query, setQuery] = useState("");
    const [status, setStatus] = useState("");
    const [page, setPage] = useState(1);
    const [pages, setPages] = useState(1);
    const [total, setTotal] = useState(0);
    const [busy, setBusy] = useState(true);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [modalOpen, setModalOpen] = useState(false);
    const [editing, setEditing] = useState<Subscriber | null>(null);
    const [form, setForm] = useState<SubscriberForm>(initialForm);
    const [saving, setSaving] = useState(false);
    const [actionError, setActionError] = useState("");
    const [deletingId, setDeletingId] = useState<number | null>(null);

    const load = useCallback(async () => {
        setBusy(true); setError("");
        try {
            const result = await ispApi.subscribers(query.trim(), page, 20, status);
            setRows(result.items);
            setTotal(result.meta.total);
            setPages(result.meta.last_page ?? Math.max(1, Math.ceil(result.meta.total / result.meta.per_page)));
        } catch (cause) { setError(cause instanceof ApiError ? cause.message : "Could not load subscriber records."); }
        finally { setBusy(false); }
    }, [query, page, status]);

    useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 180); return () => window.clearTimeout(timer); }, [load]);
    useEffect(() => { ispApi.packages().then((result) => setPackages(result.items.filter((item) => item.is_active))).catch(() => setPackages([])); }, []);

    const summary = useMemo(() => ({
        active: rows.filter((row) => row.status === "active").length,
        pending: rows.filter((row) => row.status === "pending").length,
        suspended: rows.filter((row) => row.status === "suspended").length,
    }), [rows]);

    function openCreate() { setEditing(null); setForm(initialForm); setActionError(""); setModalOpen(true); }
    function openEdit(row: Subscriber) { setEditing(row); setForm({ name: row.name ?? "", email: row.email ?? "", phone: row.phone ?? "", address: row.address ?? "", connection_type: row.connection_type, status: row.status, package_id: row.package_id ? String(row.package_id) : "" }); setActionError(""); setModalOpen(true); }
    function updateField(key: keyof SubscriberForm, value: string) { setForm((current) => ({ ...current, [key]: value })); }

    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault(); setSaving(true); setActionError(""); setNotice("");
        const payload = { name: form.name.trim(), email: form.email.trim(), phone: form.phone.trim() || undefined, address: form.address.trim() || undefined, connection_type: form.connection_type, status: form.status, ...(form.package_id ? { package_id: Number(form.package_id) } : {}) };
        try {
            if (editing) await ispApi.updateSubscriber(editing.id, payload);
            else await ispApi.createSubscriber(payload);
            setModalOpen(false); setNotice(editing ? "Subscriber details updated." : "Subscriber account created.");
            await load();
        } catch (cause) { setActionError(cause instanceof ApiError ? cause.message : "Unable to save subscriber."); }
        finally { setSaving(false); }
    }

    async function remove(row: Subscriber) {
        const confirmed = window.confirm(`Delete ${row.name || row.subscriber_number}? This will remove the subscriber account and related data.`);
        if (!confirmed) return;
        setDeletingId(row.id); setNotice(""); setError("");
        try { await ispApi.deleteSubscriber(row.id); setNotice("Subscriber deleted."); if (rows.length === 1 && page > 1) setPage(page - 1); else await load(); }
        catch (cause) { setError(cause instanceof ApiError ? cause.message : "Unable to delete subscriber."); }
        finally { setDeletingId(null); }
    }

    function exportCsv() {
        const columns = ["Subscriber number", "Name", "Email", "Phone", "Address", "Connection", "Package", "Status"];
        const quote = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
        const lines = [columns, ...rows.map((row) => [row.subscriber_number, row.name, row.email, row.phone, row.address, row.connection_type, row.package_name, row.status])].map((line) => line.map(quote).join(","));
        const url = URL.createObjectURL(new Blob([lines.join("\r\n")], { type: "text/csv;charset=utf-8" }));
        const anchor = document.createElement("a"); anchor.href = url; anchor.download = `subscribers-page-${page}.csv`; anchor.click(); URL.revokeObjectURL(url);
    }

    return <div className="subscriber-management">
        <header className="subscriber-page-heading"><div><span className="eyebrow">CUSTOMER MANAGEMENT</span><h1>Subscribers</h1><p>Search, review, create, and update subscriber accounts.</p></div><div className="subscriber-heading-actions"><button type="button" className="button button-outline" onClick={exportCsv} disabled={!rows.length}><ArrowDownToLine size={15} /> Export page</button><button type="button" className="button button-dark" onClick={openCreate}><Plus size={15} /> Add subscriber</button></div></header>
        <div className="subscriber-summary"><article><span><Users size={17} /></span><small>All matching records</small><strong>{total}</strong></article><article><span className="green"><Wifi size={17} /></span><small>Active on this page</small><strong>{summary.active}</strong></article><article><span className="orange"><CircleAlert size={17} /></span><small>Pending on this page</small><strong>{summary.pending}</strong></article><article><span className="violet"><Wifi size={17} /></span><small>Suspended on this page</small><strong>{summary.suspended}</strong></article></div>
        {notice && <div className="inline-success" role="status">{notice}<button type="button" onClick={() => setNotice("")} aria-label="Dismiss"><X size={15} /></button></div>}
        <section className="data-panel subscriber-table-panel"><div className="data-panel-heading"><div><h2>Subscriber directory</h2><p>{busy ? "Refreshing records…" : `${total} matching account${total === 1 ? "" : "s"}`}</p></div><button type="button" className="button button-outline" onClick={() => void load()} disabled={busy}><RefreshCw size={14} /> Refresh</button></div>
            <div className="subscriber-filters"><label className="subscriber-search"><Search size={16} /><input value={query} onChange={(event) => { setPage(1); setQuery(event.target.value); }} placeholder="Search name, email, number, phone…" /></label><label className="subscriber-status-filter"><span>Status</span><select value={status} onChange={(event) => { setPage(1); setStatus(event.target.value); }}><option value="">All statuses</option><option value="active">Active</option><option value="pending">Pending</option><option value="suspended">Suspended</option></select><ChevronDown size={14} /></label><label className="subscriber-page-size"><span>Rows</span><select aria-label="Rows per page" value="20" disabled><option value="20">20</option></select></label></div>
            {error ? <div role="alert" className="empty-state"><strong>Could not load subscriber records</strong><p>{error}</p><button type="button" className="button button-outline" onClick={() => void load()}>Try again</button></div> : busy && rows.length === 0 ? <div role="status" className="empty-state">Loading subscriber records…</div> : rows.length === 0 ? <div className="empty-state"><span><Users size={20} /></span><strong>{query || status ? "No matching subscribers" : "No subscriber accounts yet"}</strong><p>{query || status ? "Change the search or status filter and try again." : "Create a subscriber account to start managing connections."}</p>{!query && !status && <button type="button" className="button button-dark" onClick={openCreate}><Plus size={14} /> Add subscriber</button>}</div> : <div className="table-wrap"><table className="data-table subscriber-table"><thead><tr><th>Subscriber</th><th>Contact</th><th>Service & location</th><th>Connection</th><th>Status</th><th>Actions</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><strong>{row.name || "Name missing"}</strong><small>{row.subscriber_number || `ID ${row.id}`}</small></td><td>{row.email || "—"}<small>{row.phone || "Phone not set"}</small></td><td><strong>{row.package_name || "No package"}</strong><small>{row.address || "Address not set"}</small></td><td><span className="connection-type-pill">{row.connection_type === "static_ip" ? "Static IP" : "PPPoE"}</span>{row.ip_address && <small>{row.ip_address}</small>}</td><td><span className={`status-badge status-${row.status.toLowerCase()}`}>{formatStatus(row.status)}</span></td><td><div className="subscriber-row-actions"><button type="button" className="table-icon-button" aria-label={`Edit ${row.name || row.subscriber_number}`} title="Edit" onClick={() => openEdit(row)}><Pencil size={14} /></button><button type="button" className="table-icon-button danger" aria-label={`Delete ${row.name || row.subscriber_number}`} title="Delete" disabled={deletingId === row.id} onClick={() => void remove(row)}>{deletingId === row.id ? <RefreshCw size={14} /> : <Trash2 size={14} />}</button></div></td></tr>)}</tbody></table></div>}
            <footer className="subscriber-pagination"><span>Showing {rows.length ? (page - 1) * 20 + 1 : 0}–{Math.min(page * 20, total)} of {total}</span><div><button type="button" disabled={page <= 1 || busy} onClick={() => setPage(page - 1)}>Previous</button><span>Page {page} of {pages}</span><button type="button" disabled={page >= pages || busy} onClick={() => setPage(page + 1)}>Next</button></div></footer>
        </section>
        {modalOpen && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setModalOpen(false); }}><section className="modal-card subscriber-modal" role="dialog" aria-modal="true" aria-labelledby="subscriber-modal-title"><button type="button" className="modal-close" onClick={() => setModalOpen(false)} aria-label="Close" disabled={saving}><X size={18} /></button><span className="eyebrow">SUBSCRIBER ACCOUNT</span><h2 id="subscriber-modal-title">{editing ? "Edit subscriber" : "Add subscriber"}</h2><p>{editing ? `Update ${editing.subscriber_number}'s account information.` : "Create a login and service profile for a new subscriber."}</p><form onSubmit={submit}><div className="subscriber-form-grid"><label className="field-label">Full name<input required maxLength={255} value={form.name} onChange={(event) => updateField("name", event.target.value)} /></label><label className="field-label">Email address<input required type="email" maxLength={255} value={form.email} onChange={(event) => updateField("email", event.target.value)} /></label><label className="field-label">Phone<input maxLength={32} value={form.phone} onChange={(event) => updateField("phone", event.target.value)} /></label><label className="field-label">Connection type<select value={form.connection_type} onChange={(event) => updateField("connection_type", event.target.value)}><option value="pppoe">PPPoE</option><option value="static_ip">Static IP</option></select></label><label className="field-label field-full">Address<textarea rows={2} maxLength={2000} value={form.address} onChange={(event) => updateField("address", event.target.value)} /></label>{!editing && <label className="field-label">Package<select value={form.package_id} onChange={(event) => updateField("package_id", event.target.value)}><option value="">No package assigned</option>{packages.map((item) => <option key={item.id} value={item.id}>{item.name} · ৳{Number(item.price_monthly).toLocaleString("en-BD")}/mo</option>)}</select></label>}<label className="field-label">Status<select value={form.status} onChange={(event) => updateField("status", event.target.value)}><option value="pending">Pending</option><option value="active">Active</option><option value="suspended">Suspended</option></select></label></div>{actionError && <p role="alert" className="profile-message error">{actionError}</p>}<div className="subscriber-modal-actions"><button type="button" className="button button-outline" onClick={() => setModalOpen(false)} disabled={saving}>Cancel</button><button type="submit" className="button button-dark" disabled={saving}>{saving ? "Saving…" : editing ? "Save changes" : "Create subscriber"}<ArrowRight size={14} /></button></div></form></section></div>}
    </div>;
}
