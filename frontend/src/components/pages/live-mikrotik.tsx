"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { ApiError } from "@/services/api-client";
import { ispApi, type Router } from "@/services/isp-api";
import { ArrowDownToLine, ArrowRight, ChevronDown, Pencil, Plus, RefreshCw, Search, Trash2, Wifi, X } from "lucide-react";

type RouterForm = { name: string; ip_address: string; username: string; password: string; api_port: number; location: string; description: string };
const initialForm: RouterForm = { name: "", ip_address: "", username: "", password: "", api_port: 8728, location: "", description: "" };
const localDate = (date: string) => new Date(`${date}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const localDateTime = (date: string) => new Date(date).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const formatStatus = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

export function LiveRouters() {
    const [rows, setRows] = useState<Router[]>([]);
    const [query, setQuery] = useState("");
    const [status, setStatus] = useState("");
    const [page, setPage] = useState(1);
    const [pages, setPages] = useState(1);
    const [total, setTotal] = useState(0);
    const [busy, setBusy] = useState(true);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [modalOpen, setModalOpen] = useState(false);
    const [editing, setEditing] = useState<Router | null>(null);
    const [form, setForm] = useState<RouterForm>(initialForm);
    const [saving, setSaving] = useState(false);
    const [actionError, setActionError] = useState("");
    const [syncingId, setSyncingId] = useState<number | null>(null);
    const [deletingId, setDeletingId] = useState<number | null>(null);

    const load = useCallback(async () => {
        setBusy(true); setError("");
        try {
            const result = await ispApi.routers(query.trim(), page, 20, status);
            setRows(result.items);
            setTotal(result.meta.total);
            setPages(result.meta.last_page ?? Math.max(1, Math.ceil(result.meta.total / result.meta.per_page)));
        } catch (cause) { setError(cause instanceof ApiError ? cause.message : "Could not load router records."); }
        finally { setBusy(false); }
    }, [query, page, status]);

    useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 180); return () => window.clearTimeout(timer); }, [load]);

    const summary = useMemo(() => ({
        online: rows.filter((row) => row.status === "online").length,
        offline: rows.filter((row) => row.status === "offline").length,
        error: rows.filter((row) => row.status === "error").length,
    }), [rows]);

    function openCreate() {
        setEditing(null);
        setForm(initialForm);
        setActionError("");
        setModalOpen(true);
    }

    function openEdit(router: Router) {
        setEditing(router);
        setForm({
            name: router.name,
            ip_address: router.ip_address,
            username: router.username,
            password: "", // Don't show password
            api_port: router.api_port,
            location: router.location || "",
            description: router.description || "",
        });
        setActionError("");
        setModalOpen(true);
    }

    function updateField(key: keyof RouterForm, value: string | number) {
        setForm((current) => ({ ...current, [key]: value }));
    }

    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault(); setSaving(true); setActionError(""); setNotice("");
        const payload = {
            name: form.name.trim(),
            ip_address: form.ip_address.trim(),
            username: form.username.trim(),
            password: form.password,
            api_port: form.api_port,
            location: form.location.trim() || undefined,
            description: form.description.trim() || undefined,
        };
        try {
            if (editing) {
                // Only include password if changed
                const updatePayload: Record<string, unknown> = { ...payload };
                if (!form.password) delete updatePayload.password;
                await ispApi.updateRouter(editing.id, updatePayload);
                setNotice("Router updated successfully.");
            } else {
                await ispApi.createRouter(payload);
                setNotice("Router added successfully.");
            }
            setModalOpen(false); await load();
        } catch (cause) { setActionError(cause instanceof ApiError ? cause.message : "Unable to save router."); }
        finally { setSaving(false); }
    }

    async function sync(router: Router) {
        setSyncingId(router.id); setNotice("");
        try {
            await ispApi.syncRouter(router.id);
            setNotice("Router synchronized successfully.");
            await load();
        } catch (cause) { setError(cause instanceof ApiError ? cause.message : "Unable to sync router."); }
        finally { setSyncingId(null); }
    }

    async function remove(router: Router) {
        const confirmed = window.confirm(`Delete router "${router.name}"? This will remove it from monitoring.`);
        if (!confirmed) return;
        setDeletingId(router.id); setNotice("");
        try {
            await ispApi.deleteRouter(router.id);
            setNotice("Router removed.");
            if (rows.length === 1 && page > 1) setPage(page - 1); else await load();
        } catch (cause) { setError(cause instanceof ApiError ? cause.message : "Unable to remove router."); }
        finally { setDeletingId(null); }
    }

    function exportCsv() {
        const columns = ["ID", "Name", "IP Address", "Location", "Status", "Last Sync", "Created"];
        const quote = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
        const lines = [columns, ...rows.map((row) => [row.id, row.name, row.ip_address, row.location || "—", row.status, row.last_sync ? localDateTime(row.last_sync) : "Never", row.created_at ? localDate(row.created_at) : "—"])].map((line) => line.map(quote).join(","));
        const url = URL.createObjectURL(new Blob([lines.join("\r\n")], { type: "text/csv;charset=utf-8" }));
        const anchor = document.createElement("a"); anchor.href = url; anchor.download = `routers-page-${page}.csv`; anchor.click(); URL.revokeObjectURL(url);
    }

    return <div className="routers-management">
        <header className="subscriber-page-heading"><div><span className="eyebrow">ROUTER MANAGEMENT</span><h1>MikroTik Routers</h1><p>Manage and monitor MikroTik routers in your network infrastructure.</p></div><div className="subscriber-heading-actions"><button type="button" className="button button-outline" onClick={exportCsv} disabled={!rows.length}><ArrowDownToLine size={15} /> Export page</button><button type="button" className="button button-dark" onClick={openCreate}><Plus size={15} /> Add router</button></div></header>
        <div className="subscriber-summary"><article><span><Wifi size={17} /></span><small>All matching records</small><strong>{total}</strong></article><article><span className="green"><Wifi size={17} /></span><small>Online</small><strong>{summary.online}</strong></article><article><span className="orange"><Wifi size={17} /></span><small>Offline</small><strong>{summary.offline}</strong></article><article><span className="violet"><Wifi size={17} /></span><small>Error</small><strong>{summary.error}</strong></article></div>
        {notice && <div className="inline-success" role="status">{notice}<button type="button" onClick={() => setNotice("")} aria-label="Dismiss"><X size={15} /></button></div>}
        {error && <div className="inline-error" role="alert">{error}<button type="button" onClick={() => setError("")} aria-label="Dismiss"><X size={15} /></button></div>}
        <section className="data-panel subscriber-table-panel"><div className="data-panel-heading"><div><h2>Router inventory</h2><p>{busy ? "Refreshing records…" : `${total} matching router${total === 1 ? "" : "s"}`}</p></div><button type="button" className="button button-outline" onClick={() => void load()} disabled={busy}><RefreshCw size={14} /> Refresh</button></div>
            <div className="subscriber-filters"><label className="subscriber-search"><Search size={16} /><input value={query} onChange={(event) => { setPage(1); setQuery(event.target.value); }} placeholder="Search name, IP, location…" /></label><label className="subscriber-status-filter"><span>Status</span><select value={status} onChange={(event) => { setPage(1); setStatus(event.target.value); }}><option value="">All statuses</option><option value="online">Online</option><option value="offline">Offline</option><option value="error">Error</option></select><ChevronDown size={14} /></label></div>
            {error && !notice ? <div role="alert" className="empty-state"><strong>Could not load routers</strong><p>{error}</p><button type="button" className="button button-outline" onClick={() => void load()}>Try again</button></div> : busy && rows.length === 0 ? <div role="status" className="empty-state">Loading router records…</div> : rows.length === 0 ? <div className="empty-state"><span><Wifi size={20} /></span><strong>{query || status ? "No matching routers" : "No routers configured"}</strong><p>{query || status ? "Change the search or status filter and try again." : "Add a MikroTik router to start monitoring your network."}</p>{!query && !status && <button type="button" className="button button-dark" onClick={openCreate}><Plus size={14} /> Add router</button>}</div> : <div className="table-wrap"><table className="data-table subscriber-table"><thead><tr><th>Router</th><th>IP Address</th><th>Location</th><th>Status</th><th>Last Sync</th><th>Actions</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><strong>{row.name}</strong><small>ID {row.id}</small></td><td><code>{row.ip_address}:{row.api_port}</code></td><td>{row.location || "—"}</td><td><span className={`status-badge status-${row.status}`}>{formatStatus(row.status)}</span></td><td>{row.last_sync ? localDateTime(row.last_sync) : <span className="muted-text">Never</span>}</td><td><div className="subscriber-row-actions"><button type="button" className="table-icon-button" aria-label={`Sync ${row.name}`} title="Sync" onClick={() => sync(row)} disabled={syncingId === row.id}><RefreshCw size={14} className={syncingId === row.id ? "spin" : ""} /></button><button type="button" className="table-icon-button" aria-label={`Edit ${row.name}`} title="Edit" onClick={() => openEdit(row)}><Pencil size={14} /></button><button type="button" className="table-icon-button danger" aria-label={`Delete ${row.name}`} title="Delete" disabled={deletingId === row.id}><Trash2 size={14} /></button></div></td></tr>)}</tbody></table></div>}
            <footer className="subscriber-pagination"><span>Showing {rows.length ? (page - 1) * 20 + 1 : 0}–{Math.min(page * 20, total)} of {total}</span><div><button type="button" disabled={page <= 1 || busy} onClick={() => setPage(page - 1)}>Previous</button><span>Page {page} of {pages}</span><button type="button" disabled={page >= pages || busy} onClick={() => setPage(page + 1)}>Next</button></div></footer>
        </section>
        {modalOpen && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setModalOpen(false); }}><section className="modal-card subscriber-modal" role="dialog" aria-modal="true" aria-labelledby="router-modal-title"><button type="button" className="modal-close" onClick={() => setModalOpen(false)} aria-label="Close" disabled={saving}><X size={18} /></button><span className="eyebrow">ROUTER CONFIGURATION</span><h2 id="router-modal-title">{editing ? "Edit router" : "Add router"}</h2><p>{editing ? "Update router connection settings." : "Add a new MikroTik router to monitor."}</p><form onSubmit={submit}><div className="subscriber-form-grid"><label className="field-label">Router name<input required maxLength={100} value={form.name} onChange={(event) => updateField("name", event.target.value)} placeholder="e.g., Core Router 01" /></label><label className="field-label">IP address<input required type="text" maxLength={45} value={form.ip_address} onChange={(event) => updateField("ip_address", event.target.value)} placeholder="e.g., 192.168.1.1" /></label><label className="field-label">API port<input required type="number" min={1} max={65535} value={form.api_port} onChange={(event) => updateField("api_port", parseInt(event.target.value) || 8728)} /></label><label className="field-label">Username<input required maxLength={100} value={form.username} onChange={(event) => updateField("username", event.target.value)} /></label><label className="field-label">{editing ? "New password (leave blank to keep)" : "Password"}<input type="password" maxLength={255} value={form.password} onChange={(event) => updateField("password", event.target.value)} placeholder={editing ? "••••••••" : "Required"} required={!editing} /></label><label className="field-label">Location<input maxLength={200} value={form.location} onChange={(event) => updateField("location", event.target.value)} placeholder="e.g., Dhanmondi POP" /></label><label className="field-label field-full">Description<textarea rows={2} maxLength={500} value={form.description} onChange={(event) => updateField("description", event.target.value)} placeholder="Optional notes about this router" /></label></div>{actionError && <p className="field-error" role="alert">{actionError}</p>}<div className="modal-actions"><button type="button" className="button button-outline" onClick={() => setModalOpen(false)} disabled={saving}>Cancel</button><button type="submit" className="button button-dark" disabled={saving}>{saving ? "Saving…" : "Save router"} <ArrowRight size={14} /></button></div></form></section></div>}
    </div>;
}