'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Inbox, RefreshCw, MapPin, Ticket, CheckCircle2, XCircle, Clock,
  FileText, Download, Loader2, Search, Wrench, AlertTriangle,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { apiGet, apiPost, apiFetch, getApiToken } from '@/lib/apiClient';
import { formatDateTime } from '@/lib/utils';

interface ConnectionRequest {
  id: string;
  full_name: string;
  phone: string;
  email: string;
  id_number: string;
  id_document_path: string | null;
  address: string;
  package_name: string;
  ont_config: string;
  referral: string;
  status: string;
  created_at: string;
}

interface CoverageArea {
  id: string;
  zone: string;
  district: string | null;
  areas: string[];
  status: string;
  lat: number | null;
  lng: number | null;
  notes: string | null;
}

interface TicketRow {
  id: string;
  title: string;
  status: string;
  priority: string;
  category: string | null;
  subscriber_id: string | null;
  assigned_to_name: string | null;
  sla_due_at: string | null;
  first_response_at: string | null;
  resolved_at: string | null;
  created_at: string;
  description: string;
}

interface TicketStats {
  totals: { total: number; open: number; in_progress: number; resolved: number; high_priority: number };
  sla: { breached: number; within_sla: number };
  assigned: Array<{ assigned_to: string; assigned_to_name: string; open_jobs: number }>;
}

type Tab = 'requests' | 'coverage' | 'tickets';

