"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { ApiError } from "@/services/api-client";
import { ispApi, type User } from "@/services/isp-api";
import { ArrowDownToLine, ArrowRight, ChevronDown, Eye, Pencil, Plus, RefreshCw, Search, ShieldCheck, Trash2, Users, X } from "lucide-react";

type StaffForm = { name: string; email: string; role: string };
const initialForm: StaffForm = { name: "", email: "", role: "support_helpdesk" };
const formatRole = (value: string) => value.replace("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const formatStatus = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

export function LiveStaff() {
    const [rows, setRows] = useState<User[]>([]);
    const [query, setQuery] = useState("");
    const [role, setRole] = useState("");
    const [page, setPage] = useState(1);
    const [pages, setPages] = useState(1);
    const [total, setTotal] = useState(0);
    const [busy, setBusy] = useState(true);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [modalOpen, setModalOpen] = useState(false);
    const [editing, setEditing] = useState<User | null>(null);
    const [form, setForm] = useState<StaffForm>(initialForm);
    const [saving, setSaving] = useState(false);
    const [actionError, setActionError] = useState("");

    const load = useCallback(async () => {
        setBusy(true); setError("");
        try {
            const result = await ispApi.staff(query.trim(), page, 20, role);
            setRows(result.items);
            setTotal(result.meta.total);
            setPages(result.meta.last_page ?? Math.max(1, Math.ceil(result.meta.total / result.meta.per_page)));
        } catch (cause) { setError(cause instanceof ApiError ? cause.message : "Could not load staff records."); }
        finally { setBusy(false); }
    }, [query, page, role]);

    useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 180); return () => window.clearTimeout(timer); }, [load]);

    const summary = useMemo(() => ({
        superAdmin: rows.filter((row) => row.role === "super_admin").length,
        accounts: rows.filter((row) => row.role === "accounts_billing").length,
        support: rows.filter((row) => ["support_helpdesk", "field_technician"].includes(row.role)).length,
    }), [rows]);

    function openEdit(user: User) {
        setEditing(user);
        setForm({ name: user.name, email: user.email, role: user.role });
        setActionError("");
        setModalOpen(true);
    }

    function updateField(key: keyof StaffForm, value: string) {
        setForm((current) => ({ ...current, [key]: value }));
    }

    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault(); setSaving(true); setActionError(""); setNotice("");
        try {
            if (editing) {
                await ispApi.updateUser(editing.id, form);
                setNotice("Staff member updated successfully.");
            } else {
                await ispApi.createUser(form);
                setNotice("Staff member created successfully.");
            }
            setModalOpen(false); await load();
        } catch (cause) { setActionError(cause instanceof ApiError ? cause.message : "Unable to save staff member."); }
        finally { setSaving(false); }
    }

    function exportCsv() {
        const columns = ["ID", "Name", "Email", "Role", "Status", "Created"];
        const quote = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
        const lines = [columns, ...rows.map((row) => [row.id, row.name, row.email, row.role, "Active", row.created_at ? new Date(row.created_at).toLocaleDateString("en-GB") : "—"])].map((line) => line.map(quote).join(","));
        const url = URL.createObjectURL(new Blob([lines.join("\r\n")], { type: "text/csv;charset=utf-8" }));
        const anchor = document.createElement("a"); anchor.href = url; anchor.download = `staff-page-${page}.csv`; anchor.click(); URL.revokeObjectURL(url);
    }

    return <div className="staff-management">
        <header className="subscriber-page-heading"><div><span className="eyebrow">USER MANAGEMENT</span><h1>Staff & Roles</h1><p>Manage admin users, support staff, and their permissions.</p></div><div className="subscriber-heading-actions"><button type="button" className="button button-outline" onClick={exportCsv} disabled={!rows.length}><ArrowDownToLine size={15} /> Export page</button><button type="button" className="button button-dark" onClick={() => { setEditing(null); setForm(initialForm); setActionError(""); setModalOpen(true); }}><Plus size={15} /> Add staff</button></div></header>
        <div className="subscriber-summary"><article><span><Users size={17} /></span><small>All matching records</small><strong>{total}</strong></article><article><span className="violet"><ShieldCheck size={17} /></span><small>Super admins</small><strong>{summary.superAdmin}</strong></article><article><span className="green"><Users size={17} /></span><small>Accounts/Billing</small><strong>{summary.accounts}</strong></article><article><span className="orange"><Users size={17} /></span><small>Support/Field</small><strong>{summary.support}</strong></article></div>
        {notice && <div className="inline-success" role="status">{notice}<button type="button" onClick={() => setNotice("")} aria-label="Dismiss"><X size={15} /></button></div>}
        <section className="data-panel subscriber-table-panel"><div className="data-panel-heading"><div><h2>Staff directory</h2><p>{busy ? "Refreshing records…" : `${total} matching staff${total === 1 ? "" : "s"}`}</p></div><button type="button" className="button button-outline" onClick={() => void load()} disabled={busy}><RefreshCw size={14} /> Refresh</button></div>
            <div className="subscriber-filters"><label className="subscriber-search"><Search size={16} /><input value={query} onChange={(event) => { setPage(1); setQuery(event.target.value); }} placeholder="Search name or email…" /></label><label className="subscriber-status-filter"><span>Role</span><select value={role} onChange={(event) => { setPage(1); setRole(event.target.value); }}><option value="">All roles</option><option value="super_admin">Super Admin</option><option value="accounts_billing">Accounts/Billing</option><option value="support_helpdesk">Support/Helpdesk</option><option value="field_technician">Field Technician</option></select><ChevronDown size={14} /></label></div>
            {error ? <div role="alert" className="empty-state"><strong>Could not load staff records</strong><p>{error}</p><button type="button" className="button button-outline" onClick={() => void load()}>Try again</button></div> : busy && rows.length === 0 ? <div role="status" className="empty-state">Loading staff records…</div> : rows.length === 0 ? <div className="empty-state"><span><Users size={20} /></span><strong>{query || role ? "No matching staff" : "No staff members found"}</strong><p>{query || role ? "Change the search or role filter and try again." : "Add staff members to manage your ISP operations."}</p>{!query && !role && <button type="button" className="button button-dark" onClick={() => { setEditing(null); setForm(initialForm); setModalOpen(true); }}><Plus size={14} /> Add staff</button>}</div> : <div className="table-wrap"><table className="data-table subscriber-table"><thead><tr><th>User</th><th>Email</th><th>Role</th><th>Permissions</th><th /></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><strong>{row.name}</strong><small>ID {row.id}</small></td><td>{row.email}</td><td><span className={`role-badge role-${row.role}`}>{formatRole(row.role)}</span></td><td><small className="muted-text">{getRolePermissions(row.role)}</small></td><td><div className="subscriber-row-actions"><button type="button" className="table-icon-button" aria-label={`Edit ${row.name}`} title="Edit" onClick={() => openEdit(row)}><Pencil size={14} /></button></div></td></tr>)}</tbody></table></div>}
            <footer className="subscriber-pagination"><span>Showing {rows.length ? (page - 1) * 20 + 1 : 0}–{Math.min(page * 20, total)} of {total}</span><div><button type="button" disabled={page <= 1 || busy} onClick={() => setPage(page - 1)}>Previous</button><span>Page {page} of {pages}</span><button type="button" disabled={page >= pages || busy} onClick={() => setPage(page + 1)}>Next</button></div></footer>
        </section>
        {modalOpen && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setModalOpen(false); }}><section className="modal-card subscriber-modal" role="dialog" aria-modal="true" aria-labelledby="staff-modal-title"><button type="button" className="modal-close" onClick={() => setModalOpen(false)} aria-label="Close" disabled={saving}><X size={18} /></button><span className="eyebrow">STAFF ACCOUNT</span><h2 id="staff-modal-title">{editing ? "Edit staff member" : "Add staff member"}</h2><p>{editing ? "Update staff details and permissions." : "Create a new staff account."}</p><form onSubmit={submit}><div className="subscriber-form-grid"><label className="field-label">Full name<input required maxLength={180} value={form.name} onChange={(event) => updateField("name", event.target.value)} /></label><label className="field-label">Email address<input required type="email" maxLength={255} value={form.email} onChange={(event) => updateField("email", event.target.value)} /></label><label className="field-label">Role<select value={form.role} onChange={(event) => updateField("role", event.target.value)}><option value="super_admin">Super Admin (Full access)</option><option value="accounts_billing">Accounts/Billing (Invoices & payments)</option><option value="support_helpdesk">Support/Helpdesk (Tickets & tickets)</option><option value="field_technician">Field Technician (Assigned tickets)</option></select></label></div>{actionError && <p className="field-error" role="alert">{actionError}</p>}<div className="modal-actions"><button type="button" className="button button-outline" onClick={() => setModalOpen(false)} disabled={saving}>Cancel</button><button type="submit" className="button button-dark" disabled={saving}>{saving ? "Saving…" : "Save staff"} <ArrowRight size={14} /></button></div></form></section></div>}
    </div>;
}

function getRolePermissions(role: string): string {
    switch (role) {
        case "super_admin": return "Full system access";
        case "accounts_billing": return "Invoices & payments";
        case "support_helpdesk": return "Tickets & subscribers";
        case "field_technician": return "Assigned tickets only";
        default: return "Limited access";
    }
}