'use strict';
'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  ShieldAlert,
  ShieldCheck,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  RotateCw,
  Search,
  ExternalLink,
  Layers,
  Activity,
  Database,
  ArrowRight,
  Filter,
  Check,
  AlertOctagon,
  Lock,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { apiGet, apiPost } from '@/lib/apiClient';
import { useAuthStore } from '@/store/authStore';
import { formatDate } from '@/lib/utils';

interface Transaction {
  id: string;
  invoice_id: string | null;
  subscriber_id: string | null;
  gateway: string;
  amount: number | string;
  currency: string;
  status: string;
  gateway_txn_id: string | null;
  reference: string | null;
  method: string | null;
  created_at: string;
  updated_at: string;
}

interface WebhookRecord {
  id: string | number;
  gateway: string;
  event_type: string;
  gateway_txn_id: string | null;
  status: string;
  error?: string | null;
  processed_at?: string | null;
  created_at: string;
}

interface Discrepancy {
  id: string;
  type: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  transactionId?: string | null;
  invoiceId?: string | null;
  gateway?: string | null;
  gatewayTxnId?: string | null;
  subscriberId?: string | null;
  description: string;
  details?: any;
  localStatus?: string;
  providerStatus?: string | null;
  detectedAt: string;
  recommendedAction: string;
}

interface GatewayConfig {
  id: string;
  name: string;
  method: string;
  supported: boolean;
  mode: string;
  isConfigured: boolean;
  health: string;
  credentialsStatus: string;
  callbackUrl: string;
}

interface OperationalAlert {
  id: string;
  category: string;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  message: string;
  gateway: string;
  timestamp: string;
  suggestedAction: string;
}

