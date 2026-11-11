'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Activity, RefreshCw, PlayCircle, AlertTriangle, CheckCircle2, Server,
  WifiOff, Download, LogOut as LogOutIcon, Router, CreditCard, MessageSquare,
  ShieldAlert, Zap, Loader2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { apiGet, apiPost, apiHealth, openPdf, getApiToken } from '@/lib/apiClient';
import { formatDateTime } from '@/lib/utils';

interface Invoice {
  id: string;
  subscriber_id: string;
  amount: string | number;
  status: string;
  due_date: string;
  raw_data: any;
  subscriber_name?: string;
  subscriber_phone?: string;
}

interface Transaction {
  id: string;
  invoice_id: string;
  subscriber_id: string;
  gateway: string;
  amount: string | number;
  status: string;
  gateway_txn_id: string;
  created_at: string;
}

interface MikrotikSecret {
  name: string;
  profile: string;
  remoteAddress: string;
  address: string;
  disabled: boolean;
  comment: string;
}

interface MikrotikSession {
  id: string;
  name: string;
  address: string;
  uptime: string;
}

interface Overview {
  totals: {
    unpaid_count: string;
    unpaid_amount: string;
    paid_count: string;
    paid_amount: string;
    total_amount: string;
    total_count: string;
  };
  overdueCount: number;
  cycles: Array<{
    id: string; period: string; status: string;
    invoice_count: number; total_amount: string; completed_at: string;
  }>;
  recentEvents: Array<{
    id: number; subscriber_id: string; invoice_id: string;
    event: string; amount: string; message: string; created_at: string;
  }>;
}

interface SmsMessage {
  id: number;
  subscriber_id: string;
  phone: string;
  body: string;
  template: string;
  status: string;
  created_at: string;
}

