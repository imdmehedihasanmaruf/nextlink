"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { ApiError } from "@/services/api-client";
import { ispApi, type Ticket, type TicketMessage } from "@/services/isp-api";
import { ArrowDownToLine, ArrowRight, ChevronDown, FileText, LifeBuoy, MessageSquare, Pencil, Plus, RefreshCw, Search, User, Users, X } from "lucide-react";

type TicketForm = { subject: string; description: string; priority: string };
const initialForm: TicketForm = { subject: "", description: "", priority: "medium" };
const localDate = (date: string) => new Date(`${date}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const localDateTime = (date: string) => new Date(date).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const formatStatus = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const formatPriority = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
const priorityColors: Record<string, string> = { low: "muted", medium: "", high: "orange", urgent: "red" };

export function LiveTickets() {
    const [rows, setRows] = useState<Ticket[]>([]);
    const [query, setQuery] = useState("");
    const [status, setStatus] = useState("");
    const [priority, setPriority] = useState("");
    const [page, setPage] = useState(1);
    const [pages, setPages] = useState(1);
    const [total, setTotal] = useState(0);
    const [busy, setBusy] = useState(true);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [modalOpen, setModalOpen] = useState(false);
    const [detailOpen, setDetailOpen] = useState(false);
    const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
    const [messages, setMessages] = useState<TicketMessage[]>([]);
    const [newMessage, setNewMessage] = useState("");
    const [sendingMessage, setSendingMessage] = useState(false);
    const [form, setForm] = useState<TicketForm>(initialForm);
    const [saving, setSaving] = useState(false);
    const [actionError, setActionError] = useState("");

    const load = useCallback(async () => {
        setBusy(true); setError("");
        try {
            const result = await ispApi.tickets(query.trim(), page, 20, status, priority);
            setRows(result.items);
            setTotal(result.meta.total);
            setPages(result.meta.last_page ?? Math.max(1, Math.ceil(result.meta.total / result.meta.per_page)));
        } catch (cause) { setError(cause instanceof ApiError ? cause.message : "Could not load tickets."); }
        finally { setBusy(false); }
    }, [query, page, status, priority]);

    useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 180); return () => window.clearTimeout(timer); }, [load]);

    const summary = useMemo(() => ({
        open: rows.filter((row) => row.status === "open").length,
        inProgress: rows.filter((row) => row.status === "in_progress").length,
        resolved: rows.filter((row) => row.status === "resolved").length,
        urgent: rows.filter((row) => row.priority === "urgent").length,
    }), [rows]);

    async function loadMessages(ticket: Ticket) {
        setSelectedTicket(ticket);
        setDetailOpen(true);
        try {
            const msgs = await ispApi.ticketMessages(ticket.id);
            setMessages(msgs.map((m) => ({ ...m, user_name: "User" })));
        } catch (cause) { setNotice(cause instanceof ApiError ? cause.message : "Could not load messages."); }
    }

    async function sendMessage(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!selectedTicket || !newMessage.trim()) return;
        setSendingMessage(true);
        try {
            const msg = await ispApi.addTicketMessage(selectedTicket.id, newMessage.trim());
            setMessages([...messages, msg]);
            setNewMessage("");
            setNotice("Message sent.");
        } catch (cause) { setNotice(cause instanceof ApiError ? cause.message : "Could not send message."); }
        finally { setSendingMessage(false); }
    }

    async function updateTicket(field: "status" | "priority" | "assigned_to", value: string | number | null) {
        if (!selectedTicket) return;
        try {
            const updated = await ispApi.updateTicket(selectedTicket.id, { [field]: value });
            setSelectedTicket(updated);
            setRows(rows.map((r) => r.id === updated.id ? updated : r));
            setNotice(`Ticket ${field.replace("_", " ")} updated.`);
        } catch (cause) { setActionError(cause instanceof ApiError ? cause.message : "Could not update ticket."); }
    }

    function openCreate() { setForm(initialForm); setActionError(""); setModalOpen(true); }

    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault(); setSaving(true); setActionError(""); setNotice("");
        try {
            await ispApi.createTicket({ subject: form.subject.trim(), description: form.description.trim(), priority: form.priority });
            setModalOpen(false); setNotice("Support ticket created.");
            await load();
        } catch (cause) { setActionError(cause instanceof ApiError ? cause.message : "Could not create ticket."); }
        finally { setSaving(false); }
    }

    function exportCsv() {
        const columns = ["ID", "Subject", "Subscriber", "Status", "Priority", "Assigned To", "Created"];
        const quote = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
        const lines = [columns, ...rows.map((row) => [row.id, row.subject, row.subscriber_name || "Unknown", row.status, row.priority, row.assigned_to_name || "Unassigned", row.created_at ? localDate(row.created_at) : "—"])].map((line) => line.map(quote).join(","));
        const url = URL.createObjectURL(new Blob([lines.join("\r\n")], { type: "text/csv;charset=utf-8" }));
        const anchor = document.createElement("a"); anchor.href = url; anchor.download = `tickets-page-${page}.csv`; anchor.click(); URL.revokeObjectURL(url);
    }

    return <div className="tickets-management">
        <header className="subscriber-page-heading"><div><span className="eyebrow">SUPPORT MANAGEMENT</span><h1>Support tickets</h1><p>Manage support requests, track issues, and communicate with subscribers.</p></div><div className="subscriber-heading-actions"><button type="button" className="button button-outline" onClick={exportCsv} disabled={!rows.length}><ArrowDownToLine size={15} /> Export page</button><button type="button" className="button button-dark" onClick={openCreate}><Plus size={15} /> New ticket</button></div></header>
        <div className="subscriber-summary"><article><span><LifeBuoy size={17} /></span><small>All matching records</small><strong>{total}</strong></article><article><span className="orange"><FileText size={17} /></span><small>Open on this page</small><strong>{summary.open}</strong></article><article><span><RefreshCw size={17} /></span><small>In progress (this page)</small><strong>{summary.inProgress}</strong></article><article><span className="green"><FileText size={17} /></span><small>Resolved (this page)</small><strong>{summary.resolved}</strong></article></div>
        {notice && <div className="inline-success" role="status">{notice}<button type="button" onClick={() => setNotice("")} aria-label="Dismiss"><X size={15} /></button></div>}
        <section className="data-panel subscriber-table-panel"><div className="data-panel-heading"><div><h2>Ticket queue</h2><p>{busy ? "Refreshing records…" : `${total} matching ticket${total === 1 ? "" : "s"}`}</p></div><button type="button" className="button button-outline" onClick={() => void load()} disabled={busy}><RefreshCw size={14} /> Refresh</button></div>
            <div className="subscriber-filters"><label className="subscriber-search"><Search size={16} /><input value={query} onChange={(event) => { setPage(1); setQuery(event.target.value); }} placeholder="Search subject, description, subscriber…" /></label><label className="subscriber-status-filter"><span>Status</span><select value={status} onChange={(event) => { setPage(1); setStatus(event.target.value); }}><option value="">All statuses</option><option value="open">Open</option><option value="in_progress">In Progress</option><option value="resolved">Resolved</option><option value="closed">Closed</option></select><ChevronDown size={14} /></label><label className="subscriber-status-filter"><span>Priority</span><select value={priority} onChange={(event) => { setPage(1); setPriority(event.target.value); }}><option value="">All priorities</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="urgent">Urgent</option></select><ChevronDown size={14} /></label></div>
            {error ? <div role="alert" className="empty-state"><strong>Could not load tickets</strong><p>{error}</p><button type="button" className="button button-outline" onClick={() => void load()}>Try again</button></div> : busy && rows.length === 0 ? <div role="status" className="empty-state">Loading tickets…</div> : rows.length === 0 ? <div className="empty-state"><span><LifeBuoy size={20} /></span><strong>{query || status || priority ? "No matching tickets" : "No tickets yet"}</strong><p>{query || status || priority ? "Change the search or filters and try again." : "Support tickets will appear here when subscribers report issues."}</p>{!query && !status && !priority && <button type="button" className="button button-dark" onClick={openCreate}><Plus size={14} /> Create ticket</button>}</div> : <div className="table-wrap"><table className="data-table subscriber-table"><thead><tr><th>Ticket</th><th>Subscriber</th><th>Subject</th><th>Priority</th><th>Status</th><th>Assigned</th><th /></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><strong>TKT-{row.id}</strong><small>{row.created_at ? localDate(row.created_at) : "—"}</small></td><td>{row.subscriber_name || "Unknown"}<small>{row.subscriber_number || `ID ${row.subscriber_id}`}</small></td><td><strong>{row.subject}</strong><small className="truncate" style={{ maxWidth: "250px" }}>{row.description.substring(0, 60)}…</small></td><td><span className={`priority-badge priority-${row.priority}`}>{formatPriority(row.priority)}</span></td><td><span className={`status-badge status-${row.status.replace("_", "-")}`}>{formatStatus(row.status)}</span></td><td>{row.assigned_to_name || <span className="muted-text">Unassigned</span>}</td><td><button type="button" className="table-action" onClick={() => loadMessages(row)}><MessageSquare size={14} /> View</button></td></tr>)}</tbody></table></div>}
            <footer className="subscriber-pagination"><span>Showing {rows.length ? (page - 1) * 20 + 1 : 0}–{Math.min(page * 20, total)} of {total}</span><div><button type="button" disabled={page <= 1 || busy} onClick={() => setPage(page - 1)}>Previous</button><span>Page {page} of {pages}</span><button type="button" disabled={page >= pages || busy} onClick={() => setPage(page + 1)}>Next</button></div></footer>
        </section>
        {/* Create Ticket Modal */}
        {modalOpen && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setModalOpen(false); }}><section className="modal-card subscriber-modal" role="dialog" aria-modal="true" aria-labelledby="ticket-modal-title"><button type="button" className="modal-close" onClick={() => setModalOpen(false)} aria-label="Close" disabled={saving}><X size={18} /></button><span className="eyebrow">NEW SUPPORT TICKET</span><h2 id="ticket-modal-title">Create ticket</h2><p>Submit a new support request on behalf of a subscriber.</p><form onSubmit={submit}><div className="subscriber-form-grid"><label className="field-label">Subject<input required maxLength={180} value={form.subject} onChange={(event) => setForm({ ...form, subject: event.target.value })} placeholder="Brief description of the issue" /></label><label className="field-label">Priority<select value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value })}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="urgent">Urgent</option></select></label><label className="field-label field-full">Description<textarea required rows={4} maxLength={10000} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Detailed description of the issue…" /></label></div>{actionError && <p className="field-error" role="alert">{actionError}</p>}<div className="modal-actions"><button type="button" className="button button-outline" onClick={() => setModalOpen(false)} disabled={saving}>Cancel</button><button type="submit" className="button button-dark" disabled={saving}>{saving ? "Creating…" : "Create ticket"} <ArrowRight size={14} /></button></div></form></section></div>}
        {/* Ticket Detail Modal */}
        {detailOpen && selectedTicket && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !sendingMessage) setDetailOpen(false); }}><section className="modal-card ticket-detail-modal" role="dialog" aria-modal="true" aria-labelledby="ticket-detail-title"><button type="button" className="modal-close" onClick={() => setDetailOpen(false)} aria-label="Close"><X size={18} /></button><span className="eyebrow">TICKET DETAILS</span><h2 id="ticket-detail-title">TKT-{selectedTicket.id} — {selectedTicket.subject}</h2><div className="ticket-detail-meta"><span>From: <strong>{selectedTicket.subscriber_name || "Unknown"}</strong></span><span>Created: <strong>{selectedTicket.created_at ? localDateTime(selectedTicket.created_at) : "—"}</strong></span><span>Priority: <strong className={`priority-text priority-${selectedTicket.priority}`}>{formatPriority(selectedTicket.priority)}</strong></span><span>Status: <span className={`status-badge status-${selectedTicket.status.replace("_", "-")}`}>{formatStatus(selectedTicket.status)}</span></span></div><div className="ticket-actions"><label>Update status:<select value={selectedTicket.status} onChange={(event) => updateTicket("status", event.target.value)}><option value="open">Open</option><option value="in_progress">In Progress</option><option value="resolved">Resolved</option><option value="closed">Closed</option></select></label><label>Update priority:<select value={selectedTicket.priority} onChange={(event) => updateTicket("priority", event.target.value)}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="urgent">Urgent</option></select></label></div>{actionError && <p className="field-error" role="alert">{actionError}</p>}<div className="ticket-messages"><h3>Conversation</h3>{messages.map((msg) => <div key={msg.id} className="ticket-message"><div className="message-header"><strong>{msg.user_name || "User"}</strong><small>{msg.created_at ? localDateTime(msg.created_at) : "—"}</small></div><p>{msg.body}</p></div>)}</div><form onSubmit={sendMessage} className="ticket-reply"><textarea value={newMessage} onChange={(event) => setNewMessage(event.target.value)} placeholder="Type your reply…" required disabled={sendingMessage} /><button type="submit" className="button button-dark" disabled={sendingMessage || !newMessage.trim()}>{sendingMessage ? "Sending…" : "Send reply"}</button></form></section></div>}
    </div>;
}