export default function PaymentOperationsPage() {
  const { user } = useAuthStore();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState('overview');

  // Stats & Health State
  const [stats, setStats] = useState<any>(null);
  const [gateways, setGateways] = useState<GatewayConfig[]>([]);

  // Transactions State
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [txStatusFilter, setTxStatusFilter] = useState('all');
  const [txGatewayFilter, setTxGatewayFilter] = useState('all');
  const [txSearch, setTxSearch] = useState('');

  // Webhooks State
  const [webhooks, setWebhooks] = useState<WebhookRecord[]>([]);
  const [webhookFilter, setWebhookFilter] = useState('all');
  const [retryingId, setRetryingId] = useState<string | number | null>(null);

  // Reconciliation State
  const [reconReport, setReconReport] = useState<any>(null);
  const [runningRecon, setRunningRecon] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  // Alerts State
  const [alerts, setAlerts] = useState<OperationalAlert[]>([]);

  // Strict Staff RBAC Check
  const userRole = String(user?.role || '').toLowerCase();
  const isAuthorizedStaff = userRole === 'super_admin' || userRole === 'billing' || userRole === 'admin';

  const loadData = useCallback(async () => {
    try {
      setRefreshing(true);
      const [statsRes, txRes, whRes, reconRes, alertsRes] = await Promise.all([
        apiGet('/api/payments/operations/stats').catch(() => null),
        apiGet('/api/payments/transactions?limit=200').catch(() => null),
        apiGet('/api/payments/webhooks?limit=200').catch(() => null),
        apiGet('/api/payments/reconciliation?limit=150').catch(() => null),
        apiGet('/api/payments/alerts').catch(() => null),
      ]);

      if (statsRes?.success) {
        setStats(statsRes.transactions);
        setGateways(statsRes.gateways || []);
      }
      if (txRes?.success && Array.isArray(txRes.transactions)) {
        setTransactions(txRes.transactions);
      }
      if (whRes?.success && Array.isArray(whRes.webhooks)) {
        setWebhooks(whRes.webhooks);
      }
      if (reconRes?.success) {
        setReconReport(reconRes);
      }
      if (alertsRes?.success && Array.isArray(alertsRes.alerts)) {
        setAlerts(alertsRes.alerts);
      }
    } catch (err: any) {
      toast.error('Failed to load payment operations telemetry');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleManualRecon = async () => {
    try {
      setRunningRecon(true);
      toast.loading('Running full payment reconciliation scan...', { id: 'recon-toast' });
      const res = await apiGet('/api/payments/reconciliation?limit=200&checkProvider=true');
      if (res?.success) {
        setReconReport(res);
        toast.success(
          `Reconciliation scan complete: ${res.summary.discrepancies_count} discrepancies found`,
          { id: 'recon-toast' }
        );
      } else {
        toast.error(res?.error || 'Reconciliation failed', { id: 'recon-toast' });
      }
    } catch (err: any) {
      toast.error('Failed to run reconciliation', { id: 'recon-toast' });
    } finally {
      setRunningRecon(false);
    }
  };

  const handleRetryWebhook = async (id: string | number) => {
    try {
      setRetryingId(id);
      const res = await apiPost(`/api/payments/webhooks/${id}/retry`, {});
      if (res?.success) {
        toast.success(`Webhook #${id} retried successfully!`);
        loadData();
      } else {
        toast.error(`Retry failed: ${res?.error || res?.result?.error || 'Unknown error'}`);
      }
    } catch (err: any) {
      toast.error(`Retry error: ${err.message || 'Request failed'}`);
    } finally {
      setRetryingId(null);
    }
  };

  const handleVerifyTransaction = async (tx: Transaction) => {
    try {
      toast.loading(`Verifying transaction ${tx.id} with ${tx.gateway}...`, { id: 'tx-verif' });
      const res = await apiPost('/api/payments/verify', {
        gateway: tx.gateway,
        transactionId: tx.gateway_txn_id || tx.id,
      });
      if (res?.success && res.status === 'success') {
        toast.success(`Verified: Transaction is completed at gateway!`, { id: 'tx-verif' });
        loadData();
      } else {
        toast.error(`Verification result: ${res?.status || 'unverified'}`, { id: 'tx-verif' });
      }
    } catch (err: any) {
      toast.error(`Verification error: ${err.message || 'Request failed'}`, { id: 'tx-verif' });
    }
  };

  const handleResolveDiscrepancy = async (disc: Discrepancy, action: string) => {
    const reason = prompt(
      `Authorized Corrective Action: ${action}\nEnter staff justification (min 5 characters) for audit trail:`,
      `Approved corrective fix for ${disc.type} on ${disc.transactionId || disc.invoiceId}`
    );
    if (!reason || reason.trim().length < 5) {
      toast.error('Action cancelled: A valid justification is required.');
      return;
    }

    try {
      setResolvingId(disc.id);
      const res = await apiPost('/api/payments/reconciliation/resolve', {
        discrepancyType: disc.type,
        transactionId: disc.transactionId || undefined,
        invoiceId: disc.invoiceId || undefined,
        action,
        reason,
      });
      if (res?.success) {
        toast.success(`Discrepancy resolved: ${action}`);
        loadData();
      } else {
        toast.error(res?.error || 'Resolution failed');
      }
    } catch (err: any) {
      toast.error(`Error resolving discrepancy: ${err.message}`);
    } finally {
      setResolvingId(null);
    }
  };

  // Filter transactions
  const filteredTransactions = transactions.filter((tx) => {
    if (txStatusFilter !== 'all' && tx.status !== txStatusFilter) return false;
    if (txGatewayFilter !== 'all' && tx.gateway !== txGatewayFilter) return false;
    if (txSearch) {
      const q = txSearch.toLowerCase();
      const matchId = String(tx.id).toLowerCase().includes(q);
      const matchInv = String(tx.invoice_id || '').toLowerCase().includes(q);
      const matchRef = String(tx.gateway_txn_id || '').toLowerCase().includes(q);
      if (!matchId && !matchInv && !matchRef) return false;
    }
    return true;
  });

  // Filter webhooks
  const filteredWebhooks = webhooks.filter((wh) => {
    if (webhookFilter === 'all') return true;
    if (webhookFilter === 'dead_letter') return wh.status === 'dead_letter';
    if (webhookFilter === 'failed') return wh.status === 'failed' || wh.status === 'unverified';
    if (webhookFilter === 'processed') return wh.status === 'processed';
    return wh.status === webhookFilter;
  });

  // RBAC Access Guard
  if (!isAuthorizedStaff) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4 text-center px-4">
        <div className="h-16 w-16 rounded-full bg-rose-500/10 flex items-center justify-center text-rose-600">
          <Lock className="h-8 w-8" />
        </div>
        <h2 className="text-2xl font-bold tracking-tight">Access Restricted</h2>
        <p className="text-sm text-muted-foreground max-w-md">
          Payment Operations Console requires elevated staff credentials (Super Admin or Billing Officer).
          Subscriber accounts and unauthorized roles cannot access payment ledgers or reconciliation tools.
        </p>
      </div>
    );
  }

  const discrepancies: Discrepancy[] = reconReport?.discrepancies || [];
  const deadLetterCount = webhooks.filter((w) => w.status === 'dead_letter').length;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">Payment Operations & Reconciliation</h1>
            <Badge variant="outline" className="text-xs bg-primary/5 text-primary border-primary/20">
              Express Engine Authoritative
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Real-time transaction settlement telemetry, dead-letter webhook processing, gateway health, and automated reconciliation.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={loadData}
            disabled={refreshing}
            className="gap-2 shadow-xs"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>

          <Button
            size="sm"
            onClick={handleManualRecon}
            disabled={runningRecon}
            className="gap-2 bg-primary text-primary-foreground shadow-xs"
          >
            <ShieldCheck className={`h-4 w-4 ${runningRecon ? 'animate-spin' : ''}`} />
            Run Reconciliation
          </Button>
        </div>
      </div>

      {/* Critical System Alert Banner if alerts exist */}
      {alerts.length > 0 && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-4 text-rose-900 dark:text-rose-200">
          <div className="flex items-start gap-3">
            <AlertOctagon className="h-5 w-5 text-rose-600 shrink-0 mt-0.5" />
            <div className="flex-1">
              <h4 className="font-semibold text-sm">
                Operational Alert: {alerts.length} payment system {alerts.length === 1 ? 'anomaly' : 'anomalies'} detected
              </h4>
              <p className="text-xs text-rose-800 dark:text-rose-300 mt-1">
                {alerts[0].message}
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setActiveTab('alerts')}
              className="border-rose-500/30 text-rose-700 dark:text-rose-300 hover:bg-rose-500/10 text-xs h-7"
            >
              View All Alerts
            </Button>
          </div>
        </div>
      )}

      {/* Metric Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Settled */}
        <Card className="shadow-xs">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground">Settled Payments</p>
              <div className="h-7 w-7 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-600">
                <CheckCircle2 className="h-4 w-4" />
              </div>
            </div>
            <h3 className="text-2xl font-bold mt-2">
              ${Number(stats?.settled_amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </h3>
            <p className="text-xs text-muted-foreground mt-1">
              <span className="font-semibold text-emerald-600">{stats?.settled_count || 0}</span> transactions settled
            </p>
          </CardContent>
        </Card>

        {/* Pending Transactions */}
        <Card className="shadow-xs">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground">Pending / In-Flight</p>
              <div className="h-7 w-7 rounded-lg bg-amber-500/10 flex items-center justify-center text-amber-600">
                <Clock className="h-4 w-4" />
              </div>
            </div>
            <h3 className="text-2xl font-bold mt-2">
              ${Number(stats?.pending_amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </h3>
            <p className="text-xs text-muted-foreground mt-1">
              <span className="font-semibold text-amber-600">{stats?.pending_count || 0}</span> waiting for gateway callback
            </p>
          </CardContent>
        </Card>

        {/* Failed & Dead Letter */}
        <Card className="shadow-xs">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground">Failed & Dead-Letter</p>
              <div className="h-7 w-7 rounded-lg bg-rose-500/10 flex items-center justify-center text-rose-600">
                <XCircle className="h-4 w-4" />
              </div>
            </div>
            <h3 className="text-2xl font-bold mt-2">
              {stats?.failed_count || 0} <span className="text-sm font-normal text-muted-foreground">failed</span>
            </h3>
            <p className="text-xs text-muted-foreground mt-1">
              <span className={`font-semibold ${deadLetterCount > 0 ? 'text-rose-600' : 'text-muted-foreground'}`}>
                {deadLetterCount}
              </span> in dead-letter queue
            </p>
          </CardContent>
        </Card>

        {/* Reconciliation Status */}
        <Card className="shadow-xs">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground">Reconciliation Integrity</p>
              <div className={`h-7 w-7 rounded-lg flex items-center justify-center ${
                discrepancies.length === 0 ? 'bg-emerald-500/10 text-emerald-600' : 'bg-rose-500/10 text-rose-600'
              }`}>
                {discrepancies.length === 0 ? <ShieldCheck className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
              </div>
            </div>
            <h3 className="text-2xl font-bold mt-2">
              {discrepancies.length === 0 ? (
                <span className="text-emerald-600 text-xl font-bold">100% Balanced</span>
              ) : (
                <span className="text-rose-600">{discrepancies.length} Issues</span>
              )}
            </h3>
            <p className="text-xs text-muted-foreground mt-1">
              {discrepancies.length === 0 ? 'Zero ledger discrepancies' : 'Action required on ledger mismatches'}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Main Tabs Container */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="grid grid-cols-2 md:grid-cols-5 h-auto p-1 bg-muted/60">
          <TabsTrigger value="overview" className="gap-2 py-2 text-xs">
            <Activity className="h-3.5 w-3.5" />
            Gateways & Health
          </TabsTrigger>
          <TabsTrigger value="transactions" className="gap-2 py-2 text-xs">
            <Layers className="h-3.5 w-3.5" />
            Transactions ({transactions.length})
          </TabsTrigger>
          <TabsTrigger value="webhooks" className="gap-2 py-2 text-xs">
            <RotateCw className="h-3.5 w-3.5" />
            Webhooks & DLQ {deadLetterCount > 0 && <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] bg-rose-600 text-white font-bold">{deadLetterCount}</span>}
          </TabsTrigger>
          <TabsTrigger value="reconciliation" className="gap-2 py-2 text-xs">
            <ShieldCheck className="h-3.5 w-3.5" />
            Reconciliation {discrepancies.length > 0 && <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] bg-rose-600 text-white font-bold">{discrepancies.length}</span>}
          </TabsTrigger>
          <TabsTrigger value="alerts" className="gap-2 py-2 text-xs">
            <ShieldAlert className="h-3.5 w-3.5" />
            Alerts ({alerts.length})
          </TabsTrigger>
        </TabsList>

        {/* ============================================================ */}
        {/* TAB 1: GATEWAYS HEALTH & CONFIGURATION */}
        {/* ============================================================ */}
        <TabsContent value="overview" className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Payment Gateway Integrations & Security</CardTitle>
              <CardDescription className="text-xs">
                Real-time status of payment providers. Zero credentials or secret keys are exposed to the client.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {gateways.map((gw) => (
                  <div
                    key={gw.id}
                    className="p-4 rounded-xl border bg-card hover:bg-muted/10 transition-colors space-y-3"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-base">{gw.name}</span>
                        <Badge variant="outline" className="text-[10px] uppercase font-mono">
                          {gw.method}
                        </Badge>
                      </div>
                      <Badge className={gw.health === 'operational' ? 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30' : 'bg-rose-500/15 text-rose-600'}>
                        {gw.health}
                      </Badge>
                    </div>

                    <div className="text-xs space-y-1.5 text-muted-foreground">
                      <div className="flex justify-between">
                        <span>Operating Mode:</span>
                        <span className="font-mono text-foreground uppercase font-semibold">{gw.mode}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Credentials:</span>
                        <span className="text-emerald-600 font-medium">{gw.credentialsStatus}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Direct Verify API:</span>
                        <span className="text-foreground font-mono">
                          {gw.id === 'sslcommerz' ? 'Order Validation API' : gw.id === 'bkash' ? 'Payment Status API' : 'Direct Merchant API'}
                        </span>
                      </div>
                      <div className="pt-2 border-t text-[11px] font-mono break-all text-muted-foreground">
                        Callback: <span className="text-foreground">{gw.callbackUrl}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ============================================================ */}
        {/* TAB 2: TRANSACTIONS LEDGER */}
        {/* ============================================================ */}
        <TabsContent value="transactions" className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-lg">Payment Transactions Ledger</CardTitle>
                  <CardDescription className="text-xs">
                    Comprehensive log of all payment sessions, attempts, and verification states.
                  </CardDescription>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative w-48">
                    <Search className="h-3.5 w-3.5 absolute left-2.5 top-2.5 text-muted-foreground" />
                    <Input
                      placeholder="Search txn/invoice..."
                      value={txSearch}
                      onChange={(e) => setTxSearch(e.target.value)}
                      className="h-8 pl-8 text-xs"
                    />
                  </div>

                  <Select value={txStatusFilter} onValueChange={setTxStatusFilter}>
                    <SelectTrigger className="w-32 h-8 text-xs">
                      <SelectValue placeholder="Status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Status</SelectItem>
                      <SelectItem value="success">Settled</SelectItem>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="failed">Failed</SelectItem>
                      <SelectItem value="cancelled">Cancelled</SelectItem>
                    </SelectContent>
                  </Select>

                  <Select value={txGatewayFilter} onValueChange={setTxGatewayFilter}>
                    <SelectTrigger className="w-32 h-8 text-xs">
                      <SelectValue placeholder="Gateway" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Gateways</SelectItem>
                      <SelectItem value="bkash">bKash</SelectItem>
                      <SelectItem value="nagad">Nagad</SelectItem>
                      <SelectItem value="sslcommerz">SSLCommerz</SelectItem>
                      <SelectItem value="rocket">Rocket</SelectItem>
                      <SelectItem value="mock">Mock</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50 border-b">
                    <tr className="text-left font-medium text-muted-foreground">
                      <th className="p-3">Txn ID</th>
                      <th className="p-3">Invoice</th>
                      <th className="p-3">Subscriber</th>
                      <th className="p-3">Gateway</th>
                      <th className="p-3">Amount</th>
                      <th className="p-3">Status</th>
                      <th className="p-3">Gateway Reference</th>
                      <th className="p-3">Date</th>
                      <th className="p-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {filteredTransactions.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="p-6 text-center text-muted-foreground">
                          No payment transactions matching active filters.
                        </td>
                      </tr>
                    ) : (
                      filteredTransactions.map((tx) => (
                        <tr key={tx.id} className="hover:bg-muted/20 transition-colors">
                          <td className="p-3 font-mono font-medium">{tx.id}</td>
                          <td className="p-3 font-mono">{tx.invoice_id || '—'}</td>
                          <td className="p-3 text-muted-foreground">{tx.subscriber_id || 'Guest/Self'}</td>
                          <td className="p-3">
                            <Badge variant="outline" className="text-[10px] font-mono uppercase">
                              {tx.gateway}
                            </Badge>
                          </td>
                          <td className="p-3 font-bold font-mono">
                            ${Number(tx.amount || 0).toFixed(2)}
                          </td>
                          <td className="p-3">
                            <Badge className={
                              tx.status === 'success' || tx.status === 'settled'
                                ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30'
                                : tx.status === 'pending'
                                ? 'bg-amber-500/10 text-amber-600 border-amber-500/30'
                                : 'bg-rose-500/10 text-rose-600 border-rose-500/30'
                            }>
                              {tx.status}
                            </Badge>
                          </td>
                          <td className="p-3 font-mono text-muted-foreground truncate max-w-[150px]">
                            {tx.gateway_txn_id || tx.reference || '—'}
                          </td>
                          <td className="p-3 text-muted-foreground whitespace-nowrap">
                            {formatDate(tx.created_at)}
                          </td>
                          <td className="p-3 text-right">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleVerifyTransaction(tx)}
                              className="h-7 text-xs font-semibold gap-1 text-primary hover:text-primary hover:bg-primary/10"
                            >
                              <ShieldCheck className="h-3 w-3" />
                              Verify
                            </Button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ============================================================ */}
        {/* TAB 3: WEBHOOKS & DEAD-LETTER QUEUE */}
        {/* ============================================================ */}
        <TabsContent value="webhooks" className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-lg">Webhook Ingestion & Dead-Letter Queue</CardTitle>
                  <CardDescription className="text-xs">
                    Inbound server-to-server notifications with signature validation and bounded manual retry.
                  </CardDescription>
                </div>

                <Select value={webhookFilter} onValueChange={setWebhookFilter}>
                  <SelectTrigger className="w-36 h-8 text-xs">
                    <SelectValue placeholder="Webhook Filter" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Webhooks</SelectItem>
                    <SelectItem value="processed">Processed</SelectItem>
                    <SelectItem value="dead_letter">Dead-Letter Only</SelectItem>
                    <SelectItem value="failed">Failed / Unverified</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50 border-b">
                    <tr className="text-left font-medium text-muted-foreground">
                      <th className="p-3">ID</th>
                      <th className="p-3">Gateway</th>
                      <th className="p-3">Event Type</th>
                      <th className="p-3">Gateway Txn ID</th>
                      <th className="p-3">Status</th>
                      <th className="p-3">Error / Diagnostics</th>
                      <th className="p-3">Received At</th>
                      <th className="p-3 text-right">Retry</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {filteredWebhooks.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="p-6 text-center text-muted-foreground">
                          No webhook records matching filter.
                        </td>
                      </tr>
                    ) : (
                      filteredWebhooks.map((wh) => (
                        <tr key={wh.id} className="hover:bg-muted/20 transition-colors">
                          <td className="p-3 font-mono font-medium">{wh.id}</td>
                          <td className="p-3 font-mono uppercase">{wh.gateway}</td>
                          <td className="p-3 font-mono text-muted-foreground">{wh.event_type}</td>
                          <td className="p-3 font-mono">{wh.gateway_txn_id || '—'}</td>
                          <td className="p-3">
                            <Badge className={
                              wh.status === 'processed'
                                ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30'
                                : wh.status === 'dead_letter'
                                ? 'bg-rose-600 text-white font-bold'
                                : wh.status === 'received'
                                ? 'bg-blue-500/10 text-blue-600 border-blue-500/30'
                                : 'bg-rose-500/10 text-rose-600 border-rose-500/30'
                            }>
                              {wh.status}
                            </Badge>
                          </td>
                          <td className="p-3 text-rose-600 dark:text-rose-400 font-mono max-w-[220px] truncate" title={wh.error || ''}>
                            {wh.error || '—'}
                          </td>
                          <td className="p-3 text-muted-foreground whitespace-nowrap">
                            {formatDate(wh.created_at)}
                          </td>
                          <td className="p-3 text-right">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleRetryWebhook(wh.id)}
                              disabled={retryingId === wh.id}
                              className="h-7 text-xs gap-1 border-primary/20 text-primary hover:bg-primary/5"
                            >
                              <RotateCw className={`h-3 w-3 ${retryingId === wh.id ? 'animate-spin' : ''}`} />
                              Retry
                            </Button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ============================================================ */}
        {/* TAB 4: RECONCILIATION & DISCREPANCIES */}
        {/* ============================================================ */}
        <TabsContent value="reconciliation" className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-lg">Payment Reconciliation Engine</CardTitle>
                  <CardDescription className="text-xs">
                    Automated read-only cross-audit of local ledger, gateway responses, invoice balances, and billing events.
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleManualRecon}
                    disabled={runningRecon}
                    className="gap-1.5 text-xs h-8"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${runningRecon ? 'animate-spin' : ''}`} />
                    Run Scan
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Clean vs Discrepancies State Banner */}
              {discrepancies.length === 0 ? (
                <div className="flex items-center gap-3 p-4 rounded-xl border border-emerald-500/20 bg-emerald-500/5 text-emerald-800 dark:text-emerald-200">
                  <CheckCircle2 className="h-6 w-6 text-emerald-600 shrink-0" />
                  <div>
                    <h4 className="font-semibold text-sm">All Ledger Records Perfectly Synchronized</h4>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Scanned {reconReport?.summary?.total_transactions_scanned || 0} transactions and {reconReport?.summary?.total_invoices_scanned || 0} invoices.
                      Zero amount mismatches, orphan records, or missing settlement events found.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3 p-4 rounded-xl border border-rose-500/20 bg-rose-500/5 text-rose-800 dark:text-rose-200">
                  <AlertTriangle className="h-6 w-6 text-rose-600 shrink-0" />
                  <div>
                    <h4 className="font-semibold text-sm">{discrepancies.length} Discrepancies Require Staff Review</h4>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Review identified mismatches below. Corrective actions require staff authorization and will be permanently recorded in the audit log.
                    </p>
                  </div>
                </div>
              )}

              {/* Discrepancies Table */}
              {discrepancies.length > 0 && (
                <div className="rounded-md border overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50 border-b">
                      <tr className="text-left font-medium text-muted-foreground">
                        <th className="p-3">Severity</th>
                        <th className="p-3">Discrepancy Type</th>
                        <th className="p-3">Transaction</th>
                        <th className="p-3">Invoice</th>
                        <th className="p-3">Description</th>
                        <th className="p-3">Recommended Action</th>
                        <th className="p-3 text-right">Authorized Resolution</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {discrepancies.map((disc) => (
                        <tr key={disc.id} className="hover:bg-muted/20 transition-colors">
                          <td className="p-3">
                            <Badge className={
                              disc.severity === 'critical'
                                ? 'bg-rose-600 text-white font-bold'
                                : disc.severity === 'high'
                                ? 'bg-rose-500/10 text-rose-600 border-rose-500/30'
                                : disc.severity === 'medium'
                                ? 'bg-amber-500/10 text-amber-600 border-amber-500/30'
                                : 'bg-blue-500/10 text-blue-600 border-blue-500/30'
                            }>
                              {disc.severity}
                            </Badge>
                          </td>
                          <td className="p-3 font-mono font-medium text-foreground">
                            {disc.type}
                          </td>
                          <td className="p-3 font-mono">{disc.transactionId || '—'}</td>
                          <td className="p-3 font-mono">{disc.invoiceId || '—'}</td>
                          <td className="p-3 max-w-xs">{disc.description}</td>
                          <td className="p-3 text-muted-foreground max-w-xs">{disc.recommendedAction}</td>
                          <td className="p-3 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              {disc.type === 'INCONSISTENT_INVOICE_BALANCE' && disc.localStatus !== 'no_transaction' && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleResolveDiscrepancy(disc, 'mark_invoice_paid')}
                                  disabled={resolvingId === disc.id}
                                  className="h-7 text-xs border-emerald-500/30 text-emerald-600 hover:bg-emerald-500/10"
                                >
                                  Settle Invoice
                                </Button>
                              )}
                              {disc.type === 'MISSING_SETTLEMENT_EVENT' && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleResolveDiscrepancy(disc, 'record_missing_event')}
                                  disabled={resolvingId === disc.id}
                                  className="h-7 text-xs border-blue-500/30 text-blue-600 hover:bg-blue-500/10"
                                >
                                  Record Event
                                </Button>
                              )}
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleResolveDiscrepancy(disc, 'dismiss')}
                                disabled={resolvingId === disc.id}
                                className="h-7 text-xs text-muted-foreground hover:text-foreground"
                              >
                                Dismiss
                              </Button>
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
        </TabsContent>

        {/* ============================================================ */}
        {/* TAB 5: OPERATIONAL ALERTS */}
        {/* ============================================================ */}
        <TabsContent value="alerts" className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Payment System Operational Alerts</CardTitle>
              <CardDescription className="text-xs">
                Real-time monitors for repeated callback failures, timeout spikes, and gateway anomalies.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {alerts.length === 0 ? (
                <div className="flex items-center gap-3 p-6 rounded-xl border border-emerald-500/20 bg-emerald-500/5 text-emerald-800 dark:text-emerald-200">
                  <CheckCircle2 className="h-6 w-6 text-emerald-600 shrink-0" />
                  <div>
                    <h4 className="font-semibold text-sm">Zero Active Operational Alerts</h4>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Webhook delivery rates, verification endpoints, and transaction timeouts are all operating within healthy SLA thresholds.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {alerts.map((alert) => (
                    <div
                      key={alert.id}
                      className="p-4 rounded-xl border bg-card flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                    >
                      <div className="flex items-start gap-3">
                        <AlertTriangle className={`h-5 w-5 shrink-0 mt-0.5 ${
                          alert.severity === 'critical' ? 'text-rose-600' : 'text-amber-600'
                        }`} />
                        <div>
                          <div className="flex items-center gap-2">
                            <h4 className="font-semibold text-sm">{alert.title}</h4>
                            <Badge className={alert.severity === 'critical' ? 'bg-rose-600 text-white' : 'bg-amber-500/15 text-amber-600'}>
                              {alert.severity}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">{alert.message}</p>
                          <p className="text-xs font-medium text-primary mt-1">Suggested: {alert.suggestedAction}</p>
                        </div>
                      </div>

                      <div className="text-xs text-muted-foreground sm:text-right shrink-0">
                        {new Date(alert.timestamp).toLocaleTimeString()}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
