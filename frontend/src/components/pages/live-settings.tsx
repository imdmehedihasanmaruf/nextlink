"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { ApiError } from "@/services/api-client";
import { ispApi, type CompanySetting } from "@/services/isp-api";
import { ArrowRight, Bell, CheckCircle2, CreditCard, MapPin, RefreshCw, ShieldCheck, SlidersHorizontal, Wifi, X } from "lucide-react";

type TabId = "company" | "billing" | "notifications" | "sms" | "payments" | "coverage" | "security";

const tabs: { id: TabId; label: string; icon: typeof SlidersHorizontal }[] = [
    { id: "company", label: "Company profile", icon: SlidersHorizontal },
    { id: "billing", label: "Billing cycle", icon: CreditCard },
    { id: "notifications", label: "Notifications", icon: Bell },
    { id: "sms", label: "SMS provider", icon: Bell },
    { id: "payments", label: "Payment gateways", icon: CreditCard },
    { id: "coverage", label: "Coverage zones", icon: MapPin },
    { id: "security", label: "Security & audit", icon: ShieldCheck },
];

const tabKeys: Record<TabId, string[]> = {
    company: ["company.name", "company.support_email", "company.phone", "company.website", "company.address"],
    billing: ["billing.cycle", "billing.invoice_day", "billing.due_days", "billing.late_fee", "billing.currency"],
    notifications: ["notifications.invoice_email", "notifications.payment_sms", "notifications.ticket_email", "notifications.overdue_reminder"],
    sms: ["sms.provider", "sms.sender_id", "sms.api_endpoint"],
    payments: ["payments.bkash_enabled", "payments.nagad_enabled", "payments.rocket_enabled", "payments.sslcommerz_enabled", "payments.cash_enabled", "payments.manual_enabled"],
    coverage: ["coverage.default_district", "coverage.check_message"],
    security: ["security.session_timeout_minutes", "security.require_strong_password", "security.audit_retention_days"],
};

function boolValue(value: string | null | undefined) {
    return value === "1" || value === "true";
}

