'use client';
import { useEffect, useMemo, useState } from 'react';
import { Users, Wifi, WifiOff, UserPlus, BanknoteIcon, AlertCircle, CheckCircle, Trash2, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/button';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { StatsCard } from '@/components/StatsCard';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useAdminDataStore } from '@/store/adminDataStore';
import { getStatusColor } from '@/lib/utils';
import { apiGet } from '@/lib/apiClient';

export default function DashboardPage() {
  const { subscribers, invoices, tickets, deleteTicket, clearCollection, fetchData } = useAdminDataStore();
  const [apiHealth, setApiHealth] = useState<any | null>(null);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    let cancelled = false;
    apiGet<any>('/health', false).then((result) => {
      if (!cancelled && result) setApiHealth(result);
    }).catch(() => {
      if (!cancelled) setApiHealth(null);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Accounts vs subscribers: an account exists as soon as someone registers;
  // a subscriber is an account with a live plan.
  const totalUsers = subscribers.length;
  const activeSubscribers = subscribers.filter(s => s.status === 'active').length;
  const registeredUsers = subscribers.filter(s => s.status === 'registered').length;
  const suspendedSubscribers = subscribers.filter(s => s.status === 'suspended').length;
  const cancelledUsers = subscribers.filter(s => s.status === 'cancelled').length;
  const collectedRevenue = invoices.filter(i => i.status === 'paid').reduce((sum, inv) => sum + inv.amount, 0);
  const openTickets = tickets.filter(tk => tk.status === 'open' || tk.status === 'in_progress');
  const pendingInvoices = invoices.filter(i => i.status !== 'paid');

  const recentTickets = openTickets.slice(0, 5);

  // Derive real monthly revenue chart data from actual database invoices
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

  // Derive real subscriber growth data from actual subscribers
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground mt-1">Real-time ISP infrastructure, subscribers, and operations.</p>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatsCard
          title="Total Users"
          value={totalUsers}
          icon={<Users className="h-5 w-5 text-primary" />}
          trend="up"
          trendValue="Every registered account"
          iconBg="bg-primary/10"
        />
        <StatsCard
          title="Active Subscribers"
          value={activeSubscribers}
          icon={<Wifi className="h-5 w-5 text-green-600" />}
          trend="up"
          trendValue={totalUsers > 0 ? `${Math.round((activeSubscribers / totalUsers) * 100)}% of all users` : '0 subscribers'}
          iconBg="bg-green-100 dark:bg-green-900/30"
        />
        <StatsCard
          title="Registered (No Plan)"
          value={registeredUsers}
          icon={<UserPlus className="h-5 w-5 text-blue-600" />}
          trend="neutral"
          trendValue={registeredUsers > 0 ? 'Awaiting a package purchase' : 'All users have a plan'}
          iconBg="bg-blue-100 dark:bg-blue-900/30"
        />
        <StatsCard
          title="Cancelled"
          value={cancelledUsers}
          icon={<WifiOff className="h-5 w-5 text-amber-600" />}
          trend="neutral"
          trendValue={cancelledUsers > 0 ? 'Left the subscriber list' : 'None cancelled'}
          iconBg="bg-amber-100 dark:bg-amber-900/30"
        />
        <StatsCard
          title="Suspended"
          value={suspendedSubscribers}
          icon={<WifiOff className="h-5 w-5 text-red-600" />}
          trend={suspendedSubscribers > 0 ? 'down' : 'neutral'}
          trendValue={suspendedSubscribers > 0 ? 'Requires attention' : 'All lines active'}
          iconBg="bg-red-100 dark:bg-red-900/30"
        />
        <StatsCard
          title="Revenue Collected"
          value={`$${collectedRevenue.toLocaleString()}`}
          icon={<BanknoteIcon className="h-5 w-5 text-orange-600" />}
          trend="up"
          trendValue={`${invoices.length} invoices generated`}
          iconBg="bg-orange-100 dark:bg-orange-900/30"
        />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Revenue Chart */}
        <Card>
          <CardHeader>
            <CardTitle>Revenue Overview</CardTitle>
            <CardDescription>Monthly billed revenue vs actual collections (USD)</CardDescription>
          </CardHeader>
          <CardContent>
            {revenueChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={revenueChartData} margin={{ top: 0, right: 0, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${v}`} />
                  <Tooltip formatter={(v: number) => [`$${v.toLocaleString()}`, '']} />
                  <Legend />
                  <Bar dataKey="revenue" name="Billed Revenue" fill="var(--primary)" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="collection" name="Collected" fill="#22c55e" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[260px] flex flex-col items-center justify-center text-center p-6 border-2 border-dashed rounded-xl border-border/60">
                <BanknoteIcon className="h-10 w-10 text-muted-foreground/40 mb-2" />
                <p className="text-sm font-semibold text-muted-foreground">No Billing Data Recorded</p>
                <p className="text-xs text-muted-foreground mt-1 max-w-xs">
                  Generate customer invoices in the Billing module to view monthly collections here.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Subscriber Growth */}
        <Card>
          <CardHeader>
            <CardTitle>Subscriber Growth</CardTitle>
            <CardDescription>Total active subscribers trend</CardDescription>
          </CardHeader>
          <CardContent>
            {subscriberGrowthData.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={subscriberGrowthData} margin={{ top: 0, right: 0, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="total" name="Total Lines" stroke="var(--primary)" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="new" name="New Subscriptions" stroke="#22c55e" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[260px] flex flex-col items-center justify-center text-center p-6 border-2 border-dashed rounded-xl border-border/60">
                <Users className="h-10 w-10 text-muted-foreground/40 mb-2" />
                <p className="text-sm font-semibold text-muted-foreground">No Subscriber Growth History</p>
                <p className="text-xs text-muted-foreground mt-1 max-w-xs">
                  Newly registered optical connections will automatically populate this trend graph.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Bottom widgets */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Recent Tickets */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-orange-500" />
              Recent Support Tickets
            </CardTitle>
          </CardHeader>
          <CardContent>
            {recentTickets.length > 0 ? (
              <div className="space-y-3">
                {recentTickets.map((ticket) => (
                  <div key={ticket.id} className="flex items-center gap-3 rounded-lg border p-3 hover:bg-muted/30 transition-colors">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{ticket.subject}</p>
                      <p className="text-xs text-muted-foreground">{ticket.subscriberName} · {ticket.id}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${getStatusColor(ticket.priority)}`}>
                        {ticket.priority}
                      </span>
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${getStatusColor(ticket.status)}`}>
                        {ticket.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-10 text-center border-2 border-dashed rounded-xl border-border/60">
                <CheckCircle className="h-8 w-8 text-emerald-500/60 mx-auto mb-2" />
                <p className="text-sm font-semibold text-muted-foreground">No Open Support Tickets</p>
                <p className="text-xs text-muted-foreground mt-0.5">All customer support queries have been resolved.</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* System Status */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-green-500" />
              Core Infrastructure Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {/* Status is read from the live API health probe. The previous
                  panel showed hard-coded green "Operational" dots no matter
                  what the system was actually doing. */}
              {[
                {
                  label: 'Automated Billing Engine',
                  status: apiHealth?.database === 'connected' ? 'Operational' : 'Unavailable',
                  ok: apiHealth?.database === 'connected',
                  warn: false,
                },
                {
                  label: 'MikroTik RouterOS API',
                  status: apiHealth?.mikrotikMode === 'live' ? 'Live' : (apiHealth?.mikrotikMode ? 'Simulator' : 'Unknown'),
                  ok: apiHealth?.mikrotikMode === 'live',
                  // A simulator is not a working router — the dot is amber, not
                  // green, so the panel never shows a healthy router that does
                  // not exist.
                  warn: apiHealth?.mikrotikMode === 'simulator',
                },
                {
                  label: 'SMS & OTP Gateway',
                  status: apiHealth?.smsMode === 'live' ? 'Live' : (apiHealth?.smsMode ? 'Mock Mode' : 'Unknown'),
                  ok: apiHealth?.smsMode === 'live',
                  warn: apiHealth?.smsMode === 'mock',
                },
                {
                  label: 'Payment Gateways',
                  status: apiHealth?.paymentMode === 'live' ? 'Live' : (apiHealth?.paymentMode ? 'Mock Mode' : 'Unknown'),
                  ok: apiHealth?.paymentMode === 'live',
                  warn: apiHealth?.paymentMode === 'mock',
                },
                {
                  label: 'Job Queue',
                  status: apiHealth?.queue?.mode ? `${apiHealth.queue.mode === 'redis' ? 'Redis' : 'In-Process'} (${apiHealth.queue.pending ?? 0} pending)` : 'Unknown',
                  ok: Boolean(apiHealth?.queue?.mode),
                  warn: false,
                },
              ].map((item) => (
                <div key={item.label} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className={`h-2 w-2 rounded-full ${item.ok ? 'bg-green-500' : item.warn ? 'bg-amber-500' : 'bg-rose-500'}`} />
                    <span className="text-sm font-medium">{item.label}</span>
                  </div>
                  <span className={`text-xs font-semibold ${item.ok ? 'text-green-600' : item.warn ? 'text-amber-600' : 'text-rose-600'}`}>
                    {item.status}
                  </span>
                </div>
              ))}
              <div className="border-t pt-3 mt-2">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Open Tickets Queue</span>
                  <span className="font-semibold text-foreground">{openTickets.length}</span>
                </div>
                <div className="flex justify-between text-xs text-muted-foreground mt-1">
                  <span>Pending Invoices</span>
                  <span className="font-semibold text-foreground">{pendingInvoices.length}</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
