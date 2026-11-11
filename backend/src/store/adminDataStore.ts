'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { getApiToken, apiFetch } from '@/lib/apiClient';
import {
  mockPackages,
  mockSubscribers,
  mockInvoices,
  mockTickets,
  mockTechnicians,
  type Package,
  type Subscriber,
  type Invoice,
  type Ticket,
  type Technician,
  type TicketStatus,
  type TechnicianStatus
} from '@/lib/mockData';
import { defaultRoles, type Role } from '@/lib/roles';

/**
 * The Authorization header for the admin's own API routes. The staff token
 * is issued by the Express API at sign-in.
 */
function adminHeaders(): Record<string, string> {
  const token = getApiToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

interface AdminDataState {
  packages: Package[];
  subscribers: Subscriber[];
  invoices: Invoice[];
  tickets: Ticket[];
  technicians: Technician[];
  roles: Role[];
  referralRewards?: any;
  boostBandwidth?: any;
  liveLatency?: any;
  interfaceTraffic?: any;
  peeringHubs?: any[];
  isLoading: boolean;
  lastSync: string | null;
  /** The last failure of the data load — the panel must not save while it is set. */
  loadError: string | null;

  fetchData: () => Promise<void>;
  saveCollection: (type: string, data: any) => Promise<void>;
  saveItem: (type: string, data: any) => Promise<void>;
  // Package actions
  addPackage: (pkg: Package) => Promise<void>;
  updatePackage: (pkg: Package) => Promise<void>;
  deletePackage: (id: string) => Promise<void>;

  // Subscriber actions
  addSubscriber: (sub: Subscriber) => Promise<void>;
  updateSubscriber: (sub: Subscriber) => Promise<void>;
  deleteSubscriber: (id: string) => Promise<void>;

  // Invoice actions
  updateInvoiceStatus: (id: string, status: 'paid' | 'unpaid' | 'overdue') => Promise<void>;
  generateMonthlyInvoices: () => Promise<number>;
  deleteInvoice: (id: string) => Promise<void>;

  // Ticket actions
  createTicket: (ticket: Ticket) => Promise<void>;
  updateTicketStatus: (id: string, status: TicketStatus) => Promise<void>;
  assignTicketTechnician: (ticketId: string, technicianName: string) => Promise<void>;
  addTicketMessage: (ticketId: string, message: any) => Promise<void>;
  deleteTicket: (id: string) => Promise<void>;

  // Technician actions
  updateTechnicianStatus: (id: string, status: TechnicianStatus) => Promise<void>;
  addTechnician: (tech: Technician) => Promise<void>;
  deleteTechnician: (id: string) => Promise<void>;

  // Role actions (Requirement 27)
  addRole: (role: Role) => Promise<void>;
  updateRole: (role: Role) => Promise<void>;
  deleteRole: (id: string) => Promise<void>;
  removePermissionFromRole: (roleId: string, permKey: string) => Promise<void>;

  clearCollection: (type: 'packages' | 'subscribers' | 'invoices' | 'tickets' | 'technicians') => Promise<void>;
}

export const useAdminDataStore = create<AdminDataState>()(
  persist<AdminDataState, [], [], Partial<AdminDataState>>(
    (set, get) => ({
      packages: [],
      subscribers: [],
      invoices: [],
      tickets: [],
      technicians: [],
      roles: defaultRoles,
      isLoading: false,
      lastSync: null,
      loadError: null,

      fetchData: async () => {
        try {
          set({ isLoading: true, loadError: null });
          const res = await fetch('/api/data?t=' + Date.now(), {
            cache: 'no-store',
            headers: adminHeaders(),
          });
          if (res.ok) {
            const data = await res.json();
            set({
              packages: data.packages ?? [],
              subscribers: data.subscribers ?? [],
              invoices: data.invoices ?? [],
              tickets: data.tickets ?? [],
              technicians: data.technicians ?? [],
              roles: data.roles ?? defaultRoles,
              referralRewards: data.referralRewards ?? null,
              boostBandwidth: data.boostBandwidth ?? null,
              liveLatency: data.liveLatency ?? null,
              interfaceTraffic: data.interfaceTraffic ?? null,
              peeringHubs: data.peeringHubs ?? [],
              lastSync: new Date().toISOString(),
              isLoading: false,
              loadError: null,
            });
          } else {
            // A failed load must be visible. The previous code silently left
            // an empty store, and a subsequent save could then wipe the
            // tables with the empty snapshot.
            const payload = await res.json().catch(() => ({}));
            set({
              isLoading: false,
              loadError: payload.error || `The data could not be loaded (${res.status})`,
            });
          }
        } catch (e: any) {
          set({ isLoading: false, loadError: e?.message || 'The data could not be loaded.' });
        }
      },

      /**
       * Send a collection to the API.
       * The response is checked and the error is surfaced, so the panel never
       * reports a successful save for a write that did not happen.
       */
      saveCollection: async (type: string, data: any) => {
        // A save is refused while the last load failed. The previous version
        // swallowed the error, so an empty store was saved back into the
        // tables and wiped them.
        const loadError = get().loadError;
        if (loadError) {
          const error = new Error(
            `The data could not be loaded (${loadError}). Please reload the page before saving.`,
          );
          console.error(`[admin] refusing to save ${type}:`, error.message);
          throw error;
        }
        try {
          const response = await fetch('/api/data', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...adminHeaders() },
            body: JSON.stringify({ type, data }),
          });

          if (!response.ok) {
            const payload = await response.json().catch(() => ({}));
            throw new Error(payload.error || `The server refused the save (${response.status})`);
          }
        } catch (error: any) {
          console.error(`[admin] saving ${type} failed:`, error);
          // The optimistic change is reverted by reloading from the server.
          await get().fetchData();
          throw error;
        }
      },

      saveItem: async (type: string, data: any) => {
        const loadError = get().loadError;
        if (loadError) {
          const error = new Error(
            `The data could not be loaded (${loadError}). Please reload the page before saving.`,
          );
          console.error(`[admin] refusing to save ${type}:`, error.message);
          throw error;
        }
        const previous = (get() as any)[type];
        try {
          set({ [type]: data } as any);
          const response = await fetch('/api/data', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...adminHeaders() },
            body: JSON.stringify({ type, data }),
          });

          if (!response.ok) {
            const payload = await response.json().catch(() => ({}));
            throw new Error(payload.error || `The server refused the save (${response.status})`);
          }
        } catch (error: any) {
          console.error(`[admin] saving ${type} failed:`, error);
          // Roll the optimistic change back.
          if (previous !== undefined) set({ [type]: previous } as any);
          throw error;
        }
      },

      // Packages
      addPackage: async (pkg: Package) => {
        const updated = [...get().packages, pkg];
        set({ packages: updated });
        await get().saveCollection('packages', updated);
      },
      updatePackage: async (pkg: Package) => {
        const updated = get().packages.map(p => p.id === pkg.id ? pkg : p);
        set({ packages: updated });
        await get().saveCollection('packages', updated);
      },
      deletePackage: async (id: string) => {
        const updated = get().packages.filter(p => p.id !== id);
        set({ packages: updated });
        await get().saveCollection('packages', updated);
      },

      // Subscribers
      addSubscriber: async (sub: Subscriber) => {
        const updated = [sub, ...get().subscribers];
        set({ subscribers: updated });
        await get().saveCollection('subscribers', updated);
      },
      updateSubscriber: async (sub: Subscriber) => {
        const updated = get().subscribers.map(s => s.id === sub.id ? sub : s);
        set({ subscribers: updated });
        await get().saveCollection('subscribers', updated);
      },
      // Subscribers are archived, never removed — the billing history and
      // the ticket thread have to survive the account.
      deleteSubscriber: async (id: string) => {
        const updated = get().subscribers.map(s =>
          s.id === id ? { ...s, status: 'deactivated' as const } : s,
        );
        set({ subscribers: updated });
        await get().saveCollection('subscribers', updated);
      },

      // Invoices
      updateInvoiceStatus: async (id: string, status: 'paid' | 'unpaid' | 'overdue') => {
        const updated = get().invoices.map(inv => inv.id === id ? {
          ...inv,
          status,
          paidDate: status === 'paid' ? new Date().toISOString() : inv.paidDate
        } : inv);
        set({ invoices: updated });
        await get().saveCollection('invoices', updated);
      },
      generateMonthlyInvoices: async () => {
        const subscribers = get().subscribers.filter(s => s.status === 'active');
        const currentMonth = new Date().toLocaleString('en-US', { month: 'short', year: 'numeric' });
        const newInvoices: Invoice[] = subscribers.map((sub, idx) => ({
          id: `INV-${new Date().getFullYear()}-${String(get().invoices.length + idx + 1).padStart(4, '0')}`,
          subscriberId: sub.id,
          subscriberName: sub.name,
          phone: sub.phone,
          packageName: sub.packageName,
          amount: sub.balance < 0 ? Math.abs(sub.balance) : 79,
          month: currentMonth,
          issueDate: new Date().toISOString().split('T')[0],
          dueDate: new Date(Date.now() + 10 * 86400000).toISOString().split('T')[0],
          status: 'unpaid' as const,
        }));
        const updated = [...newInvoices, ...get().invoices];
        set({ invoices: updated });
        await get().saveCollection('invoices', updated);
        return newInvoices.length;
      },

      // Tickets
      createTicket: async (ticket: Ticket) => {
        const updated = [ticket, ...get().tickets];
        set({ tickets: updated });
        await get().saveCollection('tickets', updated);
      },
      updateTicketStatus: async (id: string, status: TicketStatus) => {
        const updated = get().tickets.map(t => t.id === id ? {
          ...t,
          status,
          updatedAt: new Date().toISOString()
        } : t);
        set({ tickets: updated });
        await get().saveCollection('tickets', updated);
      },
      assignTicketTechnician: async (ticketId: string, technicianName: string) => {
        const updated = get().tickets.map(t => t.id === ticketId ? {
          ...t,
          assignedTo: technicianName,
          updatedAt: new Date().toISOString()
        } : t);
        set({ tickets: updated });
        await get().saveCollection('tickets', updated);
      },
      addTicketMessage: async (ticketId: string, message: any) => {
        const updated = get().tickets.map(t => t.id === ticketId ? {
          ...t,
          messages: [...t.messages, message],
          updatedAt: new Date().toISOString()
        } : t);
        set({ tickets: updated });
        await get().saveCollection('tickets', updated);
      },

      // Technicians
      updateTechnicianStatus: async (id: string, status: TechnicianStatus) => {
        const updated = get().technicians.map(tech => tech.id === id ? {
          ...tech,
          status
        } : tech);
        set({ technicians: updated });
        await get().saveCollection('technicians', updated);
      },
      addTechnician: async (tech: Technician) => {
        const updated = [...get().technicians, tech];
        set({ technicians: updated });
        await get().saveCollection('technicians', updated);
      },

      // Roles (Requirement 27)
      addRole: async (role: Role) => {
        const updated = [...get().roles, role];
        set({ roles: updated });
        await get().saveCollection('roles', updated);
      },
      updateRole: async (role: Role) => {
        const updated = get().roles.map(r => r.id === role.id ? role : r);
        set({ roles: updated });
        await get().saveCollection('roles', updated);
      },
      deleteRole: async (id: string) => {
        const updated = get().roles.filter(r => r.id !== id);
        set({ roles: updated });
        await get().saveCollection('roles', updated);
      },
      deleteInvoice: async (id: string) => {
        // The backend owns the invoices table, so the deletion is performed
        // by the billing API — a full admin save would never remove the row.
        const result = await apiFetch(`/api/billing/invoices/${encodeURIComponent(id)}`, {
          method: 'DELETE',
        });
        if (!result.success) {
          throw new Error(result.error || 'The invoice could not be deleted.');
        }
        set({ invoices: get().invoices.filter(i => i.id !== id) });
      },
      deleteTicket: async (id: string) => {
        const result = await apiFetch(`/api/tickets/${encodeURIComponent(id)}`, {
          method: 'DELETE',
        });
        if (!result.success) {
          throw new Error(result.error || 'The ticket could not be deleted.');
        }
        set({ tickets: get().tickets.filter(t => t.id !== id) });
      },
      deleteTechnician: async (id: string) => {
        // Technicians are owned by the admin panel, so the deletion is a real
        // row delete — the record does not reappear on a refresh.
        const response = await fetch('/api/admin/delete-record', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...adminHeaders() },
          body: JSON.stringify({ type: 'technicians', id }),
        });
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(payload.error || 'The technician could not be deleted.');
        }
        set({ technicians: get().technicians.filter(t => t.id !== id) });
      },
      removePermissionFromRole: async (roleId: string, permKey: string) => {
        const updated = get().roles.map(r => r.id === roleId ? {
          ...r,
          permissions: (r.permissions || []).filter(p => p !== permKey)
        } : r);
        set({ roles: updated });
        await get().saveCollection('roles', updated);
      },
      clearCollection: async (type: string) => {
        set({ [type]: [] } as any);
        await get().saveCollection(type, []);
      },
    }),
    {
      name: 'nextlink-admin-persistent-store',
      // The collections are the server's data, so they are not persisted.
      // A stale local snapshot could otherwise be written back and delete
      // rows the server had changed in the meantime.
      partialize: (state) => {
        const {
          packages,
          subscribers,
          invoices,
          tickets,
          technicians,
          roles,
          ...rest
        } = state;
        return rest as Partial<AdminDataState>;
      },
    }
  )
);