export default function OperationsPage() {
  const [tab, setTab] = useState<Tab>('requests');
  const [requests, setRequests] = useState<ConnectionRequest[]>([]);
  const [coverageAreas, setCoverageAreas] = useState<CoverageArea[]>([]);
  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [stats, setStats] = useState<TicketStats | null>(null);
  const [technicians, setTechnicians] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [hasToken, setHasToken] = useState(false);
  const [search, setSearch] = useState('');

  const loadAll = useCallback(async () => {
    setLoading(true);

    const [reqRes, covRes, ticketRes, statRes] = await Promise.all([
      apiGet<{ requests: ConnectionRequest[] }>('/api/applications'),
      apiGet<{ areas: CoverageArea[] }>('/api/coverage/areas'),
      apiGet<{ tickets: TicketRow[] }>('/api/tickets?limit=100'),
      apiGet<TicketStats>('/api/tickets/stats'),
    ]);

    if (reqRes.success) setRequests(reqRes.requests || []);
    if (covRes.success) setCoverageAreas(covRes.areas || []);
    if (ticketRes.success) setTickets(ticketRes.tickets || []);
    if (statRes.success) setStats(statRes as any);

    // Technicians live in the admin store.
    const store = await apiGet<{ technicians: Array<{ id: string; name: string }> }>('/api/data');
    if (store.success) setTechnicians(store.technicians || []);

    setLoading(false);
  }, []);

  useEffect(() => {
    setHasToken(Boolean(getApiToken()));
    loadAll();
  }, [loadAll]);

  const updateRequest = async (id: string, status: string) => {
    setBusy(`${id}:${status}`);
    const result = await apiFetch(`/api/applications/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    setBusy(null);
    if (result.success) {
      toast.success(`Request marked as ${status}`);
      loadAll();
    } else {
      toast.error(result.error || 'Could not update the request');
    }
  };

  const downloadDocument = async (id: string) => {
    const token = getApiToken();
    if (!token) {
      toast.error('No API session');
      return;
    }
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_BILLING_API_URL || 'http://localhost:3001'}/api/applications/${id}/document`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!response.ok) {
        toast.error('No document uploaded for this request');
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      toast.error('Could not download the document');
    }
  };

  const updateTicketStatus = async (id: string, status: string) => {
    setBusy(`ticket:${id}`);
    const result = await apiFetch(`/api/tickets/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    setBusy(null);
    if (result.success) {
      toast.success(`Ticket moved to ${status}`);
      loadAll();
    } else {
      toast.error(result.error || 'Could not update the ticket');
    }
  };

  const assignTicket = async (id: string, technicianId: string) => {
    if (!technicianId) return;
    setBusy(`assign:${id}`);
    const result = await apiPost(`/api/tickets/${id}/assign`, { technicianId });
    setBusy(null);
    if (result.success) {
      toast.success('Ticket assigned');
      loadAll();
    } else {
      toast.error(result.error || 'Could not assign the ticket');
    }
  };

  const filteredRequests = requests.filter((request) => {
    if (!search.trim()) return true;
    const needle = search.toLowerCase();
    return (
      request.full_name.toLowerCase().includes(needle) ||
      request.phone?.toLowerCase().includes(needle) ||
      request.id?.toLowerCase().includes(needle) ||
      request.package_name?.toLowerCase().includes(needle)
    );
  });

  const filteredTickets = tickets.filter((ticket) => {
    if (!search.trim()) return true;
    const needle = search.toLowerCase();
    return (
      ticket.id.toLowerCase().includes(needle) ||
      ticket.title?.toLowerCase().includes(needle) ||
      ticket.subscriber_id?.toLowerCase().includes(needle)
    );
  });

  const statusBadge = (status: string) => {
    switch (status) {
      case 'approved':
      case 'active':
        return <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/30">Approved</Badge>;
      case 'rejected':
        return <Badge className="bg-rose-500/10 text-rose-600 border-rose-500/30">Rejected</Badge>;
      case 'activated':
        return <Badge className="bg-blue-500/10 text-blue-600 border-blue-500/30">Activated</Badge>;
      default:
        return <Badge className="bg-amber-500/10 text-amber-600 border-amber-500/30">Pending</Badge>;
    }
  };

  const ticketStatusBadge = (status: string) => {
    switch (status.toLowerCase()) {
      case 'resolved':
      case 'closed':
        return <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/30">Resolved</Badge>;
      case 'in_progress':
        return <Badge className="bg-purple-500/10 text-purple-600 border-purple-500/30">In Progress</Badge>;
      default:
        return <Badge className="bg-blue-500/10 text-blue-600 border-blue-500/30">Open</Badge>;
    }
  };

  const priorityBadge = (priority: string) => {
    if (priority === 'critical' || priority === 'high') {
      return <Badge className="bg-rose-500/10 text-rose-600 border-rose-500/30">{priority}</Badge>;
    }
    if (priority === 'medium') {
      return <Badge className="bg-amber-500/10 text-amber-600 border-amber-500/30">{priority}</Badge>;
    }
    return <Badge variant="secondary">{priority}</Badge>;
  };

  if (!hasToken) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Operations</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Connection requests, coverage management and the helpdesk ticket desk.
          </p>
        </div>
        <Card>
          <CardContent className="p-8 text-center space-y-3">
            <AlertTriangle className="h-10 w-10 mx-auto text-amber-500" />
            <p className="font-semibold">API session required</p>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Sign out and sign in again to obtain a session token for the NextLink Express API (port 3001).
            </p>
            <Button variant="outline" onClick={() => window.location.reload()} className="mt-2">
              <RefreshCw className="h-4 w-4 mr-2" />
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Operations</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Connection requests, coverage management and the helpdesk ticket desk.
          </p>
        </div>
        <Button variant="outline" onClick={loadAll} disabled={loading} className="gap-2">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* CRM KPIs */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <Card>
            <CardContent className="p-5">
              <p className="text-xs font-medium text-muted-foreground">Total Tickets</p>
              <p className="text-2xl font-bold mt-2">{stats.totals.total}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <p className="text-xs font-medium text-muted-foreground">Open</p>
              <p className="text-2xl font-bold mt-2 text-blue-600">{stats.totals.open}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <p className="text-xs font-medium text-muted-foreground">In Progress</p>
              <p className="text-2xl font-bold mt-2 text-purple-600">{stats.totals.in_progress}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <p className="text-xs font-medium text-muted-foreground">SLA Breached</p>
              <p className="text-2xl font-bold mt-2 text-rose-600">{stats.sla.breached}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <p className="text-xs font-medium text-muted-foreground">Pending Requests</p>
              <p className="text-2xl font-bold mt-2 text-amber-600">
                {requests.filter((r) => r.status === 'pending').length}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b">
        {([
          { id: 'requests' as Tab, label: 'Connection Requests', icon: Inbox },
          { id: 'coverage' as Tab, label: 'Coverage Areas', icon: MapPin },
          { id: 'tickets' as Tab, label: 'Helpdesk Tickets', icon: Ticket },
        ]).map((item) => (
          <button
            key={item.id}
            onClick={() => setTab(item.id)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === item.id
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </button>
        ))}
      </div>

      {tab !== 'coverage' && (
        <div className="flex items-center gap-2">
          <Search className="h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, phone, reference or subscriber id…"
            className="max-w-md"
          />
        </div>
      )}

      {/* Connection requests */}
      {tab === 'requests' && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle>Online Connection Requests</CardTitle>
            <CardDescription>
              Applications submitted through the public website, including the uploaded NID document.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {filteredRequests.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                No connection requests yet. They appear here as soon as a visitor submits the public form.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                      <th className="p-2 font-medium">Reference</th>
                      <th className="p-2 font-medium">Applicant</th>
                      <th className="p-2 font-medium">Package</th>
                      <th className="p-2 font-medium">Installation</th>
                      <th className="p-2 font-medium">Status</th>
                      <th className="p-2 font-medium text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRequests.map((request) => (
                      <tr key={request.id} className="border-b last:border-0 hover:bg-muted/40">
                        <td className="p-2 font-mono text-xs">{request.id}</td>
                        <td className="p-2">
                          <p className="font-medium">{request.full_name}</p>
                          <p className="text-xs text-muted-foreground">
                            {request.phone} · {request.id_number}
                          </p>
                        </td>
                        <td className="p-2 text-xs">{request.package_name || '—'}</td>
                        <td className="p-2 text-xs max-w-xs truncate">{request.address}</td>
                        <td className="p-2">{statusBadge(request.status)}</td>
                        <td className="p-2 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {request.id_document_path && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => downloadDocument(request.id)}
                                className="h-8 w-8 p-0"
                                title="Download NID document"
                              >
                                <FileText className="h-3.5 w-3.5" />
                              </Button>
                            )}
                            {request.status === 'pending' && (
                              <>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={busy === `${request.id}:approved`}
                                  onClick={() => updateRequest(request.id, 'approved')}
                                  className="h-8 text-xs"
                                >
                                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 mr-1" />
                                  Approve
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  disabled={busy === `${request.id}:rejected`}
                                  onClick={() => updateRequest(request.id, 'rejected')}
                                  className="h-8 w-8 p-0 text-rose-500"
                                  title="Reject"
                                >
                                  <XCircle className="h-3.5 w-3.5" />
                                </Button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Coverage areas */}
      {tab === 'coverage' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle>Coverage Areas</CardTitle>
              <CardDescription>Zones, districts and the sectors served by the optical ring.</CardDescription>
            </CardHeader>
            <CardContent>
              {coverageAreas.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">
                  No coverage areas yet. Run the seed script or add areas through the API.
                </p>
              ) : (
                <div className="space-y-2 max-h-[28rem] overflow-y-auto">
                  {coverageAreas.map((area) => (
                    <div key={area.id} className="rounded-lg border p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-medium text-sm">
                          {area.zone} · {area.district || 'All districts'}
                        </p>
                        <Badge
                          className={
                            area.status === 'available'
                              ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30'
                              : area.status === 'planned'
                                ? 'bg-amber-500/10 text-amber-600 border-amber-500/30'
                                : 'bg-slate-500/10 text-slate-600 border-slate-500/30'
                          }
                        >
                          {area.status}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {(area.areas || []).join(' · ')}
                      </p>
                      {area.lat !== null && area.lng !== null && (
                        <p className="text-[10px] text-muted-foreground mt-1">
                          {Number(area.lat).toFixed(4)}, {Number(area.lng).toFixed(4)}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle>Coverage Map</CardTitle>
              <CardDescription>Geographic footprint of the active and planned POPs.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="relative w-full aspect-[16/9] bg-muted/40 rounded-lg overflow-hidden">
                <svg viewBox="0 0 360 180" className="w-full h-full" role="img" aria-label="Coverage map">
                  <defs>
                    <pattern id="opsGrid" width="20" height="20" patternUnits="userSpaceOnUse">
                      <path
                        d="M 20 0 L 0 0 0 20"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="0.3"
                        className="text-muted-foreground/20"
                      />
                    </pattern>
                  </defs>
                  <rect width="360" height="180" fill="url(#opsGrid)" />
                  {coverageAreas.map((area) => {
                    if (area.lat === null || area.lng === null) return null;
                    const lat = Number(area.lat);
                    const lng = Number(area.lng);
                    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
                    const x = ((lng + 180) / 360) * 360;
                    const y = ((90 - lat) / 180) * 180;
                    const isAvailable = area.status === 'available';
                    return (
                      <g key={area.id}>
                        <circle
                          cx={x}
                          cy={y}
                          r={isAvailable ? 3 : 2}
                          fill={isAvailable ? '#2563eb' : '#94a3b8'}
                          opacity={isAvailable ? 0.9 : 0.6}
                        />
                        {isAvailable && <circle cx={x} cy={y} r={6} fill="#2563eb" opacity={0.15} />}
                      </g>
                    );
                  })}
                </svg>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Tickets */}
      {tab === 'tickets' && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle>Helpdesk Tickets</CardTitle>
            <CardDescription>
              Ticket lifecycle with automatic technician assignment, SLA tracking and status changes.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {filteredTickets.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                No tickets yet. They appear here as soon as a subscriber submits one from the portal.
              </p>
            ) : (
              <div className="space-y-3">
                {filteredTickets.map((ticket) => {
                  const breached =
                    ticket.sla_due_at && !ticket.resolved_at && new Date(ticket.sla_due_at) < new Date();
                  return (
                    <div key={ticket.id} className="rounded-lg border p-4">
                      <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono text-xs text-muted-foreground">{ticket.id}</span>
                            {ticketStatusBadge(ticket.status)}
                            {priorityBadge(ticket.priority)}
                            {breached && (
                              <Badge className="bg-rose-500/10 text-rose-600 border-rose-500/30">
                                <Clock className="h-3 w-3 mr-1" />
                                SLA breached
                              </Badge>
                            )}
                          </div>
                          <p className="font-medium mt-1.5">{ticket.title}</p>
                          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{ticket.description}</p>
                          <p className="text-[11px] text-muted-foreground mt-1.5">
                            {ticket.category || 'General'} · {ticket.subscriber_id || 'Unregistered'} · opened{' '}
                            {formatDateTime(ticket.created_at)}
                            {ticket.assigned_to_name ? ` · assigned to ${ticket.assigned_to_name}` : ''}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <Select
                            onValueChange={(value) => assignTicket(ticket.id, value)}
                            disabled={busy === `assign:${ticket.id}`}
                          >
                            <SelectTrigger className="w-44">
                              <SelectValue placeholder={ticket.assigned_to_name || 'Assign technician'} />
                            </SelectTrigger>
                            <SelectContent>
                              {technicians.map((technician) => (
                                <SelectItem key={technician.id} value={technician.id}>
                                  {technician.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Select
                            onValueChange={(value) => updateTicketStatus(ticket.id, value)}
                            disabled={busy === `ticket:${ticket.id}`}
                          >
                            <SelectTrigger className="w-36">
                              <SelectValue placeholder="Status" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="open">Open</SelectItem>
                              <SelectItem value="in_progress">In Progress</SelectItem>
                              <SelectItem value="resolved">Resolved</SelectItem>
                              <SelectItem value="closed">Closed</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Technician workload */}
      {tab === 'tickets' && stats && stats.assigned.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle>Technician Workload</CardTitle>
            <CardDescription>Open jobs per field technician.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {stats.assigned.map((entry) => (
                <div key={entry.assigned_to} className="rounded-lg border p-3 flex items-center gap-3">
                  <div className="h-9 w-9 rounded-full bg-primary/10 text-primary flex items-center justify-center">
                    <Wrench className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate">{entry.assigned_to_name || entry.assigned_to}</p>
                    <p className="text-xs text-muted-foreground">{entry.open_jobs} open job(s)</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