export default function BillingEnginePage() {
  const [apiOnline, setApiOnline] = useState<boolean | null>(null);
  const [apiModes, setApiModes] = useState<any>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [secrets, setSecrets] = useState<MikrotikSecret[]>([]);
  const [sessions, setSessions] = useState<MikrotikSession[]>([]);
  const [routerInfo, setRouterInfo] = useState<any>(null);
  const [smsMessages, setSmsMessages] = useState<SmsMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [hasToken, setHasToken] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    const health = await apiHealth();
    setApiOnline(Boolean(health.success));
    if (health.success) {
      setApiModes({
        mikrotikMode: health.mikrotikMode,
        paymentMode: health.paymentMode,
        smsMode: health.smsMode,
        queue: health.queue,
      });
    }

    if (!getApiToken()) {
      setHasToken(false);
      setLoading(false);
      return;
    }
    setHasToken(true);

    const [ov, inv, txn, mik, sms] = await Promise.all([
      apiGet<Overview>('/api/billing/overview'),
      apiGet<{ invoices: Invoice[] }>('/api/billing/invoices?limit=25'),
      apiGet<{ transactions: Transaction[] }>('/api/payments/transactions?limit=25'),
      apiGet<{ secrets: MikrotikSecret[]; sessions: MikrotikSession[] }>('/api/mikrotik/secrets'),
      apiGet<{ messages: SmsMessage[] }>('/api/sms/messages?limit=25'),
    ]);

    if (ov.success) setOverview(ov as any);
    if (inv.success) setInvoices(inv.invoices || []);
    if (txn.success) setTransactions(txn.transactions || []);
    if (mik.success) {
      setSecrets(mik.secrets || []);
      setSessions(mik.sessions || []);
    }
    if (sms.success) setSmsMessages(sms.messages || []);

    const status = await apiGet<any>('/api/mikrotik/status');
    if (status.success) setRouterInfo(status);

    setLoading(false);
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const runCycle = async (dryRun: boolean) => {
    setBusy(dryRun ? 'dry' : 'run');
    const result = await apiPost('/api/billing/cycle/run', { dryRun });
    setBusy(null);
    if (result.success) {
      toast.success(
        dryRun
          ? `Dry run complete — ${result.invoiceCount} invoice(s) would be generated`
          : `Billing cycle complete — ${result.createdCount} new invoice(s), ${result.invoiceCount} total`
      );
      loadAll();
    } else {
      toast.error(result.error || 'Billing cycle failed');
    }
  };

  const suspendOverdue = async () => {
    setBusy('suspend');
    const result = await apiPost('/api/billing/suspend-overdue');
    setBusy(null);
    if (result.success) {
      toast.success(`Processed ${result.processed} overdue invoice(s)`);
      loadAll();
    } else {
      toast.error(result.error || 'Suspend sweep failed');
    }
  };

  const routerAction = async (action: 'suspend' | 'restore', subscriberId: string) => {
    setBusy(`${action}:${subscriberId}`);
    const result = await apiPost(`/api/mikrotik/${action}`, { subscriberId });
    setBusy(null);
    if (result.success) {
      toast.success(
        action === 'suspend'
          ? 'Service suspended on the router (PPPoE disabled)'
          : 'Service restored on the router (PPPoE enabled)'
      );
      loadAll();
    } else {
      toast.error(result.error || 'Router operation failed');
    }
  };

  const downloadPdf = async (invoiceId: string) => {
    const ok = await openPdf(`/api/billing/invoices/${invoiceId}/pdf`);
    if (!ok) toast.error('Could not open the invoice PDF');
  };

  const money = (value: string | number | undefined) =>
    Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });

  if (!hasToken) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Billing Engine</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Automated recurring billing, MikroTik provisioning, and payment gateway reconciliation.
          </p>
        </div>
        <Card>
          <CardContent className="p-8 text-center space-y-3">
            <ShieldAlert className="h-10 w-10 mx-auto text-amber-500" />
            <p className="font-semibold">API session required</p>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Sign out and sign in again to obtain a session token for the Billing API.
              The Express service (port 3100, proxied at /api) must be running for this page to work.
            </p>
            {apiOnline === false && (
              <p className="text-sm text-destructive">
                The Billing API behind /api is not responding.
              </p>
            )}
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
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Billing Engine</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Automated recurring billing, MikroTik provisioning, and payment gateway reconciliation.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={loadAll} disabled={loading} className="gap-2">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button onClick={() => runCycle(false)} disabled={busy === 'run'} className="gap-2">
            {busy === 'run' ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
            Run Billing Cycle
          </Button>
        </div>
      </div>

      {/* Infrastructure status */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground">Express API</p>
              <Server className="h-4 w-4 text-muted-foreground" />
            </div>
            <p className="text-lg font-bold mt-2">
              {apiOnline === null ? 'Checking…' : apiOnline ? 'Online' : 'Offline'}
            </p>
            <p className="text-xs text-muted-foreground mt-1">Internal engine at :3100, proxied at /api</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground">MikroTik RouterOS</p>
              <Router className="h-4 w-4 text-muted-foreground" />
            </div>
            <p className="text-lg font-bold mt-2">{apiModes?.mikrotikMode || '—'}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {routerInfo?.success ? `${routerInfo.latencyMs}ms latency` : 'not connected'}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground">Payment Gateway</p>
              <CreditCard className="h-4 w-4 text-muted-foreground" />
            </div>
            <p className="text-lg font-bold mt-2">{apiModes?.paymentMode || '—'}</p>
            <p className="text-xs text-muted-foreground mt-1">bKash · Nagad · SSLCommerz · Rocket</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground">Job Queue</p>
              <Activity className="h-4 w-4 text-muted-foreground" />
            </div>
            <p className="text-lg font-bold mt-2">{apiModes?.queue?.mode || '—'}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {apiModes?.queue ? `${apiModes.queue.pending} pending` : '—'}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Billing KPIs + actions */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-5">
            <p className="text-xs font-medium text-muted-foreground">Total Invoiced</p>
            <p className="text-2xl font-bold mt-2">{money(overview?.totals?.total_amount)}</p>
            <p className="text-xs text-muted-foreground mt-1">{overview?.totals?.total_count || 0} invoices</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-xs font-medium text-muted-foreground">Collected</p>
            <p className="text-2xl font-bold mt-2 text-emerald-600">{money(overview?.totals?.paid_amount)}</p>
            <p className="text-xs text-muted-foreground mt-1">{overview?.totals?.paid_count || 0} paid</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-xs font-medium text-muted-foreground">Outstanding</p>
            <p className="text-2xl font-bold mt-2 text-amber-600">{money(overview?.totals?.unpaid_amount)}</p>
            <p className="text-xs text-muted-foreground mt-1">{overview?.totals?.unpaid_count || 0} unpaid</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-xs font-medium text-muted-foreground">Overdue</p>
            <p className="text-2xl font-bold mt-2 text-rose-600">{overview?.overdueCount ?? 0}</p>
            <p className="text-xs text-muted-foreground mt-1">past due date</p>
          </CardContent>
        </Card>
      </div>

      {/* Automation actions */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Automation Actions</CardTitle>
          <CardDescription>
            Run the recurring billing cycle or sweep overdue accounts for automatic disconnection.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button variant="outline" onClick={() => runCycle(true)} disabled={busy === 'dry'} className="gap-2">
            {busy === 'dry' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
            Dry Run Cycle
          </Button>
          <Button onClick={() => runCycle(false)} disabled={busy === 'run'} className="gap-2">
            {busy === 'run' ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
            Run Billing Cycle
          </Button>
          <Button
            variant="outline"
            onClick={suspendOverdue}
            disabled={busy === 'suspend'}
            className="gap-2 text-rose-600 hover:text-rose-700 hover:bg-rose-50"
          >
            {busy === 'suspend' ? <Loader2 className="h-4 w-4 animate-spin" /> : <WifiOff className="h-4 w-4" />}
            Auto-Disconnect Overdue
          </Button>
        </CardContent>
      </Card>

      {/* Invoices */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Invoices</CardTitle>
          <CardDescription>Latest {invoices.length} invoices generated by the billing engine.</CardDescription>
        </CardHeader>
        <CardContent>
          {invoices.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              No invoices yet. Run the billing cycle to generate this month&apos;s invoices.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                    <th className="p-2 font-medium">Invoice</th>
                    <th className="p-2 font-medium">Subscriber</th>
                    <th className="p-2 font-medium">Amount</th>
                    <th className="p-2 font-medium">Due</th>
                    <th className="p-2 font-medium">Status</th>
                    <th className="p-2 font-medium text-right">PDF</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((invoice) => (
                    <tr key={invoice.id} className="border-b last:border-0 hover:bg-muted/40">
                      <td className="p-2 font-mono text-xs">{invoice.id}</td>
                      <td className="p-2">
                        <p className="font-medium">{invoice.subscriber_name || invoice.raw_data?.subscriberName || invoice.subscriber_id}</p>
                        <p className="text-xs text-muted-foreground">{invoice.subscriber_phone || invoice.raw_data?.subscriberPhone || ''}</p>
                      </td>
                      <td className="p-2 font-bold">{money(invoice.amount)}</td>
                      <td className="p-2 text-xs">{invoice.due_date}</td>
                      <td className="p-2">
                        {invoice.status === 'paid' ? (
                          <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/30">Paid</Badge>
                        ) : (
                          <Badge className="bg-amber-500/10 text-amber-600 border-amber-500/30">Unpaid</Badge>
                        )}
                      </td>
                      <td className="p-2 text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => downloadPdf(invoice.id)}
                          className="h-8 w-8 p-0"
                          title="Download PDF invoice"
                        >
                          <Download className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* MikroTik secrets */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle>MikroTik PPPoE Secrets</CardTitle>
              <Badge variant={apiModes?.mikrotikMode === 'live' ? 'default' : 'secondary'}>
                {apiModes?.mikrotikMode || 'unknown'}
              </Badge>
            </div>
            <CardDescription>
              Service state on the core router. Suspend disables PPPoE; restore re-enables it.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {secrets.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">No PPPoE secrets available.</p>
            ) : (
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {secrets.map((secret) => {
                  const session = sessions.find((s) => s.name === secret.name);
                  const busyKey = `${secret.disabled ? 'restore' : 'suspend'}:${secret.name}`;
                  return (
                    <div
                      key={secret.name}
                      className="flex items-center justify-between gap-3 rounded-lg border p-3"
                    >
                      <div className="min-w-0">
                        <p className="font-medium text-sm truncate">{secret.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {secret.profile} · {secret.remoteAddress || '—'}
                          {session ? ` · online ${session.uptime}` : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {secret.disabled ? (
                          <Badge className="bg-rose-500/10 text-rose-600 border-rose-500/30">Suspended</Badge>
                        ) : (
                          <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/30">Active</Badge>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy === busyKey}
                          onClick={() =>
                            routerAction(secret.disabled ? 'restore' : 'suspend', secret.name)
                          }
                          className="h-8 text-xs"
                        >
                          {secret.disabled ? 'Restore' : 'Suspend'}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Transactions */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle>Payment Transactions</CardTitle>
            <CardDescription>Gateway settlements received through the webhooks.</CardDescription>
          </CardHeader>
          <CardContent>
            {transactions.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">No payment transactions yet.</p>
            ) : (
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {transactions.map((txn) => (
                  <div key={txn.id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                    <div className="min-w-0">
                      <p className="font-medium text-sm">
                        {txn.gateway.toUpperCase()} · {money(txn.amount)}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {txn.invoice_id} · {txn.gateway_txn_id}
                      </p>
                    </div>
                    <Badge
                      className={
                        txn.status === 'success'
                          ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30'
                          : txn.status === 'failed'
                            ? 'bg-rose-500/10 text-rose-600 border-rose-500/30'
                            : 'bg-amber-500/10 text-amber-600 border-amber-500/30'
                      }
                    >
                      {txn.status}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* SMS + events */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle>SMS Notifications</CardTitle>
              <Badge variant="secondary">{apiModes?.smsMode || 'unknown'}</Badge>
            </div>
            <CardDescription>Bill reminders, suspension notices and restoration confirmations.</CardDescription>
          </CardHeader>
          <CardContent>
            {smsMessages.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">No SMS messages yet.</p>
            ) : (
              <div className="space-y-2 max-h-72 overflow-y-auto">
                {smsMessages.map((message) => (
                  <div key={message.id} className="rounded-lg border p-3">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <p className="text-xs font-medium flex items-center gap-1.5">
                        <MessageSquare className="h-3 w-3" />
                        {message.template || 'manual'} → {message.phone}
                      </p>
                      <span className="text-[10px] text-muted-foreground">
                        {formatDateTime(message.created_at)}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-2">{message.body}</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle>Billing Events</CardTitle>
            <CardDescription>Audit trail of every automated billing action.</CardDescription>
          </CardHeader>
          <CardContent>
            {(overview?.recentEvents?.length || 0) === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">No billing events yet.</p>
            ) : (
              <div className="space-y-2 max-h-72 overflow-y-auto">
                {overview!.recentEvents.map((event) => (
                  <div key={event.id} className="flex items-start gap-2 rounded-lg border p-3">
                    {event.event === 'payment_received' ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />
                    ) : event.event.includes('suspend') ? (
                      <AlertTriangle className="h-4 w-4 text-rose-500 mt-0.5 shrink-0" />
                    ) : (
                      <Activity className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                    )}
                    <div className="min-w-0">
                      <p className="text-xs font-medium">{event.event.replace(/_/g, ' ')}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {event.invoice_id} · {event.message}
                      </p>
                    </div>
                    <span className="text-[10px] text-muted-foreground ml-auto shrink-0">
                      {formatDateTime(event.created_at)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
