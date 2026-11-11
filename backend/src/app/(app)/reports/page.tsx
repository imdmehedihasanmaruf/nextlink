'use client';

import { useEffect, useMemo, useState } from 'react';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { Download, TrendingUp, Users, DollarSign, Activity, Trash2, RotateCcw } from 'lucide-react';
import toast from 'react-hot-toast';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAdminDataStore } from '@/store/adminDataStore';

export default function ReportsPage() {
  const t = (en: string, _bn?: string) => en;
  const { invoices, subscribers, clearCollection, fetchData } = useAdminDataStore();
  const [reportFilter, setReportFilter] = useState<'all' | 'recent'>('all');

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  /**
   * Real export: a CSV of the current invoice list is generated in the
   * browser and downloaded. The previous button only toasted a success
   * message and exported nothing.
   */
  const handleExport = () => {
    if (invoices.length === 0) {
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
      ['Invoice', 'Subscriber', 'Period', 'Due Date', 'Amount', 'Status'].join(','),
      ...invoices.map((inv: any) =>
        [
          escapeCsv(inv.id),
          escapeCsv(inv.subscriberName || inv.raw_data?.subscriberName || inv.subscriberId || ''),
          escapeCsv(inv.raw_data?.period || inv.month || ''),
          escapeCsv(inv.dueDate || inv.due_date || ''),
          escapeCsv(inv.amount),
          escapeCsv(inv.status || 'unpaid'),
        ].join(','),
      ),
    ];

    const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nextlink-invoices-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${invoices.length} invoice(s).`);
  };

  // Derive real monthly revenue data
  const revenueChartData = useMemo(() => {
    if (invoices.length === 0) return [];
    const grouped = invoices.reduce((acc: Record<string, { month: string; revenue: number; collection: number }>, inv) => {
      const m = inv.month || inv.issueDate?.slice(0, 7) || 'Current';
      if (!acc[m]) acc[m] = { month: m, revenue: 0, collection: 0 };
      acc[m].revenue += inv.amount;
      if (inv.status === 'paid') acc[m].collection += inv.amount;
      return acc;
    }, {});
    return Object.values(grouped);
  }, [invoices]);

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
    return Object.keys(byMonth).sort().map(m => {
      runningTotal += byMonth[m].new;
      return { month: m, total: runningTotal, new: byMonth[m].new };
    });
  }, [subscribers]);

  const totalBilled = invoices.reduce((sum, inv) => sum + inv.amount, 0);
  const totalCollected = invoices.filter(i => i.status === 'paid').reduce((sum, inv) => sum + inv.amount, 0);
  const activeCount = subscribers.filter(s => s.status === 'active').length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Reports & Business Analytics</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Financial statements, subscriber expansion, and network operational insights.
          </p>
        </div>
        <Button onClick={handleExport} variant="outline" className="gap-2">
          <Download className="h-4 w-4" />
          Export CSV
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Revenue Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-emerald-500" />
              Monthly Revenue & Gateway Collection (USD)
            </CardTitle>
            <CardDescription>Comparison of total invoiced vs realized cash</CardDescription>
          </CardHeader>
          <CardContent className="h-80">
            {revenueChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={revenueChartData}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                  <XAxis dataKey="month" />
                  <YAxis />
                  <Tooltip formatter={(v: number) => [`$${v.toLocaleString()}`, '']} />
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
                Subscriber Growth & Retention
              </CardTitle>
              <CardDescription>Total active users and monthly new on-boarding</CardDescription>
            </div>
            {subscriberGrowthData.length > 0 && (
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  if (confirm('Delete subscriber report dataset?')) {
                    await clearCollection('subscribers');
                    toast.success('Subscriber analytics deleted');
                  }
                }}
                className="h-8 gap-1 text-xs text-rose-500 hover:text-rose-600 hover:bg-rose-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </Button>
            )}
          </CardHeader>
          <CardContent className="h-80">
            {subscriberGrowthData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={subscriberGrowthData}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                  <XAxis dataKey="month" />
                  <YAxis />
                  <Tooltip />
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

      {/* Summary KPI grid */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Total Invoiced</p>
            <h3 className="text-xl font-bold mt-1">${totalBilled.toLocaleString()}</h3>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Total Realized</p>
            <h3 className="text-xl font-bold text-emerald-600 mt-1">${totalCollected.toLocaleString()}</h3>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Active Subscriptions</p>
            <h3 className="text-xl font-bold text-blue-600 mt-1">{activeCount}</h3>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Collected Rate</p>
            <h3 className="text-xl font-bold text-emerald-600 mt-1">
              {totalBilled > 0 ? `${Math.round((totalCollected / totalBilled) * 100)}%` : '—'}
            </h3>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
