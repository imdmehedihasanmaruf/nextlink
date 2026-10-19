"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { ApiError } from "@/services/api-client";
import { ispApi, type Package } from "@/services/isp-api";
import { ArrowDownToLine, ArrowRight, Boxes, CheckCircle2, ChevronDown, Pencil, Plus, RefreshCw, Search, ToggleLeft, ToggleRight, X } from "lucide-react";

type PackageForm = { name: string; description: string; download_mbps: string; upload_mbps: string; bdix_mbps: string; price_monthly: string; installation_fee: string; features: string; is_active: boolean };
const emptyForm: PackageForm = { name: "", description: "", download_mbps: "", upload_mbps: "", bdix_mbps: "", price_monthly: "", installation_fee: "0", features: "", is_active: true };
const money = (value: string | number) => `৳${Number(value).toLocaleString("en-BD")}`;

export function LivePackages() {
    const [items, setItems] = useState<Package[]>([]);
    const [query, setQuery] = useState("");
    const [activeFilter, setActiveFilter] = useState("all");
    const [page, setPage] = useState(1);
    const [pages, setPages] = useState(1);
    const [total, setTotal] = useState(0);
    const [busy, setBusy] = useState(true);
    const [error, setError] = useState("");
    const [message, setMessage] = useState("");
    const [modal, setModal] = useState(false);
    const [editing, setEditing] = useState<Package | null>(null);
    const [form, setForm] = useState<PackageForm>(emptyForm);
    const [saving, setSaving] = useState(false);
    const [formError, setFormError] = useState("");

    const load = useCallback(async () => {
        setBusy(true); setError("");
        try {
            const result = await ispApi.packages(page, 20, query.trim(), activeFilter === "all" ? undefined : activeFilter === "active");
            setItems(result.items); setTotal(result.meta.total); setPages(result.meta.last_page ?? Math.max(1, Math.ceil(result.meta.total / result.meta.per_page)));
        } catch (cause) { setError(cause instanceof ApiError ? cause.message : "Could not load packages."); }
        finally { setBusy(false); }
    }, [activeFilter, page, query]);

    useEffect(() => { const timeout = window.setTimeout(() => { void load(); }, 180); return () => window.clearTimeout(timeout); }, [load]);

    function beginCreate() { setEditing(null); setForm(emptyForm); setFormError(""); setModal(true); }
    function beginEdit(item: Package) { setEditing(item); setForm({ name: item.name, description: item.description ?? "", download_mbps: String(item.download_mbps), upload_mbps: String(item.upload_mbps), bdix_mbps: item.bdix_mbps == null ? "" : String(item.bdix_mbps), price_monthly: String(item.price_monthly), installation_fee: String(item.installation_fee), features: (item.features ?? []).join("\n"), is_active: item.is_active }); setFormError(""); setModal(true); }
    function set<K extends keyof PackageForm>(key: K, value: PackageForm[K]) { setForm((current) => ({ ...current, [key]: value })); }

    async function save(event: FormEvent<HTMLFormElement>) {
        event.preventDefault(); setSaving(true); setFormError(""); setMessage("");
        const payload = { name: form.name.trim(), description: form.description.trim() || null, download_mbps: Number(form.download_mbps), upload_mbps: Number(form.upload_mbps), bdix_mbps: form.bdix_mbps ? Number(form.bdix_mbps) : null, price_monthly: form.price_monthly, installation_fee: form.installation_fee || "0", features: form.features.split("\n").map((line) => line.trim()).filter(Boolean), is_active: form.is_active };
        try {
            if (editing) await ispApi.updatePackage(editing.id, payload);
            else await ispApi.createPackage(payload);
            setModal(false); setMessage(editing ? "Package updated." : "Package created."); await load();
        } catch (cause) { setFormError(cause instanceof ApiError ? cause.message : "Could not save package."); }
        finally { setSaving(false); }
    }

    async function toggleActive(item: Package) {
        setMessage(""); setError("");
        try { await ispApi.updatePackage(item.id, { is_active: !item.is_active }); setMessage(`${item.name} ${item.is_active ? "deactivated" : "activated"}.`); await load(); }
        catch (cause) { setError(cause instanceof ApiError ? cause.message : "Could not change package status."); }
    }

    function exportCsv() {
        const header = ["Name", "Download Mbps", "Upload Mbps", "BDIX Mbps", "Monthly price", "Installation fee", "Subscribers", "Status"];
        const quote = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
        const content = [header, ...items.map((item) => [item.name, item.download_mbps, item.upload_mbps, item.bdix_mbps, item.price_monthly, item.installation_fee, item.subscriber_count ?? 0, item.is_active ? "Active" : "Inactive"])].map((row) => row.map(quote).join(",")).join("\r\n");
        const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" })); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `packages-page-${page}.csv`; anchor.click(); URL.revokeObjectURL(url);
    }

    return <div className="package-management">
        <header className="package-page-heading"><div><span className="eyebrow">SERVICE CATALOGUE</span><h1>Internet packages</h1><p>Configure plan speeds, pricing, features, and customer availability.</p></div><div><button type="button" className="button button-outline" onClick={exportCsv} disabled={!items.length}><ArrowDownToLine size={15} /> Export page</button><button type="button" className="button button-dark" onClick={beginCreate}><Plus size={15} /> Add package</button></div></header>
        <div className="package-summary"><article><span><Boxes size={17} /></span><small>Matching packages</small><strong>{total}</strong></article><article><span className="green"><CheckCircle2 size={17} /></span><small>Active on this page</small><strong>{items.filter((item) => item.is_active).length}</strong></article><article><span className="violet"><Boxes size={17} /></span><small>Subscribers on this page</small><strong>{items.reduce((sum, item) => sum + Number(item.subscriber_count ?? 0), 0)}</strong></article></div>
        {message && <div className="inline-success" role="status">{message}<button type="button" onClick={() => setMessage("")} aria-label="Dismiss"><X size={15} /></button></div>}
        <section className="data-panel package-table-panel"><div className="data-panel-heading"><div><h2>Package catalogue</h2><p>{busy ? "Refreshing packages…" : `${total} package${total === 1 ? "" : "s"} found`}</p></div><button type="button" className="button button-outline" onClick={() => void load()} disabled={busy}><RefreshCw size={14} /> Refresh</button></div>
            <div className="package-filters"><label><Search size={16} /><input value={query} onChange={(event) => { setPage(1); setQuery(event.target.value); }} placeholder="Search package name or description…" /></label><div><span>Status</span><select value={activeFilter} onChange={(event) => { setPage(1); setActiveFilter(event.target.value); }}><option value="all">All packages</option><option value="active">Active</option><option value="inactive">Inactive</option></select><ChevronDown size={14} /></div></div>
            {error ? <div className="empty-state" role="alert"><strong>Could not load packages</strong><p>{error}</p><button className="button button-outline" onClick={() => void load()}>Try again</button></div> : busy && !items.length ? <div className="empty-state" role="status">Loading packages…</div> : !items.length ? <div className="empty-state"><span><Boxes size={20} /></span><strong>{query || activeFilter !== "all" ? "No matching packages" : "No packages configured"}</strong><p>{query || activeFilter !== "all" ? "Try another search or status filter." : "Create an internet plan to make it available in the service catalogue."}</p>{!query && <button className="button button-dark" onClick={beginCreate}><Plus size={14} /> Add package</button>}</div> : <div className="table-wrap"><table className="data-table package-table"><thead><tr><th>Package</th><th>Speed</th><th>BDIX</th><th>Monthly</th><th>Install</th><th>Subscribers</th><th>Status</th><th>Actions</th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td><strong>{item.name}</strong><small>{item.description || (item.features ?? []).slice(0, 2).join(" · ") || "No description"}</small></td><td><strong>{item.download_mbps} Mbps</strong><small>Upload {item.upload_mbps} Mbps</small></td><td>{item.bdix_mbps == null ? "—" : `${item.bdix_mbps} Mbps`}</td><td><strong>{money(item.price_monthly)}</strong><small>/ month</small></td><td>{money(item.installation_fee)}</td><td>{item.subscriber_count ?? 0}</td><td><span className={`status-badge status-${item.is_active ? "active" : "inactive"}`}>{item.is_active ? "Active" : "Inactive"}</span></td><td><div className="package-row-actions"><button type="button" className="table-icon-button" title="Edit package" aria-label={`Edit ${item.name}`} onClick={() => beginEdit(item)}><Pencil size={14} /></button><button type="button" className="table-icon-button" title={item.is_active ? "Deactivate package" : "Activate package"} aria-label={item.is_active ? `Deactivate ${item.name}` : `Activate ${item.name}`} onClick={() => void toggleActive(item)}>{item.is_active ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}</button></div></td></tr>)}</tbody></table></div>}
            <footer className="subscriber-pagination"><span>Showing {items.length ? (page - 1) * 20 + 1 : 0}–{Math.min(page * 20, total)} of {total}</span><div><button type="button" disabled={page <= 1 || busy} onClick={() => setPage(page - 1)}>Previous</button><span>Page {page} of {pages}</span><button type="button" disabled={page >= pages || busy} onClick={() => setPage(page + 1)}>Next</button></div></footer>
        </section>
        {modal && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setModal(false); }}><section className="modal-card package-modal" role="dialog" aria-modal="true" aria-labelledby="package-form-title"><button type="button" className="modal-close" onClick={() => setModal(false)} disabled={saving} aria-label="Close"><X size={18} /></button><span className="eyebrow">SERVICE CATALOGUE</span><h2 id="package-form-title">{editing ? "Edit package" : "Create package"}</h2><p>Set the plan details customers and billing will use.</p><form onSubmit={save}><div className="package-form-grid"><label className="field-label">Package name<input required maxLength={120} value={form.name} onChange={(event) => set("name", event.target.value)} /></label><label className="field-label">Monthly price (৳)<input type="number" required min="0" step="0.01" value={form.price_monthly} onChange={(event) => set("price_monthly", event.target.value)} /></label><label className="field-label">Download speed (Mbps)<input type="number" required min="1" step="1" value={form.download_mbps} onChange={(event) => set("download_mbps", event.target.value)} /></label><label className="field-label">Upload speed (Mbps)<input type="number" required min="1" step="1" value={form.upload_mbps} onChange={(event) => set("upload_mbps", event.target.value)} /></label><label className="field-label">BDIX speed (Mbps)<input type="number" min="0" step="1" value={form.bdix_mbps} onChange={(event) => set("bdix_mbps", event.target.value)} /></label><label className="field-label">Installation fee (৳)<input type="number" min="0" step="0.01" value={form.installation_fee} onChange={(event) => set("installation_fee", event.target.value)} /></label><label className="field-label field-full">Description<textarea rows={2} value={form.description} onChange={(event) => set("description", event.target.value)} /></label><label className="field-label field-full">Features <small>One feature per line</small><textarea rows={4} placeholder={"Unlimited data\n24/7 support"} value={form.features} onChange={(event) => set("features", event.target.value)} /></label><label className="package-active-toggle"><input type="checkbox" checked={form.is_active} onChange={(event) => set("is_active", event.target.checked)} /> Available for new subscribers</label></div>{formError && <p className="profile-message error" role="alert">{formError}</p>}<div className="subscriber-modal-actions"><button type="button" className="button button-outline" onClick={() => setModal(false)} disabled={saving}>Cancel</button><button type="submit" className="button button-dark" disabled={saving}>{saving ? "Saving…" : editing ? "Save changes" : "Create package"}<ArrowRight size={14} /></button></div></form></section></div>}
    </div>;
}
