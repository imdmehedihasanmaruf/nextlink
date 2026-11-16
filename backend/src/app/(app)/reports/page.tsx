'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { Download, TrendingUp, Users, DollarSign, Receipt, Ban, Calendar, Filter } from 'lucide-react';
import toast from 'react-hot-toast';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { useAdminDataStore } from '@/store/adminDataStore';
import { apiGet } from '@/lib/apiClient';

export default function ReportsPage() {
  const { invoices, subscribers, fetchData } = useAdminDataStore();
  const [cancellations, setCancellations] = useState<any[]>([]);
  const [cancelStartDate, setCancelStartDate] = useState('');
  const [cancelEndDate, setCancelEndDate] = useState('');

  const fetchCancellations = useCallback(async () => {
    try {
      const res = await apiGet<{ cancellations: any[] }>('/api/billing/cancellations?limit=200');
      if (res.success && Array.isArray(res.cancellations)) {
        setCancellations(res.cancellations);
      }
    } catch {
      // non-blocking
    }
  }, []);

  useEffect(() => {
    fetchData();
    fetchCancellations();
  }, [fetchData, fetchCancellations]);

  const filteredCancellations = useMemo(() => {
    return cancellations.filter((c) => {
      if (!c.created_at) return true;
      const cDate = c.created_at.slice(0, 10);
      if (cancelStartDate && cDate < cancelStartDate) return false;
      if (cancelEndDate && cDate > cancelEndDate) return false;
      return true;
    });
  }, [cancellations, cancelStartDate, cancelEndDate]);

  const reasonsBreakdown = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const c of filteredCancellations) {
      const r = c.reason || 'Other';
      counts[r] = (counts[r] || 0) + 1;
    }
    const total = filteredCancellations.length || 1;
    return Object.entries(counts).map(([reason, count]) => ({
      reason,
      count,
      percent: Math.round((count / total) * 100),
    })).sort((a, b) => b.count - a.count);
  }, [filteredCancellations]);

  const handleExportCancellations = () => {
    if (filteredCancellations.length === 0) {
      toast.error('No cancellations match the selected criteria.');
      return;
    }
    const escapeCsv = (value: any) => {
      const text = String(value ?? '');
      return text.includes(',') || text.includes('"') || text.includes('\n')
        ? `"${text.replace(/"/g, '""')}"`
        : text;
    };
    const rows = [
      ['ID', 'Invoice No', 'Subscriber ID', 'Subscriber Name', 'Package', 'Cancel Date', 'Cancel Time', 'Reason', 'Description', 'Buy-Again Date', 'Outstanding Balance', 'Status'].join(','),
      ...filteredCancellations.map((c: any) =>
        [
          escapeCsv(c.id),
          escapeCsv(c.cancel_invoice_id || ''),
          escapeCsv(c.subscriber_id || ''),
          escapeCsv(c.subscriber_name || ''),
          escapeCsv(c.package_name || ''),
          escapeCsv(c.cancel_date || ''),
          escapeCsv(c.cancel_time || ''),
          escapeCsv(c.reason || ''),
          escapeCsv(c.description || ''),
          escapeCsv(c.not_sure_buy_again ? 'Not sure yet' : c.buy_again_date || ''),
          escapeCsv(Number(c.outstanding_balance || 0).toFixed(2)),
          escapeCsv(c.status || 'cancelled'),
        ].join(',')
      ),
    ];
    const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nextlink-cancellations-report-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${filteredCancellations.length} cancellation record(s).`);
  };

  const enrichedInvoices = useMemo(() => {
    return invoices.map((inv: any) => {
      const installationFee = Number(inv.installationFee ?? inv.raw_data?.installationFee ?? 0);
      const taxFee = Number(inv.taxFee ?? inv.raw_data?.taxFee ?? 0);
      const lateFee = Number(inv.lateFee ?? inv.raw_data?.lateFee ?? 0);
      const carriedOverAmount = Number(inv.carriedOverAmount ?? inv.raw_data?.carriedOverAmount ?? 0);
      const totalAmount = Number(inv.amount || 0);
      const packagePrice = Number(
        inv.raw_data?.packagePrice ??
          Math.max(0, Number((totalAmount - installationFee - taxFee - lateFee - carriedOverAmount).toFixed(2))),
      );
      return {
        ...inv,
        packagePrice,
        installationFee,
        taxFee,
        lateFee,
        carriedOverAmount,
        totalAmount,
      };
    });
  }, [invoices]);

  const handleExport = () => {
    if (enrichedInvoices.length === 0) {
      toast.error('There are no invoices to export yet.');
      return;
    }

    const escapeCsv = (value: any) => {
      const text = String(value ?? '');
      return text.includes(',') || text.includes('"') || text.includes('\n')
        ? `"${text.replace(/"/g, '""')}"`
        : text;
    };

    const rows = [
      [
        'Invoice',
        'Subscriber',
        'Package',
        'Period',
        'Due Date',
        'Package Price',
        'Installation Fee',
        'Tax',
        'Late Fee',
        'Carried Over',
        'Total Amount',
        'Status',
      ].join(','),
      ...enrichedInvoices.map((inv: any) =>
        [
          escapeCsv(inv.id),
          escapeCsv(inv.subscriberName || inv.raw_data?.subscriberName || inv.subscriberId || ''),
          escapeCsv(inv.packageName || inv.raw_data?.packageName || ''),
          escapeCsv(inv.raw_data?.period || inv.month || ''),
          escapeCsv(inv.dueDate || inv.due_date || ''),
          escapeCsv(inv.packagePrice.toFixed(2)),
          escapeCsv(inv.installationFee.toFixed(2)),
          escapeCsv(inv.taxFee.toFixed(2)),
          escapeCsv(inv.lateFee.toFixed(2)),
          escapeCsv(inv.carriedOverAmount.toFixed(2)),
          escapeCsv(inv.totalAmount.toFixed(2)),
          escapeCsv(inv.status || 'unpaid'),
        ].join(','),
      ),
    ];

    const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nextlink-financial-report-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${enrichedInvoices.length} invoice(s) with itemized fees.`);
  };

  // Derive real monthly revenue data
  const revenueChartData = useMemo(() => {
    if (enrichedInvoices.length === 0) return [];
    const grouped = enrichedInvoices.reduce(
      (
        acc: Record<
          string,
          { month: string; revenue: number; collection: number; installationFees: number; taxes: number; lateFees: number }
        >,
        inv,
      ) => {
        const m = inv.month || inv.issueDate?.slice(0, 7) || 'Current';
        if (!acc[m]) {
          acc[m] = { month: m, revenue: 0, collection: 0, installationFees: 0, taxes: 0, lateFees: 0 };
        }
        acc[m].revenue = Number((acc[m].revenue + inv.totalAmount).toFixed(2));
        acc[m].installationFees = Number((acc[m].installationFees + inv.installationFee).toFixed(2));
        acc[m].taxes = Number((acc[m].taxes + inv.taxFee).toFixed(2));
        acc[m].lateFees = Number((acc[m].lateFees + inv.lateFee).toFixed(2));
        if (inv.status === 'paid') {
          acc[m].collection = Number((acc[m].collection + inv.totalAmount).toFixed(2));
        }
        return acc;
      },
      {},
    );
    return Object.values(grouped);
  }, [enrichedInvoices]);

  // Derive real subscriber growth data
  const subscriberGrowthData = useMemo(() => {
    if (subscribers.length === 0) return [];
    const byMonth = subscribers.reduce((acc: Record<string, { month: string; total: number; new: number }>, sub) => {
      const m = sub.joinDate?.slice(0, 7) || 'Recent';
      if (!acc[m]) acc[m] = { month: m, total: 0, new: 0 };
      acc[m].new += 1;
      return acc;
    }, {});
    let runningTotal = 0;
    return Object.keys(byMonth)
      .sort()
      .map((m) => {
        runningTotal += byMonth[m].new;
        return { month: m, total: runningTotal, new: byMonth[m].new };
      });
  }, [subscribers]);

  const totalBilled = enrichedInvoices.reduce((sum, inv) => sum + inv.totalAmount, 0);
  const totalCollected = enrichedInvoices
    .filter((i) => i.status === 'paid')
    .reduce((sum, inv) => sum + inv.totalAmount, 0);
  const totalInstallationFees = enrichedInvoices.reduce((sum, inv) => sum + inv.installationFee, 0);
  const totalTaxes = enrichedInvoices.reduce((sum, inv) => sum + inv.taxFee, 0);
  const totalLateFees = enrichedInvoices.reduce((sum, inv) => sum + inv.lateFee, 0);
  const activeCount = subscribers.filter((s) => s.status === 'active').length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Reports &amp; Business Analytics</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Financial statements, itemized installation/tax/late fee audit, and subscriber expansion insights.
          </p>
        </div>
        <Button onClick={handleExport} variant="outline" className="gap-2">
          <Download className="h-4 w-4" />
          Export CSV
        </Button>
      </div>

      {/* Summary KPI grid including separate Installation Fees, Tax, and Late Fees */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Total Invoiced</p>
            <h3 className="text-xl font-bold mt-1 font-mono">${totalBilled.toFixed(2)}</h3>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Total Realized</p>
            <h3 className="text-xl font-bold text-emerald-600 mt-1 font-mono">${totalCollected.toFixed(2)}</h3>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Installation Fees</p>
            <h3 className="text-xl font-bold text-blue-600 mt-1 font-mono">${totalInstallationFees.toFixed(2)}</h3>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Tax Collected / Billed</p>
            <h3 className="text-xl font-bold text-indigo-600 mt-1 font-mono">${totalTaxes.toFixed(2)}</h3>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Late Fees</p>
            <h3 className="text-xl font-bold text-rose-600 mt-1 font-mono">${totalLateFees.toFixed(2)}</h3>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Active Subscriptions</p>
            <h3 className="text-xl font-bold text-primary mt-1">{activeCount}</h3>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Revenue Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-emerald-500" />
              Monthly Revenue &amp; Gateway Collection (USD)
            </CardTitle>
            <CardDescription>Comparison of total invoiced vs realized cash</CardDescription>
          </CardHeader>
          <CardContent className="h-80">
            {revenueChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={revenueChartData}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} stroke="hsl(var(--border))" />
                  <XAxis dataKey="month" />
                  <YAxis />
                  <Tooltip
                    formatter={(v: number) => [`$${Number(v).toFixed(2)}`, '']}
                    contentStyle={{
                      backgroundColor: 'hsl(var(--card))',
                      borderColor: 'hsl(var(--border))',
                      color: 'hsl(var(--card-foreground))',
                      borderRadius: '0.5rem',
                      boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.3)',
                    }}
                  />
                  <Legend />
                  <Bar dataKey="revenue" fill="hsl(var(--primary))" name="Invoiced" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="collection" fill="#10b981" name="Collected" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-center p-6 border-2 border-dashed rounded-xl border-border/60">
                <DollarSign className="h-10 w-10 text-muted-foreground/40 mb-2" />
                <p className="text-sm font-semibold text-muted-foreground">No Revenue History Available</p>
                <p className="text-xs text-muted-foreground mt-1 max-w-xs">
                  Invoices generated in the Billing module will appear in this report.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Subscriber Growth Chart */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-primary" />
                Subscriber Growth &amp; Retention
              </CardTitle>
              <CardDescription>Total active users and monthly new on-boarding</CardDescription>
            </div>
            {subscriberGrowthData.length > 0 && (
              <Button
                size="sm"
                variant="ghost"
                onClick={handleExport}
                className="h-8 gap-1 text-xs text-primary hover:text-primary hover:bg-primary/5"
              >
                <Download className="h-3.5 w-3.5" />
                Export CSV
              </Button>
            )}
          </CardHeader>
          <CardContent className="h-80">
            {subscriberGrowthData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={subscriberGrowthData}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} stroke="hsl(var(--border))" />
                  <XAxis dataKey="month" />
                  <YAxis />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'hsl(var(--card))',
                      borderColor: 'hsl(var(--border))',
                      color: 'hsl(var(--card-foreground))',
                      borderRadius: '0.5rem',
                      boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.3)',
                    }}
                  />
                  <Legend />
                  <Line type="monotone" dataKey="total" stroke="hsl(var(--primary))" strokeWidth={3} name="Total Active" />
                  <Line type="monotone" dataKey="new" stroke="#10b981" strokeWidth={2} name="New Signups" />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-center p-6 border-2 border-dashed rounded-xl border-border/60">
                <Users className="h-10 w-10 text-muted-foreground/40 mb-2" />
                <p className="text-sm font-semibold text-muted-foreground">No Subscriber Cohorts Recorded</p>
                <p className="text-xs text-muted-foreground mt-1 max-w-xs">
                  Active optical subscribers will automatically plot expansion trends here.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Itemized Financial Report Table with separate Installation Fees, Tax, and Late Fees columns */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Receipt className="h-5 w-5 text-primary" />
            Itemized Financial Ledger (Installation Fees, Tax &amp; Late Fees)
          </CardTitle>
          <CardDescription>
            Complete invoice breakdown with separate columns for plan charges, installation fees, tax, carried-over balances, and 2% late fees.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {enrichedInvoices.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">No invoices recorded yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                    <th className="py-3 px-3">Invoice #</th>
                    <th className="py-3 px-3">Subscriber</th>
                    <th className="py-3 px-3">Package</th>
                    <th className="py-3 px-3">Period</th>
                    <th className="py-3 px-3 text-right">Plan Price</th>
                    <th className="py-3 px-3 text-right">Installation Fee</th>
                    <th className="py-3 px-3 text-right">Tax</th>
                    <th className="py-3 px-3 text-right">Late Fee</th>
                    <th className="py-3 px-3 text-right">Carried Over</th>
                    <th className="py-3 px-3 text-right">Total</th>
                    <th className="py-3 px-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {enrichedInvoices.map((inv: any) => (
                    <tr key={inv.id} className="hover:bg-muted/30">
                      <td className="py-2.5 px-3 font-mono text-xs font-medium">{inv.id}</td>
                      <td className="py-2.5 px-3 font-medium">
                        {inv.subscriberName || inv.raw_data?.subscriberName || inv.subscriberId}
                      </td>
                      <td className="py-2.5 px-3 text-xs">{inv.packageName || inv.raw_data?.packageName || '—'}</td>
                      <td className="py-2.5 px-3 text-xs">{inv.month || inv.raw_data?.period || '—'}</td>
                      <td className="py-2.5 px-3 text-right font-mono">${inv.packagePrice.toFixed(2)}</td>
                      <td className="py-2.5 px-3 text-right font-mono text-blue-600">
                        ${inv.installationFee.toFixed(2)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono text-indigo-600">
                        ${inv.taxFee.toFixed(2)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono text-rose-600">
                        ${inv.lateFee.toFixed(2)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono text-amber-600">
                        ${inv.carriedOverAmount.toFixed(2)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-bold">
                        ${inv.totalAmount.toFixed(2)}
                      </td>
                      <td className="py-2.5 px-3">
                        <Badge
                          className={
                            inv.status === 'paid'
                              ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30'
                              : inv.status === 'overdue'
                                ? 'bg-rose-500/10 text-rose-600 border-rose-500/30'
                                : 'bg-amber-500/10 text-amber-600 border-amber-500/30'
                          }
                        >
                          {inv.status || 'unpaid'}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Cancellations Analytics & Reporting (Part 6) */}
      <Card>
        <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <Ban className="h-5 w-5 text-rose-600" />
              Subscriber Cancellations &amp; Churn Analytics
            </CardTitle>
            <CardDescription>
              Analyze churn rate, reason drivers, termination date cohorts, and export cancellations to CSV.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 text-xs">
              <span className="text-muted-foreground">From:</span>
              <Input
                type="date"
                value={cancelStartDate}
                onChange={(e) => setCancelStartDate(e.target.value)}
                className="h-8 text-xs w-36"
              />
            </div>
            <div className="flex items-center gap-1.5 text-xs">
              <span className="text-muted-foreground">To:</span>
              <Input
                type="date"
                value={cancelEndDate}
                onChange={(e) => setCancelEndDate(e.target.value)}
                className="h-8 text-xs w-36"
              />
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={handleExportCancellations}
              className="h-8 gap-1.5 text-xs font-semibold"
            >
              <Download className="h-3.5 w-3.5" />
              Export Cancellations CSV
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 rounded-xl border bg-muted/20">
              <span className="text-xs font-semibold uppercase text-muted-foreground">Filtered Cancellations</span>
              <p className="text-2xl font-black font-mono text-foreground mt-1">{filteredCancellations.length}</p>
              <p className="text-xs text-muted-foreground mt-0.5">Matching date range</p>
            </div>
            <div className="p-4 rounded-xl border bg-muted/20">
              <span className="text-xs font-semibold uppercase text-muted-foreground">Top Churn Driver</span>
              <p className="text-lg font-bold text-foreground mt-1 truncate">
                {reasonsBreakdown[0]?.reason || 'None recorded'}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {reasonsBreakdown[0] ? `${reasonsBreakdown[0].count} subscriber(s) (${reasonsBreakdown[0].percent}%)` : '—'}
              </p>
            </div>
            <div className="p-4 rounded-xl border bg-muted/20">
              <span className="text-xs font-semibold uppercase text-muted-foreground">Total Unsettled Dues</span>
              <p className="text-2xl font-black font-mono text-rose-600 mt-1">
                ${filteredCancellations.reduce((sum, c) => sum + Number(c.outstanding_balance || 0), 0).toFixed(2)}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">Retained payable balance</p>
            </div>
          </div>

          {/* Reasons Breakdown */}
          <div className="space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Cancellation Reasons Breakdown
            </h4>
            {reasonsBreakdown.length === 0 ? (
              <p className="text-xs text-muted-foreground py-2">No cancellation reasons to display.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {reasonsBreakdown.map((r) => (
                  <div key={r.reason} className="p-3 rounded-lg border bg-card space-y-1.5">
                    <div className="flex justify-between text-xs font-medium">
                      <span className="text-foreground">{r.reason}</span>
                      <span className="font-mono text-muted-foreground">
                        {r.count} ({r.percent}%)
                      </span>
                    </div>
                    <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-rose-500 rounded-full"
                        style={{ width: `${r.percent}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
