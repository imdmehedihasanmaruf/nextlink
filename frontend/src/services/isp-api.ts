import { apiRequest } from "./api-client";

export type ApiPage<T> = { items: T[]; meta: { current_page: number; per_page: number; total: number; last_page?: number } };
export type Package = { id: number; name: string; description: string | null; download_mbps: number; upload_mbps: number; bdix_mbps: number | null; price_monthly: string; installation_fee: string; features: string[]; is_active: boolean; subscriber_count?: number };
export type Subscriber = { id: number; subscriber_number: string; name: string | null; email: string | null; phone: string | null; address: string | null; connection_type: string; ip_address: string | null; status: string; package_id?: number | null; package_name?: string | null; created_at?: string | null };
export type Invoice = { id: number; subscriber_id: number; invoice_number: string; amount: string; billing_period_start: string; billing_period_end: string; due_date: string; paid_at: string | null; status: string; subscriber_name?: string | null; subscriber_number?: string | null };
export type Payment = { id: number; invoice_id: number; subscriber_id: number; method: string; transaction_reference: string | null; amount: string; status: string; subscriber_name?: string | null; subscriber_number?: string | null; invoice_number?: string | null; created_at?: string | null };
export type Ticket = { id: number; subscriber_id: number; assigned_to: number | null; subject: string; description: string; priority: string; status: string; sla_due_at: string | null; subscriber_name?: string | null; subscriber_number?: string | null; assigned_to_name?: string | null; created_at?: string | null };

export type TicketMessage = { id: number; ticket_id: number; user_id: number; body: string; created_at: string; user_name?: string | null };
export type Technician = { id: number; name: string; email: string; role: string; avatar_path: string | null; created_at: string; open_tickets?: number; resolved_this_month?: number };
export type Router = { id: number; name: string; ip_address: string; username: string; password?: string; api_port: number; location: string | null; description: string | null; status: string; last_sync: string | null; created_at: string };
export type User = { id: number; name: string; email: string; role: string; avatar_url?: string | null; avatar_path?: string | null; created_at?: string };
export type CompanySetting = { key: string; value: string | null; updated_at?: string | null; is_default?: boolean };
export type DashboardMetrics = { total_subscribers: number; active_connections: number; suspended_connections: number; pending_connections: number; open_tickets: number; unpaid_invoice_total?: number | string; payments_received_this_month?: number | string; monthly_recurring_revenue?: number | string };
export type AuthUser = { id: number; name: string; email: string; role: string; avatar_url?: string | null };
export type ReportOverview = {
    collected_total: number; unpaid_balance: number; pending_payments: number; overdue_invoices: number; active_packages: number;
    subscriber_status: { status: string; total: number }[]; package_distribution: { name: string; subscribers: number }[];
    monthly_series: { label: string; collected: number; invoiced: number }[];
    recent_invoices: { id: number; invoice_number: string; amount: number; status: string; due_date: string; subscriber_name: string | null }[];
    recent_tickets: { id: number; subject: string; status: string; priority: string; created_at: string; subscriber_name: string | null }[];
    role_counts: { role: string; total: number }[];
    recent_subscribers: { id: number; subscriber_number: string | null; status: string; created_at: string; name: string | null }[];
    payment_methods: { method: string; total: number }[];
    today_collected: number; month_collected: number; previous_month_collected: number; invoices_due_soon: number;
    tickets_by_priority: { priority: string; total: number }[]; ticket_resolution: { status: string; total: number }[];
    new_subscribers_this_month: number; new_subscribers_previous_month: number; collection_rate: number;
    pending_applications: number; application_status: { status: string; total: number }[];
    top_packages: { name: string; subscribers: number }[];
    failed_payments: number; tickets_resolved_this_month: number;
};

async function page<T>(path: string): Promise<ApiPage<T>> {
    const response = await apiRequest<T[]>(path);
    return { items: response.data, meta: response.meta as ApiPage<T>["meta"] };
}

