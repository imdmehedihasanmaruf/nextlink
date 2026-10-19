"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { ApiError } from "@/services/api-client";
import { ispApi, type Technician } from "@/services/isp-api";
import { ArrowDownToLine, ArrowRight, ChevronDown, Pencil, Plus, RefreshCw, Search, Users, Wifi, X } from "lucide-react";

type TechnicianForm = { name: string; email: string; role: string };
const initialForm: TechnicianForm = { name: "", email: "", role: "field_technician" };
const localDate = (date: string) => new Date(`${date}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const formatRole = (value: string) => value.replace("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

export function LiveTechnicians() {
    const [rows, setRows] = useState<Technician[]>([]);
    const [query, setQuery] = useState("");
    const [role, setRole] = useState("");
    const [page, setPage] = useState(1);
    const [pages, setPages] = useState(1);
    const [total, setTotal] = useState(0);
    const [busy, setBusy] = useState(true);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [modalOpen, setModalOpen] = useState(false);
    const [editing, setEditing] = useState<Technician | null>(null);
    const [form, setForm] = useState<TechnicianForm>(initialForm);
    const [saving, setSaving] = useState(false);
    const [actionError, setActionError] = useState("");

    const load = useCallback(async () => {
        setBusy(true); setError("");
        try {
            const result = await ispApi.technicians(query.trim(), page, 20, role);
            setRows(result.items);
            setTotal(result.meta.total);
            setPages(result.meta.last_page ?? Math.max(1, Math.ceil(result.meta.total / result.meta.per_page)));
        } catch (cause) { setError(cause instanceof ApiError ? cause.message : "Could not load technician records."); }
        finally { setBusy(false); }
    }, [query, page, role]);

    useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 180); return () => window.clearTimeout(timer); }, [load]);

    const summary = useMemo(() => ({
        fieldTechs: rows.filter((row) => row.role === "field_technician").length,
        supportStaff: rows.filter((row) => row.role === "support_helpdesk").length,
        totalOpenTickets: rows.reduce((sum, row) => sum + (row.open_tickets || 0), 0),
        totalResolved: rows.reduce((sum, row) => sum + (row.resolved_this_month || 0), 0),
    }), [rows]);

    function openEdit(tech: Technician) {
        setEditing(tech);
        setForm({ name: tech.name, email: tech.email, role: tech.role });
        setActionError("");
        setModalOpen(true);
    }

    function updateField(key: keyof TechnicianForm, value: string) {
        setForm((current) => ({ ...current, [key]: value }));
    }

    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault(); setSaving(true); setActionError(""); setNotice("");
        try {
            await ispApi.updateTechnician(editing!.id, form);
            setModalOpen(false); setNotice("Technician updated successfully.");
            await load();
        } catch (cause) { setActionError(cause instanceof ApiError ? cause.message : "Unable to update technician."); }
        finally { setSaving(false); }
    }

    function exportCsv() {
        const columns = ["ID", "Name", "Email", "Role", "Open Tickets", "Resolved This Month", "Joined"];
        const quote = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
        const lines = [columns, ...rows.map((row) => [row.id, row.name, row.email, row.role, row.open_tickets || 0, row.resolved_this_month || 0, row.created_at ? localDate(row.created_at) : "—"])].map((line) => line.map(quote).join(","));
        const url = URL.createObjectURL(new Blob([lines.join("\r\n")], { type: "text/csv;charset=utf-8" }));
        const anchor = document.createElement("a"); anchor.href = url; anchor.download = `technicians-page-${page}.csv`; anchor.click(); URL.revokeObjectURL(url);
    }

    return <div className="technicians-management">
        <header className="subscriber-page-heading"><div><span className="eyebrow">FIELD MANAGEMENT</span><h1>Technicians</h1><p>Manage field technicians and support staff, track assignments and performance.</p></div><div className="subscriber-heading-actions"><button type="button" className="button button-outline" onClick={exportCsv} disabled={!rows.length}><ArrowDownToLine size={15} /> Export page</button></div></header>
        <div className="subscriber-summary"><article><span><Users size={17} /></span><small>All matching records</small><strong>{total}</strong></article><article><span className="orange"><Wifi size={17} /></span><small>Field technicians</small><strong>{summary.fieldTechs}</strong></article><article><span className="green"><Users size={17} /></span><small>Support staff</small><strong>{summary.supportStaff}</strong></article><article><span className="violet"><RefreshCw size={17} /></span><small>Open tickets (all)</small><strong>{summary.totalOpenTickets}</strong></article></div>
        {notice && <div className="inline-success" role="status">{notice}<button type="button" onClick={() => setNotice("")} aria-label="Dismiss"><X size={15} /></button></div>}
        <section className="data-panel subscriber-table-panel"><div className="data-panel-heading"><div><h2>Team directory</h2><p>{busy ? "Refreshing records…" : `${total} matching technician${total === 1 ? "" : "s"}`}</p></div><button type="button" className="button button-outline" onClick={() => void load()} disabled={busy}><RefreshCw size={14} /> Refresh</button></div>
            <div className="subscriber-filters"><label className="subscriber-search"><Search size={16} /><input value={query} onChange={(event) => { setPage(1); setQuery(event.target.value); }} placeholder="Search name or email…" /></label><label className="subscriber-status-filter"><span>Role</span><select value={role} onChange={(event) => { setPage(1); setRole(event.target.value); }}><option value="">All roles</option><option value="field_technician">Field Technician</option><option value="support_helpdesk">Support/Helpdesk</option></select><ChevronDown size={14} /></label></div>
            {error ? <div role="alert" className="empty-state"><strong>Could not load technicians</strong><p>{error}</p><button type="button" className="button button-outline" onClick={() => void load()}>Try again</button></div> : busy && rows.length === 0 ? <div role="status" className="empty-state">Loading technician records…</div> : rows.length === 0 ? <div className="empty-state"><span><Users size={20} /></span><strong>{query || role ? "No matching technicians" : "No technicians found"}</strong><p>{query || role ? "Change the search or role filter and try again." : "Technicians with field_technician or support_helpdesk roles will appear here."}</p></div> : <div className="table-wrap"><table className="data-table subscriber-table"><thead><tr><th>Technician</th><th>Email</th><th>Role</th><th>Open Tickets</th><th>Resolved This Month</th><th>Joined</th><th /></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><strong>{row.name}</strong><small>ID {row.id}</small></td><td>{row.email}</td><td><span className={`role-badge role-${row.role}`}>{formatRole(row.role)}</span></td><td><strong>{row.open_tickets || 0}</strong></td><td><strong>{row.resolved_this_month || 0}</strong></td><td>{row.created_at ? localDate(row.created_at) : "—"}</td><td><div className="subscriber-row-actions"><button type="button" className="table-icon-button" aria-label={`Edit ${row.name}`} title="Edit" onClick={() => openEdit(row)}><Pencil size={14} /></button></div></td></tr>)}</tbody></table></div>}
            <footer className="subscriber-pagination"><span>Showing {rows.length ? (page - 1) * 20 + 1 : 0}–{Math.min(page * 20, total)} of {total}</span><div><button type="button" disabled={page <= 1 || busy} onClick={() => setPage(page - 1)}>Previous</button><span>Page {page} of {pages}</span><button type="button" disabled={page >= pages || busy} onClick={() => setPage(page + 1)}>Next</button></div></footer>
        </section>
        {modalOpen && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setModalOpen(false); }}><section className="modal-card subscriber-modal" role="dialog" aria-modal="true" aria-labelledby="tech-modal-title"><button type="button" className="modal-close" onClick={() => setModalOpen(false)} aria-label="Close" disabled={saving}><X size={18} /></button><span className="eyebrow">TECHNICIAN DETAILS</span><h2 id="tech-modal-title">Edit technician</h2><p>Update technician information and role.</p><form onSubmit={submit}><div className="subscriber-form-grid"><label className="field-label">Full name<input required maxLength={180} value={form.name} onChange={(event) => updateField("name", event.target.value)} /></label><label className="field-label">Email address<input required type="email" maxLength={255} value={form.email} onChange={(event) => updateField("email", event.target.value)} /></label><label className="field-label">Role<select value={form.role} onChange={(event) => updateField("role", event.target.value)}><option value="field_technician">Field Technician</option><option value="support_helpdesk">Support/Helpdesk</option></select></label></div>{actionError && <p className="field-error" role="alert">{actionError}</p>}<div className="modal-actions"><button type="button" className="button button-outline" onClick={() => setModalOpen(false)} disabled={saving}>Cancel</button><button type="submit" className="button button-dark" disabled={saving}>{saving ? "Saving…" : "Save changes"} <ArrowRight size={14} /></button></div></form></section></div>}
    </div>;
}