export function LiveSettings() {
    const [rows, setRows] = useState<CompanySetting[]>([]);
    const [draft, setDraft] = useState<Record<string, string>>({});
    const [tab, setTab] = useState<TabId>("company");
    const [busy, setBusy] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");

    const load = useCallback(async () => {
        setBusy(true); setError("");
        try {
            const items = await ispApi.settings();
            setRows(items);
            const next: Record<string, string> = {};
            for (const item of items) next[item.key] = item.value ?? "";
            setDraft(next);
        } catch (cause) {
            setError(cause instanceof ApiError ? cause.message : "Could not load settings.");
        } finally {
            setBusy(false);
        }
    }, []);

    useEffect(() => { void load(); }, [load]);

    const dirtyKeys = useMemo(() => {
        const original: Record<string, string> = {};
        for (const item of rows) original[item.key] = item.value ?? "";
        return Object.keys(draft).filter((key) => (draft[key] ?? "") !== (original[key] ?? ""));
    }, [draft, rows]);

    const tabDirty = useMemo(() => dirtyKeys.filter((key) => tabKeys[tab].includes(key)).length, [dirtyKeys, tab]);

    function setValue(key: string, value: string) {
        setDraft((current) => ({ ...current, [key]: value }));
    }

    function toggle(key: string) {
        setDraft((current) => ({ ...current, [key]: boolValue(current[key]) ? "0" : "1" }));
    }

    async function save(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const keys = tabKeys[tab].filter((key) => dirtyKeys.includes(key));
        if (!keys.length) {
            setNotice("No changes to save in this section.");
            return;
        }
        setSaving(true); setError(""); setNotice("");
        try {
            const items = await ispApi.updateSettings(keys.map((key) => ({ key, value: draft[key] ?? "" })));
            setRows(items);
            const next: Record<string, string> = {};
            for (const item of items) next[item.key] = item.value ?? "";
            setDraft(next);
            setNotice("Settings saved successfully.");
        } catch (cause) {
            setError(cause instanceof ApiError ? cause.message : "Unable to save settings.");
        } finally {
            setSaving(false);
        }
    }

    async function resetTab() {
        const original: Record<string, string> = {};
        for (const item of rows) original[item.key] = item.value ?? "";
        setDraft((current) => {
            const next = { ...current };
            for (const key of tabKeys[tab]) next[key] = original[key] ?? "";
            return next;
        });
        setNotice("Section changes discarded.");
    }

    return <div className="settings-management">
        <header className="subscriber-page-heading">
            <div>
                <span className="eyebrow">SYSTEM CONFIGURATION</span>
                <h1>Settings</h1>
                <p>Manage company profile, billing rules, notifications, gateways, and security options.</p>
            </div>
            <div className="subscriber-heading-actions">
                <button type="button" className="button button-outline" onClick={() => void load()} disabled={busy || saving}>
                    <RefreshCw size={14} className={busy ? "spin" : ""} /> Refresh
                </button>
            </div>
        </header>

        <div className="subscriber-summary">
            <article><span><SlidersHorizontal size={17} /></span><small>Configured keys</small><strong>{rows.length}</strong></article>
            <article><span className="orange"><Wifi size={17} /></span><small>Unsaved changes</small><strong>{dirtyKeys.length}</strong></article>
            <article><span className="green"><CheckCircle2 size={17} /></span><small>Current section dirty</small><strong>{tabDirty}</strong></article>
            <article><span className="violet"><ShieldCheck size={17} /></span><small>Sections</small><strong>{tabs.length}</strong></article>
        </div>

        {notice && <div className="inline-success" role="status">{notice}<button type="button" onClick={() => setNotice("")} aria-label="Dismiss"><X size={15} /></button></div>}
        {error && <div className="inline-error" role="alert">{error}<button type="button" onClick={() => setError("")} aria-label="Dismiss"><X size={15} /></button></div>}

        {busy && rows.length === 0 ? <div role="status" className="empty-state">Loading settings…</div> : error && rows.length === 0 ? <div role="alert" className="empty-state"><strong>Could not load settings</strong><p>{error}</p><button type="button" className="button button-outline" onClick={() => void load()}>Try again</button></div> : <div className="settings-layout">
            <nav className="settings-nav" aria-label="Settings sections">
                {tabs.map(({ id, label, icon: Icon }) => <button type="button" key={id} className={tab === id ? "settings-tab active" : "settings-tab"} onClick={() => { setTab(id); setNotice(""); setError(""); }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><Icon size={14} />{label}</span>
                    <ArrowRight size={13} />
                </button>)}
            </nav>

            <section className="data-panel settings-panel">
                <div className="data-panel-heading">
                    <div>
                        <h2>{tabs.find((item) => item.id === tab)?.label}</h2>
                        <p>{tabDirty ? `${tabDirty} unsaved change${tabDirty === 1 ? "" : "s"} in this section` : "Live company settings · saved to the database"}</p>
                    </div>
                    <span className="demo-chip"><span />LIVE</span>
                </div>

                <form onSubmit={save}>
                    {tab === "company" && <div className="form-grid settings-form">
                        <label className="field-label">Company name<input value={draft["company.name"] ?? ""} onChange={(event) => setValue("company.name", event.target.value)} maxLength={2000} required /></label>
                        <label className="field-label">Support email<input type="email" value={draft["company.support_email"] ?? ""} onChange={(event) => setValue("company.support_email", event.target.value)} maxLength={2000} required /></label>
                        <label className="field-label">Phone number<input value={draft["company.phone"] ?? ""} onChange={(event) => setValue("company.phone", event.target.value)} maxLength={2000} /></label>
                        <label className="field-label">Website<input value={draft["company.website"] ?? ""} onChange={(event) => setValue("company.website", event.target.value)} maxLength={2000} /></label>
                        <label className="field-label field-full">Office address<textarea rows={2} value={draft["company.address"] ?? ""} onChange={(event) => setValue("company.address", event.target.value)} maxLength={2000} /></label>
                    </div>}

                    {tab === "billing" && <div className="form-grid settings-form">
                        <label className="field-label">Billing cycle<select value={draft["billing.cycle"] ?? "monthly"} onChange={(event) => setValue("billing.cycle", event.target.value)}><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option></select></label>
                        <label className="field-label">Invoice generation day<input type="number" min={1} max={28} value={draft["billing.invoice_day"] ?? "1"} onChange={(event) => setValue("billing.invoice_day", event.target.value)} /></label>
                        <label className="field-label">Payment due days<input type="number" min={1} max={60} value={draft["billing.due_days"] ?? "7"} onChange={(event) => setValue("billing.due_days", event.target.value)} /></label>
                        <label className="field-label">Late fee (BDT)<input type="number" min={0} value={draft["billing.late_fee"] ?? "0"} onChange={(event) => setValue("billing.late_fee", event.target.value)} /></label>
                        <label className="field-label">Currency<select value={draft["billing.currency"] ?? "BDT"} onChange={(event) => setValue("billing.currency", event.target.value)}><option value="BDT">BDT</option><option value="USD">USD</option></select></label>
                    </div>}

                    {tab === "notifications" && <div className="form-grid settings-form">
                        {["notifications.invoice_email", "notifications.payment_sms", "notifications.ticket_email", "notifications.overdue_reminder"].map((key) => {
                            const labels: Record<string, string> = {
                                "notifications.invoice_email": "Email invoices to subscribers",
                                "notifications.payment_sms": "SMS payment confirmations",
                                "notifications.ticket_email": "Email ticket updates",
                                "notifications.overdue_reminder": "Overdue invoice reminders",
                            };
                            return <label key={key} className="field-label field-full" style={{ display: "flex", alignItems: "center", gap: 12 }}>
                                <input type="checkbox" checked={boolValue(draft[key])} onChange={() => toggle(key)} />
                                <span>{labels[key]}</span>
                            </label>;
                        })}
                    </div>}

                    {tab === "sms" && <div className="form-grid settings-form">
                        <label className="field-label">SMS provider<select value={draft["sms.provider"] ?? "none"} onChange={(event) => setValue("sms.provider", event.target.value)}><option value="none">Not configured</option><option value="sslwireless">SSL Wireless</option><option value="bulksmsbd">BulkSMSBD</option><option value="custom">Custom API</option></select></label>
                        <label className="field-label">Sender ID<input value={draft["sms.sender_id"] ?? ""} onChange={(event) => setValue("sms.sender_id", event.target.value)} maxLength={2000} placeholder="NEXLINK" /></label>
                        <label className="field-label field-full">API endpoint<input value={draft["sms.api_endpoint"] ?? ""} onChange={(event) => setValue("sms.api_endpoint", event.target.value)} maxLength={2000} placeholder="https://sms.provider.example/api" /></label>
                    </div>}

                    {tab === "payments" && <div className="form-grid settings-form">
                        {[
                            ["payments.bkash_enabled", "bKash"],
                            ["payments.nagad_enabled", "Nagad"],
                            ["payments.rocket_enabled", "Rocket"],
                            ["payments.sslcommerz_enabled", "SSLCommerz"],
                            ["payments.cash_enabled", "Cash"],
                            ["payments.manual_enabled", "Manual / bank transfer"],
                        ].map(([key, label]) => <label key={key} className="field-label" style={{ display: "flex", alignItems: "center", gap: 12 }}>
                            <input type="checkbox" checked={boolValue(draft[key])} onChange={() => toggle(key)} />
                            <span>Enable {label}</span>
                        </label>)}
                    </div>}

                    {tab === "coverage" && <div className="form-grid settings-form">
                        <label className="field-label">Default district<input value={draft["coverage.default_district"] ?? ""} onChange={(event) => setValue("coverage.default_district", event.target.value)} maxLength={2000} /></label>
                        <label className="field-label field-full">Coverage check message<textarea rows={3} value={draft["coverage.check_message"] ?? ""} onChange={(event) => setValue("coverage.check_message", event.target.value)} maxLength={2000} /></label>
                    </div>}

                    {tab === "security" && <div className="form-grid settings-form">
                        <label className="field-label">Session timeout (minutes)<input type="number" min={15} max={1440} value={draft["security.session_timeout_minutes"] ?? "120"} onChange={(event) => setValue("security.session_timeout_minutes", event.target.value)} /></label>
                        <label className="field-label">Audit retention (days)<input type="number" min={7} max={3650} value={draft["security.audit_retention_days"] ?? "90"} onChange={(event) => setValue("security.audit_retention_days", event.target.value)} /></label>
                        <label className="field-label field-full" style={{ display: "flex", alignItems: "center", gap: 12 }}>
                            <input type="checkbox" checked={boolValue(draft["security.require_strong_password"])} onChange={() => toggle("security.require_strong_password")} />
                            <span>Require strong passwords for staff accounts</span>
                        </label>
                    </div>}

                    <div className="modal-actions" style={{ marginTop: 20 }}>
                        <button type="button" className="button button-outline" onClick={resetTab} disabled={saving || tabDirty === 0}>Discard</button>
                        <button type="submit" className="button button-dark" disabled={saving || tabDirty === 0}>{saving ? "Saving…" : "Save section"} <ArrowRight size={14} /></button>
                    </div>
                </form>
            </section>
        </div>}
    </div>;
}