export const ispApi = {
    packages: (pageNumber = 1, perPage = 100, search = "", activeOnly?: boolean) => page<Package>(`packages?page=${pageNumber}&per_page=${perPage}&search=${encodeURIComponent(search)}${activeOnly === undefined ? "" : `&is_active=${activeOnly ? 1 : 0}`}`),
    createPackage: async (data: Omit<Package, "id">) => (await apiRequest<Package>("packages", { method: "POST", body: JSON.stringify(data) })).data,
    updatePackage: async (id: number, data: Partial<Omit<Package, "id">>) => (await apiRequest<Package>(`packages/${id}`, { method: "PUT", body: JSON.stringify(data) })).data,
    subscribers: (search = "", pageNumber = 1, perPage = 20, status = "") => page<Subscriber>(`subscribers?search=${encodeURIComponent(search)}&page=${pageNumber}&per_page=${perPage}${status ? `&status=${encodeURIComponent(status)}` : ""}`),
    createSubscriber: async (data: { name: string; email: string; phone?: string; address?: string; connection_type: string; status: string; package_id?: number }) => (await apiRequest<Subscriber>("subscribers", { method: "POST", body: JSON.stringify(data) })).data,
    updateSubscriber: async (id: number, data: { name?: string; email?: string; phone?: string; address?: string; connection_type?: string; status?: string; ip_address?: string | null }) => (await apiRequest<Subscriber>(`subscribers/${id}`, { method: "PUT", body: JSON.stringify(data) })).data,
    deleteSubscriber: async (id: number) => apiRequest(`subscribers/${id}`, { method: "DELETE" }),
    invoices: (search = "", pageNumber = 1, perPage = 20, status = "") => page<Invoice>(`invoices?search=${encodeURIComponent(search)}&page=${pageNumber}&per_page=${perPage}${status ? `&status=${status}` : ""}`),
    createInvoice: async (data: { subscriber_id: number; billing_period_start: string; billing_period_end: string; due_date: string }) => (await apiRequest<Invoice>("invoices/generate", { method: "POST", body: JSON.stringify(data) })).data,
    payments: (search = "", pageNumber = 1, perPage = 20, status = "", method = "") => page<Payment>(`payments?search=${encodeURIComponent(search)}&page=${pageNumber}&per_page=${perPage}${status ? `&status=${status}` : ""}${method ? `&method=${method}` : ""}`),
    verifyPayment: async (id: number, status: "verified" | "failed") => (await apiRequest<Payment>(`payments/${id}/verify`, { method: "POST", body: JSON.stringify({ status }) })).data,
    tickets: (search = "", pageNumber = 1, perPage = 20, status = "", priority = "") => page<Ticket>(`tickets?search=${encodeURIComponent(search)}&page=${pageNumber}&per_page=${perPage}${status ? `&status=${status}` : ""}${priority ? `&priority=${priority}` : ""}`),
    createTicket: async (data: { subject: string; description: string; priority?: string }) => (await apiRequest<Ticket>("tickets", { method: "POST", body: JSON.stringify(data) })).data,
    updateTicket: async (id: number, data: { assigned_to?: number | null; status?: string; priority?: string }) => (await apiRequest<Ticket>(`tickets/${id}`, { method: "PUT", body: JSON.stringify(data) })).data,
    ticketMessages: async (ticketId: number) => (await apiRequest<TicketMessage[]>(`tickets/${ticketId}/messages`)).data,
    addTicketMessage: async (ticketId: number, body: string) => (await apiRequest<TicketMessage>(`tickets/${ticketId}/messages`, { method: "POST", body: JSON.stringify({ body }) })).data,
    technicians: (search = "", pageNumber = 1, perPage = 20, role = "") => page<Technician>(`technicians?search=${encodeURIComponent(search)}&page=${pageNumber}&per_page=${perPage}${role ? `&role=${role}` : ""}`),
    updateTechnician: async (id: number, data: { name?: string; email?: string; role?: string }) => (await apiRequest<Technician>(`technicians/${id}`, { method: "PUT", body: JSON.stringify(data) })).data,
    routers: (search = "", pageNumber = 1, perPage = 20, status = "") => page<Router>(`routers?search=${encodeURIComponent(search)}&page=${pageNumber}&per_page=${perPage}${status ? `&status=${status}` : ""}`),
    createRouter: async (data: { name: string; ip_address: string; username: string; password: string; api_port?: number; location?: string; description?: string }) => (await apiRequest<Router>("routers", { method: "POST", body: JSON.stringify(data) })).data,
    updateRouter: async (id: number, data: Partial<{ name: string; ip_address: string; username: string; password: string; api_port: number; location: string; description: string; status: string }>) => (await apiRequest<Router>(`routers/${id}`, { method: "PUT", body: JSON.stringify(data) })).data,
    deleteRouter: async (id: number) => apiRequest(`routers/${id}`, { method: "DELETE" }),
    syncRouter: async (id: number) => (await apiRequest<Router>(`routers/${id}/sync`, { method: "POST" })).data,
    staff: (search = "", pageNumber = 1, perPage = 20, role = "") => page<User>(`staff?search=${encodeURIComponent(search)}&page=${pageNumber}&per_page=${perPage}${role ? `&role=${role}` : ""}`),
    createUser: async (data: { name: string; email: string; role: string }) => (await apiRequest<User>("staff", { method: "POST", body: JSON.stringify(data) })).data,
    updateUser: async (id: number, data: { name: string; email: string; role: string }) => (await apiRequest<User>(`staff/${id}`, { method: "PUT", body: JSON.stringify(data) })).data,
    dashboard: async (period = "month", status = "all") => (await apiRequest<DashboardMetrics>(`dashboard?period=${period}&status=${status}`)).data,
    reportOverview: async () => (await apiRequest<ReportOverview>("reports/overview")).data,
    settings: async () => (await apiRequest<CompanySetting[]>("settings")).data,
    updateSettings: async (settings: { key: string; value: string | null }[]) => (await apiRequest<CompanySetting[]>("settings", { method: "PUT", body: JSON.stringify({ settings }) })).data,
    login: async (email: string, password: string) => {
        const result = await apiRequest<{ user: { id: number; name: string; email: string; role: string }; token: string }>("auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
        if (typeof window !== "undefined") window.sessionStorage.setItem("isp-access-token", result.data.token);
        return result.data.user;
    },
    logout: async () => {
        try { await apiRequest("auth/logout", { method: "POST" }); }
        finally { if (typeof window !== "undefined") window.sessionStorage.removeItem("isp-access-token"); }
    },
    me: async () => (await apiRequest<{ user: AuthUser }>("auth/me")).data.user,
    updateProfile: async (name: string, avatar?: File) => {
        const form = new FormData();
        form.set("name", name);
        if (avatar) form.set("avatar", avatar);
        return (await apiRequest<{ user: AuthUser }>("auth/profile", { method: "POST", body: form })).data.user;
    },
    updatePassword: async (currentPassword: string, password: string, passwordConfirmation: string) => {
        await apiRequest("auth/password", { method: "PUT", body: JSON.stringify({ current_password: currentPassword, password, password_confirmation: passwordConfirmation }) });
        if (typeof window !== "undefined") window.sessionStorage.removeItem("isp-access-token");
    },
    checkCoverage: async (district: string, area: string) => (await apiRequest<{ available: boolean; configured: boolean }>("coverage/check", { method: "POST", body: JSON.stringify({ district, area }) })).data,
    submitApplication: async (application: { name: string; email: string; phone: string; address: string; district: string; area: string; package_id?: number }) => (await apiRequest<{ id: number; status: string }>("applications", { method: "POST", body: JSON.stringify(application) })).data,
};
