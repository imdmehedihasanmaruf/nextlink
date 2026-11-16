'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Ban,
  Search,
  RefreshCw,
  FileText,
  Download,
  Eye,
  AlertTriangle,
  Calendar,
  Clock,
  MapPin,
  Globe,
  User,
  X,
  CreditCard,
  Wifi,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { apiGet, openPdf } from '@/lib/apiClient';

interface CancellationRecord {
  id: string;
  subscriber_id: string;
  subscriber_name?: string;
  subscriber_email?: string;
  subscriber_phone?: string;
  package_id: string;
  package_name: string;
  cancel_invoice_id: string;
  reason: string;
  description: string;
  buy_again_date?: string | null;
  not_sure_buy_again: boolean;
  cancel_date: string;
  cancel_time: string;
  city: string;
  postal_code: string;
  state: string;
  country: string;
  client_ip: string;
  timezone: string;
  status: string;
  effective_date: string;
  outstanding_balance: number;
  raw_data?: any;
  created_at: string;
}

export default function CancellationsPage() {
  const [cancellations, setCancellations] = useState<CancellationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [reasonFilter, setReasonFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;
  const [selectedRecord, setSelectedRecord] = useState<CancellationRecord | null>(null);

  const fetchCancellations = useCallback(async () => {
    setLoading(true);
    try {
      const queryParams = new URLSearchParams();
      if (search) queryParams.set('search', search);
      if (reasonFilter && reasonFilter !== 'all') queryParams.set('reason', reasonFilter);
      if (statusFilter && statusFilter !== 'all') queryParams.set('status', statusFilter);
      if (startDate) queryParams.set('startDate', startDate);
      if (endDate) queryParams.set('endDate', endDate);

      const res = await apiGet<{ cancellations: CancellationRecord[]; total: number }>(
        `/api/billing/cancellations?${queryParams.toString()}`
      );
      if (res.success && res.cancellations) {
        setCancellations(res.cancellations);
      } else {
        toast.error(res.error || 'Failed to fetch cancellations');
      }
    } catch (err: any) {
      toast.error(err?.message || 'Error connecting to billing engine');
    } finally {
      setLoading(false);
    }
  }, [search, reasonFilter, statusFilter, startDate, endDate]);

  useEffect(() => {
    fetchCancellations();
  }, [fetchCancellations]);

  const handleOpenPdf = async (invoiceId: string) => {
    if (!invoiceId) {
      toast.error('No invoice ID associated with this cancellation');
      return;
    }
    const toastId = toast.loading('Generating cancel invoice PDF...');
    const opened = await openPdf(`/api/billing/invoices/${encodeURIComponent(invoiceId)}/pdf`);
    toast.dismiss(toastId);
    if (!opened) {
      toast.error('Could not load cancel invoice PDF');
    }
  };

  // Client-side filtering fallback for dates/status
  const filteredRecords = useMemo(() => {
    return cancellations.filter((c) => {
      if (statusFilter !== 'all') {
        const s = (c.status || 'cancelled').toLowerCase();
        if (statusFilter === 'cancelled' && s !== 'cancelled') return false;
        if (statusFilter === 'settled' && s !== 'settled' && s !== 'paid') return false;
      }
      if (startDate && c.cancel_date) {
        const parts = c.cancel_date.split('/');
        if (parts.length === 3) {
          const iso = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
          if (iso < startDate) return false;
        }
      }
      if (endDate && c.cancel_date) {
        const parts = c.cancel_date.split('/');
        if (parts.length === 3) {
          const iso = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
          if (iso > endDate) return false;
        }
      }
      return true;
    });
  }, [cancellations, statusFilter, startDate, endDate]);

  const totalPages = Math.max(1, Math.ceil(filteredRecords.length / pageSize));
  const paginatedRecords = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredRecords.slice(start, start + pageSize);
  }, [filteredRecords, currentPage, pageSize]);

  // CSV Export
  const handleExportCsv = () => {
    if (filteredRecords.length === 0) {
      toast.error('No cancellation records to export');
      return;
    }
    const headers = [
      'Invoice No',
      'Subscriber Name',
      'Subscriber ID',
      'Package',
      'Cancel Reason',
      'Description',
      'Buy-Again Date',
      'Cancel Date',
      'Cancel Time',
      'City & Postal',
      'State & Country',
      'Final Dues',
      'Status',
    ];
    const rows = filteredRecords.map((c) => [
      `"${c.cancel_invoice_id || c.id}"`,
      `"${(c.subscriber_name || '').replace(/"/g, '""')}"`,
      `"${c.subscriber_id}"`,
      `"${(c.package_name || '').replace(/"/g, '""')}"`,
      `"${(c.reason || '').replace(/"/g, '""')}"`,
      `"${(c.description || '').replace(/"/g, '""')}"`,
      `"${c.not_sure_buy_again ? 'Not sure yet' : c.buy_again_date || ''}"`,
      `"${c.cancel_date || ''}"`,
      `"${c.cancel_time || ''}"`,
      `"${c.city || ''}, ${c.postal_code || ''}"`,
      `"${c.state || ''}, ${c.country || ''}"`,
      `"${Number(c.outstanding_balance || 0).toFixed(2)}"`,
      `"${c.status || 'CANCELLED'}"`,
    ]);
    const csvContent =
      'data:text/csv;charset=utf-8,\uFEFF' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Cancel_Invoices_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success('Cancel invoices exported to CSV');
  };

  // KPI computations
  const totalCount = cancellations.length;
  const totalOutstanding = useMemo(() => {
    return cancellations.reduce((acc, c) => acc + Number(c.outstanding_balance || 0), 0);
  }, [cancellations]);

  const topReason = useMemo(() => {
    if (cancellations.length === 0) return 'None';
    const counts: Record<string, number> = {};
    for (const c of cancellations) {
      counts[c.reason] = (counts[c.reason] || 0) + 1;
    }
    let max = 0;
    let result = 'None';
    for (const [r, count] of Object.entries(counts)) {
      if (count > max) {
        max = count;
        result = `${r} (${count})`;
      }
    }
    return result;
  }, [cancellations]);

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Ban className="h-6 w-6 text-rose-600" />
            Cancel Invoices
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Audit log of package cancellation requests, session geolocation snapshots, and unsubscriber cancel invoices.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportCsv}
            disabled={filteredRecords.length === 0}
            className="text-xs font-semibold gap-1.5"
          >
            <Download className="h-3.5 w-3.5 text-primary" />
            Export CSV
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={fetchCancellations}
            disabled={loading}
            className="text-xs font-medium"
          >
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="border shadow-xs">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold uppercase text-muted-foreground">
              Total Cancel Invoices
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-black font-mono">{totalCount}</p>
            <p className="text-xs text-muted-foreground mt-1">Processed termination records</p>
          </CardContent>
        </Card>

        <Card className="border shadow-xs">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold uppercase text-muted-foreground">
              Most Common Reason
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-base font-bold truncate text-foreground">{topReason}</p>
            <p className="text-xs text-muted-foreground mt-1">Dominant cancellation driver</p>
          </CardContent>
        </Card>

        <Card className="border shadow-xs">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold uppercase text-muted-foreground">
              Carried Outstanding Dues
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-black font-mono text-rose-600">
              ${totalOutstanding.toFixed(2)}
            </p>
            <p className="text-xs text-muted-foreground mt-1">Total unpaid balance across cancellations</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] w-full">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by subscriber, invoice #, package, reason, or notes..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 text-xs"
          />
        </div>
        <Select value={reasonFilter} onValueChange={setReasonFilter}>
          <SelectTrigger className="w-full sm:w-44 text-xs">
            <SelectValue placeholder="All Reasons" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Reasons</SelectItem>
            <SelectItem value="Too expensive">Too expensive</SelectItem>
            <SelectItem value="Slow speed">Slow speed</SelectItem>
            <SelectItem value="Frequent disconnections">Frequent disconnections</SelectItem>
            <SelectItem value="Moving to another location">Moving to another location</SelectItem>
            <SelectItem value="Switching provider">Switching provider</SelectItem>
            <SelectItem value="Poor support">Poor support</SelectItem>
            <SelectItem value="Temporary pause">Temporary pause</SelectItem>
            <SelectItem value="Other">Other</SelectItem>
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-36 text-xs">
            <SelectValue placeholder="All Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
            <SelectItem value="settled">Settled</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex items-center gap-1.5 w-full sm:w-auto">
          <span className="text-[11px] text-muted-foreground font-medium">From:</span>
          <Input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="text-xs h-8 w-32"
          />
          <span className="text-[11px] text-muted-foreground font-medium">To:</span>
          <Input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="text-xs h-8 w-32"
          />
        </div>
      </div>

      {/* Table */}
      <Card className="border shadow-xs">
        <CardContent className="p-0">
          {loading ? (
            <div className="p-8 text-center text-xs text-muted-foreground flex flex-col items-center justify-center gap-2">
              <RefreshCw className="h-6 w-6 animate-spin text-primary" />
              <span>Loading cancellations…</span>
            </div>
          ) : filteredRecords.length === 0 ? (
            <div className="p-8 text-center text-xs text-muted-foreground space-y-2">
              <Ban className="h-8 w-8 text-muted-foreground/40 mx-auto" />
              <p className="font-semibold text-foreground text-sm">No cancellation records found</p>
              <p>When subscribers cancel via the client portal, their immutable records will appear here.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs whitespace-nowrap">
                <thead className="bg-muted/40 text-muted-foreground uppercase text-[10px] tracking-wider border-b">
                  <tr>
                    <th className="py-3 px-3">Invoice No</th>
                    <th className="py-3 px-3">Subscriber</th>
                    <th className="py-3 px-3">Package</th>
                    <th className="py-3 px-3">Cancel Reason</th>
                    <th className="py-3 px-3">Description</th>
                    <th className="py-3 px-3">Buy-Again Date</th>
                    <th className="py-3 px-3">Cancel Date</th>
                    <th className="py-3 px-3">Cancel Time</th>
                    <th className="py-3 px-3">City &amp; Postal</th>
                    <th className="py-3 px-3">State &amp; Country</th>
                    <th className="py-3 px-3">Dues</th>
                    <th className="py-3 px-3">Status</th>
                    <th className="py-3 px-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {paginatedRecords.map((c) => (
                    <tr key={c.id} className="hover:bg-muted/20 transition-colors">
                      <td className="py-3 px-3 font-mono font-bold text-foreground">
                        {c.cancel_invoice_id || c.id}
                      </td>
                      <td className="py-3 px-3">
                        <p className="font-semibold text-foreground">{c.subscriber_name || 'Subscriber'}</p>
                        <p className="text-[10px] text-muted-foreground font-mono">{c.subscriber_id}</p>
                      </td>
                      <td className="py-3 px-3 font-medium text-foreground">
                        {c.package_name || 'Standard'}
                      </td>
                      <td className="py-3 px-3">
                        <Badge variant="outline" className="text-[10px] font-normal">
                          {c.reason}
                        </Badge>
                      </td>
                      <td className="py-3 px-3 max-w-[150px] truncate" title={c.description}>
                        {c.description || '—'}
                      </td>
                      <td className="py-3 px-3 font-mono text-[11px]">
                        {c.not_sure_buy_again ? 'Not sure yet' : c.buy_again_date || '—'}
                      </td>
                      <td className="py-3 px-3 font-mono">
                        {c.cancel_date || '—'}
                      </td>
                      <td className="py-3 px-3 font-mono">
                        {c.cancel_time || '—'}
                      </td>
                      <td className="py-3 px-3">
                        {c.city || 'Azimpur'}, {c.postal_code || '1205'}
                      </td>
                      <td className="py-3 px-3">
                        {c.state || 'Dhaka Division'}, {c.country || 'Bangladesh'}
                      </td>
                      <td className="py-3 px-3 font-mono font-semibold">
                        <span className={Number(c.outstanding_balance || 0) > 0 ? 'text-rose-600' : 'text-emerald-600'}>
                          ${Number(c.outstanding_balance || 0).toFixed(2)}
                        </span>
                      </td>
                      <td className="py-3 px-3">
                        <Badge className="bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/30">
                          {c.status ? c.status.toUpperCase() : 'CANCELLED'}
                        </Badge>
                      </td>
                      <td className="py-3 px-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setSelectedRecord(c)}
                            className="h-7 px-2 text-xs font-semibold gap-1"
                          >
                            <Eye className="h-3.5 w-3.5 text-primary" />
                            View
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => handleOpenPdf(c.cancel_invoice_id)}
                            className="h-7 px-2 text-xs font-semibold gap-1"
                          >
                            <Download className="h-3.5 w-3.5" />
                            PDF
                          </Button>
                          {/* NOTE: Absolutely NO delete button per requirement */}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {filteredRecords.length > pageSize && (
            <div className="flex items-center justify-between p-3 border-t text-xs text-muted-foreground">
              <span>
                Showing {(currentPage - 1) * pageSize + 1} to{' '}
                {Math.min(currentPage * pageSize, filteredRecords.length)} of {filteredRecords.length} records
              </span>
              <div className="flex items-center gap-1.5">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="h-7 px-2 text-xs"
                >
                  Previous
                </Button>
                <span className="font-mono px-2">
                  {currentPage} / {totalPages}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="h-7 px-2 text-xs"
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* DETAILS VIEW MODAL */}
      {selectedRecord && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-background border rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl p-6 space-y-5 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b pb-3">
              <div>
                <Badge variant="outline" className="text-[10px] uppercase font-bold text-rose-600 border-rose-300">
                  Cancellation Audit Record
                </Badge>
                <h3 className="text-lg font-black text-foreground mt-1">
                  Cancellation {selectedRecord.id}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedRecord(null)}
                className="text-muted-foreground hover:text-foreground p-1 rounded-md"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Session Info 4-box block */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="p-2.5 rounded-lg border bg-muted/20">
                <span className="text-[10px] font-bold text-muted-foreground uppercase">Cancel Date</span>
                <p className="text-xs font-bold text-foreground mt-0.5 font-mono">
                  {selectedRecord.cancel_date || '—'}
                </p>
                <span className="text-[9px] text-muted-foreground">Format: (DD/MM/YYYY)</span>
              </div>
              <div className="p-2.5 rounded-lg border bg-muted/20">
                <span className="text-[10px] font-bold text-muted-foreground uppercase">Cancel Time</span>
                <p className="text-xs font-bold text-foreground mt-0.5 font-mono">
                  {selectedRecord.cancel_time || '—'}
                </p>
                <span className="text-[9px] text-muted-foreground">Format: (00:00AM/PM)</span>
              </div>
              <div className="p-2.5 rounded-lg border bg-muted/20">
                <span className="text-[10px] font-bold text-muted-foreground uppercase">City &amp; Postal</span>
                <p className="text-xs font-bold text-foreground mt-0.5 truncate">
                  {selectedRecord.city || 'Azimpur'}, {selectedRecord.postal_code || '1205'}
                </p>
                <span className="text-[9px] text-muted-foreground">
                  Postal: {selectedRecord.postal_code || '1205'}
                </span>
              </div>
              <div className="p-2.5 rounded-lg border bg-muted/20">
                <span className="text-[10px] font-bold text-muted-foreground uppercase">State &amp; Country</span>
                <p className="text-xs font-bold text-foreground mt-0.5 truncate">
                  {selectedRecord.state || 'Dhaka Division'}, {selectedRecord.country || 'Bangladesh'}
                </p>
                <span className="text-[9px] text-muted-foreground">
                  Country: {selectedRecord.country || 'Bangladesh'}
                </span>
              </div>
            </div>

            {/* Subscriber & Package Details */}
            <div className="space-y-2 p-3 rounded-lg border bg-card text-xs">
              <div className="flex justify-between py-1 border-b">
                <span className="text-muted-foreground">Subscriber Account:</span>
                <span className="font-bold text-foreground">
                  {selectedRecord.subscriber_name || 'Subscriber'} ({selectedRecord.subscriber_id})
                </span>
              </div>
              <div className="flex justify-between py-1 border-b">
                <span className="text-muted-foreground">Subscribed Package:</span>
                <span className="font-bold text-foreground">{selectedRecord.package_name}</span>
              </div>
              <div className="flex justify-between py-1 border-b">
                <span className="text-muted-foreground">Associated Cancel Invoice:</span>
                <span className="font-mono font-bold text-foreground">{selectedRecord.cancel_invoice_id}</span>
              </div>
              <div className="flex justify-between py-1 border-b">
                <span className="text-muted-foreground">Cancellation Reason:</span>
                <span className="font-bold text-foreground">{selectedRecord.reason}</span>
              </div>
              <div className="flex justify-between py-1 border-b">
                <span className="text-muted-foreground">Buy-Again Timeline:</span>
                <span className="font-bold text-foreground">
                  {selectedRecord.not_sure_buy_again ? 'Not sure yet' : selectedRecord.buy_again_date || 'N/A'}
                </span>
              </div>
              <div className="py-1 border-b">
                <span className="text-muted-foreground block mb-0.5">Subscriber Feedback / Notes:</span>
                <p className="text-foreground italic bg-muted/30 p-2.5 rounded-sm whitespace-pre-wrap">
                  {selectedRecord.description || 'No description provided.'}
                </p>
              </div>
              <div className="flex justify-between py-1 text-sm font-bold pt-2">
                <span>Final Dues Carried:</span>
                <span className="font-mono text-rose-600">
                  ${Number(selectedRecord.outstanding_balance || 0).toFixed(2)}
                </span>
              </div>
            </div>

            <div className="flex items-center justify-between pt-2">
              <span className="text-[11px] text-muted-foreground">
                NextLink Admin Billing • Real Capture IP: {selectedRecord.client_ip || '127.0.0.1'}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setSelectedRecord(null)}
                  className="text-xs"
                >
                  Close
                </Button>
                <Button
                  size="sm"
                  variant="default"
                  onClick={() => handleOpenPdf(selectedRecord.cancel_invoice_id)}
                  className="text-xs font-bold gap-1.5"
                >
                  <Download className="h-3.5 w-3.5" />
                  View &amp; Print PDF
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

