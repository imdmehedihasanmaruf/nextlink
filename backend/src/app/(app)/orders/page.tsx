'use client';

import { useState, useEffect } from 'react';
import { 
  PackageCheck, 
  Search, 
  Filter, 
  CheckCircle2, 
  Clock, 
  XCircle, 
  RefreshCw, 
  DollarSign, 
  Printer, 
  Eye, 
  AlertCircle,
  Wifi,
  ChevronRight,
  ShieldCheck,
  Zap,
  Network
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { getApiToken } from '@/lib/apiClient';

function authHeader(): Record<string, string> {
  const token = getApiToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

interface AdminOrder {
  id: string;
  customer_id: string;
  customer_name: string;
  connection_id: string;
  package_id: string;
  package_name: string;
  purchase_type: string;
  current_package_name?: string;
  download_speed: number;
  upload_speed: number;
  monthly_price: number;
  prorated_adjustment: number;
  installation_fee: number;
  taxes: number;
  total_payable: number;
  payment_method: string;
  payment_status: string;
  order_status: string;
  // The live status of the subscriber behind the order — a cancelled
  // subscription belongs to an account that is no longer a subscriber.
  subscriber_status?: string | null;
  trx_id: string;
  next_billing_date: string;
  expected_activation_time: string;
  created_at: string;
  raw_data?: any;
}

export default function AdminOrdersPage() {
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'Pending Activation' | 'Active' | 'Cancelled'>('ALL');
  
  // Selected order for detailed modal
  const [selectedOrder, setSelectedOrder] = useState<AdminOrder | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const fetchOrders = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/orders', { headers: authHeader() });
      const data = await res.json();
      if (data.success && data.orders) {
        setOrders(data.orders);
      }
    } catch (err) {
      console.error('Failed to load admin orders:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrders();
  }, []);

  const handleUpdateStatus = async (orderId: string, newStatus: 'Active' | 'Cancelled') => {
    setUpdatingId(orderId);
    setActionSuccess(null);
    try {
      const res = await fetch('/api/admin/orders', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ orderId, status: newStatus }),
      });
      const data = await res.json();
      if (data.success) {
        // The message comes from the server, which knows whether the router
        // actually confirmed the provisioning.
        setActionSuccess(data.message || `Order ${orderId} has been updated.`);
        await fetchOrders();
        if (selectedOrder && selectedOrder.id === orderId) {
          setSelectedOrder({ ...selectedOrder, order_status: newStatus });
        }
      } else {
        alert(data.error || 'Failed to update order status');
      }
    } catch (err) {
      console.error('Error updating order:', err);
    } finally {
      setUpdatingId(null);
    }
  };

  // Filtered orders. This page is "Subscriber Details": the accounts that
  // bought a package plan. An account whose subscription was cancelled is no
  // longer a subscriber, so its record leaves this list — the purchase and
  // cancellation dates stay on the account's own profile (User Details).
  const filteredOrders = orders.filter((ord) => {
    if (String(ord.subscriber_status || '').toLowerCase() === 'cancelled') return false;
    const matchesStatus = statusFilter === 'ALL' || ord.order_status === statusFilter;
    const query = search.toLowerCase();
    const matchesSearch =
      !search ||
      ord.id.toLowerCase().includes(query) ||
      (ord.trx_id && ord.trx_id.toLowerCase().includes(query)) ||
      (ord.customer_name && ord.customer_name.toLowerCase().includes(query)) ||
      (ord.customer_id && ord.customer_id.toLowerCase().includes(query)) ||
      (ord.package_name && ord.package_name.toLowerCase().includes(query));
    return matchesStatus && matchesSearch;
  });

  // KPI Calculations — based on the visible (subscriber) rows.
  const totalCount = filteredOrders.length;
  const pendingCount = filteredOrders.filter(o => o.order_status === 'Pending Activation').length;
  const activeCount = filteredOrders.filter(o => o.order_status === 'Active').length;
  // Cancelled orders never produced revenue — they are excluded.
  const totalRevenue = filteredOrders
    .filter((o) => String(o.order_status || '').toLowerCase() !== 'cancelled')
    .reduce((sum, o) => sum + Number(o.total_payable || 0), 0);

  return (
    <div className="space-y-6">
      {/* Top Title & Refresh */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Subscriber Details &amp; Provisioning</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Every subscriber&apos;s plan purchases, secondary optical line orders, and hardware dispatch in one place.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={fetchOrders}
            className="text-xs h-9 gap-1.5"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh Ledger</span>
          </Button>
        </div>
      </div>

      {actionSuccess && (
        <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>{actionSuccess}</span>
          </div>
          <button onClick={() => setActionSuccess(null)} className="text-xs opacity-70 hover:opacity-100">
            Dismiss
          </button>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="shadow-sm">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-muted-foreground uppercase">Total Subscriptions</span>
              <PackageCheck className="h-4 w-4 text-primary" />
            </div>
            <div className="mt-2">
              <p className="text-2xl font-black">{totalCount}</p>
              <p className="text-[11px] text-muted-foreground">Historical subscriber plan records</p>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-muted-foreground uppercase">Pending Provisioning</span>
              <Clock className="h-4 w-4 text-amber-500" />
            </div>
            <div className="mt-2">
              <p className="text-2xl font-black text-amber-600 dark:text-amber-400">{pendingCount}</p>
              <p className="text-[11px] text-muted-foreground">Awaiting line dispatch or verification</p>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-muted-foreground uppercase">Active Provisioned</span>
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            </div>
            <div className="mt-2">
              <p className="text-2xl font-black text-emerald-600 dark:text-emerald-400">{activeCount}</p>
              <p className="text-[11px] text-muted-foreground">Live optical subscriptions</p>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-muted-foreground uppercase">Collected Revenue</span>
              <DollarSign className="h-4 w-4 text-primary" />
            </div>
            <div className="mt-2">
              <p className="text-2xl font-black text-primary font-mono">${totalRevenue.toFixed(2)}</p>
              <p className="text-[11px] text-muted-foreground">Gross subscriber plan receipts</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filter and Search Bar */}
      <Card className="shadow-sm">
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
            <div className="relative w-full sm:w-80">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by subscriber, order ID, TRX..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 text-xs"
              />
            </div>

            <div className="flex items-center gap-1.5 w-full sm:w-auto overflow-x-auto pb-1 sm:pb-0">
              {(['ALL', 'Pending Activation', 'Active', 'Cancelled'] as const).map((st) => (
                <Button
                  key={st}
                  size="sm"
                  variant={statusFilter === st ? 'default' : 'outline'}
                  onClick={() => setStatusFilter(st)}
                  className="text-xs h-8 whitespace-nowrap"
                >
                  {st === 'ALL' ? 'All Records' : st}
                </Button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Orders Table */}
      <Card className="shadow-sm">
        <CardHeader className="pb-3 border-b flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base font-bold">Subscriber Plan Registry</CardTitle>
            <CardDescription className="text-xs">
              Showing {filteredOrders.length} subscriber plan record{filteredOrders.length === 1 ? '' : 's'}
              {orders.length > filteredOrders.length && ` (${orders.length - filteredOrders.length} belonging to cancelled subscriptions are hidden)`}
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {loading ? (
            <div className="py-16 text-center text-muted-foreground flex items-center justify-center gap-2">
              <RefreshCw className="h-4 w-4 animate-spin text-primary" />
              <span className="text-xs">Loading orders from PostgreSQL...</span>
            </div>
          ) : filteredOrders.length === 0 ? (
            <div className="py-16 text-center text-muted-foreground text-xs">
              No subscriber plan records found matching the filter criteria.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-muted/40 border-b text-[11px] font-semibold text-muted-foreground uppercase">
                  <tr>
                    <th className="py-3 px-4">Order ID &amp; Trx</th>
                    <th className="py-3 px-4">Subscriber</th>
                    <th className="py-3 px-4">Package</th>
                    <th className="py-3 px-4">Type</th>
                    <th className="py-3 px-4">Total Paid</th>
                    <th className="py-3 px-4">Payment</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4">Order Date</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filteredOrders.map((ord) => {
                    const isPending = ord.order_status === 'Pending Activation';
                    const isActive = ord.order_status === 'Active';
                    const isCancelled = ord.order_status === 'Cancelled';
                    const isProcessingThis = updatingId === ord.id;

                    return (
                      <tr key={ord.id} className="hover:bg-muted/30 transition-colors">
                        <td className="py-3 px-4">
                          <span className="font-mono font-bold text-foreground block">{ord.id}</span>
                          <span className="font-mono text-[10px] text-muted-foreground">{ord.trx_id}</span>
                        </td>

                        <td className="py-3 px-4">
                          <span className="font-semibold text-foreground block">{ord.customer_name}</span>
                          <span className="font-mono text-[10px] text-muted-foreground">{ord.customer_id}</span>
                        </td>

                        <td className="py-3 px-4">
                          <span className="font-bold text-foreground block">{ord.package_name}</span>
                          <span className="text-[10px] text-muted-foreground font-mono">
                            {ord.download_speed >= 1000 ? `${ord.download_speed / 1000} Gbps` : `${ord.download_speed} Mbps`} Symmetrical
                          </span>
                        </td>

                        <td className="py-3 px-4">
                          <Badge variant="outline" className="text-[10px]">
                            {ord.purchase_type?.toUpperCase() === 'UPGRADE' ? 'Upgrade' : 'Additional Line'}
                          </Badge>
                        </td>

                        <td className="py-3 px-4 font-mono font-bold text-foreground">
                          ${Number(ord.total_payable || 0).toFixed(2)}
                        </td>

                        <td className="py-3 px-4">
                          <span className="capitalize font-medium text-foreground">{ord.payment_method}</span>
                          <span className="block text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold">
                            {ord.payment_status}
                          </span>
                        </td>

                        <td className="py-3 px-4">
                          <Badge
                            className={`text-[10px] ${
                              isActive
                                ? 'bg-emerald-500 text-white'
                                : isPending
                                ? 'bg-amber-500 text-white'
                                : 'bg-muted text-muted-foreground'
                            }`}
                          >
                            {ord.order_status}
                          </Badge>
                          {String(ord.subscriber_status || '').toLowerCase() === 'suspended' && (
                            <Badge variant="outline" className="ml-1 text-[10px] border-rose-500/30 text-rose-600">
                              Suspended
                            </Badge>
                          )}
                        </td>

                        <td className="py-3 px-4 text-muted-foreground">
                          {new Date(ord.created_at).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' })}
                        </td>

                        <td className="py-3 px-4 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setSelectedOrder(ord)}
                              className="h-7 text-xs px-2"
                              title="View Order Details"
                            >
                              <Eye className="h-3.5 w-3.5" />
                            </Button>

                            {isPending && (
                              <>
                                <Button
                                  size="sm"
                                  onClick={() => handleUpdateStatus(ord.id, 'Active')}
                                  disabled={isProcessingThis}
                                  className="h-7 text-[11px] px-2.5 font-bold bg-emerald-600 hover:bg-emerald-700 text-white"
                                >
                                  {isProcessingThis ? 'Provisioning...' : 'Approve & Provision'}
                                </Button>

                                <Button
                                  size="sm"
                                  variant="destructive"
                                  onClick={() => handleUpdateStatus(ord.id, 'Cancelled')}
                                  disabled={isProcessingThis}
                                  className="h-7 text-[11px] px-2"
                                >
                                  Cancel
                                </Button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Detailed Order Modal */}
      {selectedOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 overflow-y-auto">
          <Card className="w-full max-w-xl bg-card border shadow-2xl animate-in zoom-in-95 my-8">
            <CardHeader className="border-b pb-4 flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base font-bold">Subscriber Plan Details: {selectedOrder.id}</CardTitle>
                <CardDescription className="text-xs">
                  Transaction Reference: <span className="font-mono text-primary">{selectedOrder.trx_id}</span>
                </CardDescription>
              </div>
              <button
                onClick={() => setSelectedOrder(null)}
                className="p-1 rounded-full hover:bg-muted text-muted-foreground text-sm"
              >
                ✕
              </button>
            </CardHeader>
            <CardContent className="p-6 space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3 p-3 rounded-xl bg-muted/40 border">
                <div>
                  <span className="text-muted-foreground block text-[10px] uppercase">Subscriber Name</span>
                  <span className="font-semibold text-foreground text-sm">{selectedOrder.customer_name}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block text-[10px] uppercase">Subscriber ID</span>
                  <span className="font-mono font-bold text-foreground text-sm">{selectedOrder.customer_id}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block text-[10px] uppercase">Classification</span>
                  <span className="font-semibold text-foreground">{selectedOrder.purchase_type}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block text-[10px] uppercase">Current Provision Status</span>
                  <Badge className="text-[10px] mt-0.5">{selectedOrder.order_status}</Badge>
                </div>
              </div>

              <div className="space-y-2 border rounded-xl p-3">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Ordered Plan:</span>
                  <strong className="text-foreground">{selectedOrder.package_name}</strong>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Speed Throughput:</span>
                  <span className="font-mono">{selectedOrder.download_speed} Mbps Symmetrical</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Base Plan Price:</span>
                  <span className="font-mono">${Number(selectedOrder.monthly_price || 0).toFixed(2)}/mo</span>
                </div>
                {Number(selectedOrder.prorated_adjustment) !== 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Prorated Adjustment:</span>
                    <span className="font-mono text-emerald-600 font-semibold">
                      {Number(selectedOrder.prorated_adjustment) > 0 ? '+' : ''}${Number(selectedOrder.prorated_adjustment).toFixed(2)}
                    </span>
                  </div>
                )}
                {Number(selectedOrder.installation_fee) > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Installation Fee:</span>
                    <span className="font-mono">${Number(selectedOrder.installation_fee).toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Taxes &amp; Fees (5%):</span>
                  <span className="font-mono">${Number(selectedOrder.taxes || 0).toFixed(2)}</span>
                </div>
                <div className="flex justify-between pt-2 border-t font-bold text-sm">
                  <span>Total Amount Paid:</span>
                  <span className="font-mono text-primary">${Number(selectedOrder.total_payable || 0).toFixed(2)} USD</span>
                </div>
              </div>

              <div className="flex items-center justify-between pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSelectedOrder(null)}
                  className="text-xs"
                >
                  Close
                </Button>

                {selectedOrder.order_status === 'Pending Activation' && (
                  <Button
                    size="sm"
                    onClick={() => handleUpdateStatus(selectedOrder.id, 'Active')}
                    className="font-bold text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                  >
                    Approve &amp; Activate Line
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

