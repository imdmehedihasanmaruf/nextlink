'use client'

import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { 
  FileText, 
  ArrowLeft, 
  Printer, 
  Wifi, 
  CreditCard, 
  CheckCircle2, 
  Clock, 
  AlertCircle,
  AlertTriangle,
  Download, 
  ExternalLink, 
  RefreshCw,
  Plus,
  X,
  PackageCheck
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useAuthStore } from '@/store/authStore'
import { subscriberAuthHeader } from '@/lib/portalApi'
import { useModalA11y } from '@/lib/useModalA11y'

interface OrderItem {
  id: string
  customer_id: string
  customer_name: string
  package_id: string
  package_name: string
  purchase_type: string
  purchase_type_label?: string
  purchaseTypeLabel?: string
  current_package_name?: string
  download_speed: number
  upload_speed: number
  monthly_price: number
  prorated_adjustment: number
  installation_fee: number
  taxes: number
  total_payable: number
  payment_method: string
  payment_status: string
  order_status: string
  trx_id: string
  next_billing_date: string
  expected_activation_time: string
  purchase_timestamp?: string
  purchaseTimestamp?: string
  session_geolocation?: string
  sessionGeolocation?: string
  created_at: string
}

export default function CustomerOrdersPage() {
  const router = useRouter()
  const { user, isAuthenticated, hasHydrated } = useAuthStore()

  const [orders, setOrders] = useState<OrderItem[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [selectedOrder, setSelectedOrder] = useState<OrderItem | null>(null)
  const [invoiceModalOpen, setInvoiceModalOpen] = useState(false)

  // Escape closes the invoice modal and the page does not scroll behind it.
  useModalA11y(invoiceModalOpen, () => setInvoiceModalOpen(false))

  // Redirect visitors
  useEffect(() => {
    if (hasHydrated && !isAuthenticated) {
      router.push('/login?redirect=' + encodeURIComponent('/dashboard/orders') + '&reason=existing_customer_only')
    }
  }, [hasHydrated, isAuthenticated, router])

  // Load orders for customer
  const fetchCustomerOrders = async () => {
    if (!user?.id) return
    setLoading(true)
    setFetchError(null)
    try {
      const res = await fetch(`/api/customer/orders?customerId=${encodeURIComponent(user.id)}`, {
        headers: subscriberAuthHeader(),
      })
      const data = await res.json()
      if (!res.ok || !data.success) {
        setFetchError(data?.error || `Your orders could not be loaded (${res.status}).`)
        return
      }
      setOrders(data.orders || [])
    } catch (err) {
      console.error('Failed to load orders:', err)
      setFetchError('Your orders could not be loaded. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (isAuthenticated && user?.id) {
      fetchCustomerOrders()
    }
  }, [isAuthenticated, user?.id])

  const handleOpenInvoice = (order: OrderItem) => {
    setSelectedOrder(order)
    setInvoiceModalOpen(true)
  }

  if (!isAuthenticated && !hasHydrated) {
    return null
  }

  return (
    <div className="min-h-screen bg-background py-8 sm:py-12">
      <div className="container mx-auto px-4 max-w-5xl space-y-8">
        
        {/* Navigation & Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b pb-6">
          <div className="space-y-1">
            <Link 
              href="/dashboard"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors mb-2"
            >
              <ArrowLeft className="h-4 w-4" />
              <span>Back to Subscriber Dashboard</span>
            </Link>
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-foreground">
              My Subscriber Details &amp; Plans
            </h1>
            <p className="text-xs sm:text-sm text-muted-foreground">
              View your order transaction history, line provisioning milestones, and printable carrier receipts.
            </p>
          </div>

          <div className="flex items-center gap-2.5">
            <Button
              variant="outline"
              size="sm"
              onClick={fetchCustomerOrders}
              className="text-xs h-9 gap-1.5"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </Button>

            <Link href="/dashboard/purchase">
              <Button size="sm" className="font-bold text-xs h-9 gap-1.5 shadow-sm">
                <Plus className="h-3.5 w-3.5" />
                <span>Upgrade / New Package</span>
              </Button>
            </Link>
          </div>
        </div>

        {/* Customer Identity Bar */}
        <div className="rounded-xl border bg-muted/40 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
          <div>
            <span className="text-muted-foreground">Customer Account: </span>
            <strong className="text-foreground">{user?.name}</strong>
            <span className="font-mono text-muted-foreground ml-2">({user?.id})</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Active Subscription:</span>
            <Badge variant="outline" className="font-bold text-primary">
              {user?.packageName || user?.package || 'Ultra Gigabit 500'}
            </Badge>
          </div>
        </div>

        {/* Orders Table Card */}
        <Card className="border shadow-sm">
          <CardHeader className="pb-3 border-b flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base font-bold">Transaction History</CardTitle>
              <CardDescription className="text-xs">
                All package changes and secondary line deployments are recorded with carrier transaction reference.
              </CardDescription>
            </div>
            <Badge variant="secondary" className="font-mono text-xs">
              {orders.length} Records
            </Badge>
          </CardHeader>

          <CardContent className="p-0">
            {fetchError && (
              <div className="m-4 p-3 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-xs flex items-center gap-2">
                <AlertTriangle size={14} className="shrink-0" />
                <span>{fetchError}</span>
              </div>
            )}
            {loading ? (
              <div className="py-16 text-center text-muted-foreground flex items-center justify-center gap-2">
                <RefreshCw className="h-4 w-4 animate-spin text-primary" />
                <span className="text-xs">Loading order ledger from database...</span>
              </div>
            ) : orders.length === 0 ? (
              <div className="py-16 text-center space-y-3">
                <PackageCheck className="h-10 w-10 text-muted-foreground mx-auto stroke-1" />
                <p className="font-semibold text-sm text-foreground">No Subscriber Details Yet</p>
                <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                  You are currently on your base plan. You can upgrade your symmetrical optical speed or add a secondary line at any time.
                </p>
                <Link href="/dashboard/purchase">
                  <Button size="sm" className="font-bold text-xs mt-2">
                    Browse &amp; Upgrade Plans
                  </Button>
                </Link>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead className="bg-muted/40 border-b text-[11px] font-semibold text-muted-foreground uppercase">
                    <tr>
                      <th className="py-3 px-4">Order ID &amp; Trx</th>
                      <th className="py-3 px-4">Package</th>
                      <th className="py-3 px-4">Type</th>
                      <th className="py-3 px-4">Total Paid</th>
                      <th className="py-3 px-4">Payment</th>
                      <th className="py-3 px-4">Provisioning Status</th>
                      <th className="py-3 px-4">Date</th>
                      <th className="py-3 px-4 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {orders.map((ord) => {
                      const isPending = ord.order_status === 'Pending Activation'
                      const isActive = ord.order_status === 'Active'
                      return (
                        <tr key={ord.id} className="hover:bg-muted/30 transition-colors">
                          <td className="py-3 px-4">
                            <span className="font-mono font-bold text-foreground block">{ord.id}</span>
                            <span className="font-mono text-[10px] text-muted-foreground">{ord.trx_id}</span>
                          </td>

                          <td className="py-3 px-4">
                            <span className="font-bold text-foreground block">{ord.package_name}</span>
                            <span className="text-[10px] text-muted-foreground">
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
                          </td>

                          <td className="py-3 px-4 text-muted-foreground">
                            {new Date(ord.created_at).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' })}
                          </td>

                          <td className="py-3 px-4 text-right">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleOpenInvoice(ord)}
                              className="h-7 text-[11px] gap-1 px-2.5 font-semibold"
                            >
                              <Printer className="h-3 w-3" />
                              <span>Invoice</span>
                            </Button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ─────────────────────────────────────────────────────────────
          PRINTABLE INVOICE MODAL
      ───────────────────────────────────────────────────────────── */}
      {invoiceModalOpen && selectedOrder && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-label="Order invoice"
        >
          <Card className="w-full max-w-2xl bg-card border shadow-2xl animate-in zoom-in-95 my-8">
            <CardHeader className="border-b pb-4 flex flex-row items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="h-9 w-9 rounded-xl bg-primary text-primary-foreground flex items-center justify-center">
                  <Wifi className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-black text-base text-foreground leading-none">NextLink Global ISP</h3>
                  <p className="text-[10px] text-muted-foreground font-mono mt-0.5">CARRIER OPTICAL NETWORK</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => window.print()} className="h-8 gap-1.5 text-xs">
                  <Printer className="h-3.5 w-3.5" />
                  <span>Print</span>
                </Button>
                <button 
                  onClick={() => setInvoiceModalOpen(false)}
                  className="p-1.5 rounded-full hover:bg-muted text-muted-foreground"
                >
                  <X size={18} />
                </button>
              </div>
            </CardHeader>

            <CardContent className="p-6 space-y-6 text-xs">
              <div className="flex justify-between items-start">
                <div>
                  <span className="text-[10px] uppercase font-bold text-muted-foreground">Billed To</span>
                  <p className="font-bold text-sm text-foreground mt-0.5">{selectedOrder.customer_name}</p>
                  <p className="text-muted-foreground font-mono">Subscriber ID: {selectedOrder.customer_id}</p>
                  <p className="text-muted-foreground max-w-xs mt-0.5">{user?.address || 'Registered Optical Line Drop'}</p>
                </div>
                <div className="text-right">
                  <span className="text-[10px] uppercase font-bold text-muted-foreground">Official Receipt</span>
                  <p className="font-mono font-bold text-sm text-primary mt-0.5">{selectedOrder.id}</p>
                  <p className="text-muted-foreground">
                    Date: {new Date(selectedOrder.created_at).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' })}
                  </p>
                  <Badge className="bg-emerald-500 text-white text-[10px] mt-1">
                    {selectedOrder.payment_status.toUpperCase()}
                  </Badge>
                </div>
              </div>

              {/* Table */}
              <div className="border rounded-xl overflow-hidden">
                <table className="w-full text-left">
                  <thead className="bg-muted/50 border-b text-[11px] font-semibold text-muted-foreground">
                    <tr>
                      <th className="p-3">Description</th>
                      <th className="p-3">Classification</th>
                      <th className="p-3 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y font-mono">
                    <tr>
                      <td className="p-3">
                        <span className="font-semibold text-foreground block">
                          NextLink {selectedOrder.package_name} Optical Fiber
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {selectedOrder.download_speed >= 1000 ? `${selectedOrder.download_speed / 1000} Gbps` : `${selectedOrder.download_speed} Mbps`} Symmetrical Speed
                        </span>
                      </td>
                      <td className="p-3 text-muted-foreground">
                        {selectedOrder.purchase_type}
                      </td>
                      <td className="p-3 text-right font-bold text-foreground">
                        ${Number(selectedOrder.monthly_price || 0).toFixed(2)}
                      </td>
                    </tr>
                    {Number(selectedOrder.prorated_adjustment) !== 0 && (
                      <tr>
                        <td className="p-3 text-muted-foreground">Prorated Plan Credit Adjustment</td>
                        <td className="p-3 text-muted-foreground">Adjustment</td>
                        <td className="p-3 text-right font-semibold text-emerald-600">
                          {Number(selectedOrder.prorated_adjustment) > 0 ? '+' : ''}${Number(selectedOrder.prorated_adjustment).toFixed(2)}
                        </td>
                      </tr>
                    )}
                    {Number(selectedOrder.installation_fee) > 0 && (
                      <tr>
                        <td className="p-3 text-muted-foreground">Secondary Optical Installation Fee</td>
                        <td className="p-3 text-muted-foreground">Setup</td>
                        <td className="p-3 text-right font-semibold text-foreground">
                          ${Number(selectedOrder.installation_fee).toFixed(2)}
                        </td>
                      </tr>
                    )}
                    <tr>
                      <td className="p-3 text-muted-foreground">Telecommunications Regulatory Tax (5%)</td>
                      <td className="p-3 text-muted-foreground">Tax</td>
                      <td className="p-3 text-right font-semibold text-foreground">
                        ${Number(selectedOrder.taxes || 0).toFixed(2)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="flex justify-between items-center pt-2 border-t">
                <div>
                  <p className="text-[11px] text-muted-foreground">Payment Gateway: <strong className="text-foreground capitalize">{selectedOrder.payment_method}</strong></p>
                  <p className="text-[11px] font-mono text-muted-foreground">Trx Ref: {selectedOrder.trx_id}</p>
                </div>
                <div className="text-right">
                  <span className="text-[11px] text-muted-foreground">Total Paid:</span>
                  <p className="text-xl font-black text-foreground font-mono">${Number(selectedOrder.total_payable || 0).toFixed(2)} USD</p>
                </div>
              </div>

              <div className="p-3 rounded-xl bg-muted/40 text-[11px] text-muted-foreground text-center">
                NextLink Global Telecom LLC · 24/7 Optical Support: +880 1575 XXXXXX · support@nextlink.global
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}

