'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  FileText,
  ArrowLeft,
  Printer,
  Wifi,
  CreditCard,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Download,
  RefreshCw,
  Plus,
  X,
  PackageCheck,
  Search,
  ChevronLeft,
  ChevronRight,
  Filter,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { useAuthStore } from '@/store/authStore'
import { useTranslation } from '@/store/settingsStore'
import {
  subscriberAuthHeader,
  fetchMyInvoices,
  fetchMySummary,
  payInvoice,
  downloadInvoicePdf,
  type PortalInvoice,
  type PortalSummary,
  type PortalTransaction,
} from '@/lib/portalApi'
import { useModalA11y } from '@/lib/useModalA11y'
import { PaymentModal } from '@/components/PaymentModal'

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
  const { user, isAuthenticated, hasHydrated, updateUser } = useAuthStore()
  const { t } = useTranslation()

  // Package Orders state
  const [orders, setOrders] = useState<OrderItem[]>([])
  const [ordersLoading, setOrdersLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [selectedOrder, setSelectedOrder] = useState<OrderItem | null>(null)
  const [invoiceModalOpen, setInvoiceModalOpen] = useState(false)

  // Live Billing ("Current Bills" & "Billing & Payment History" moved from Dashboard per Req 12)
  const [liveInvoices, setLiveInvoices] = useState<PortalInvoice[]>([])
  const [liveTransactions, setLiveTransactions] = useState<PortalTransaction[]>([])
  const [liveSummary, setLiveSummary] = useState<PortalSummary | null>(null)
  const [billingOnline, setBillingOnline] = useState<boolean | null>(null)
  const [billingLoading, setBillingLoading] = useState(true)
  const [payingInvoiceId, setPayingInvoiceId] = useState<string | null>(null)
  const [downloadingInvoiceId, setDownloadingInvoiceId] = useState<string | null>(null)
  const [gatewayChoice, setGatewayChoice] = useState<'bkash' | 'nagad' | 'sslcommerz' | 'rocket'>('bkash')
  const [billingError, setBillingError] = useState<string | null>(null)

  // Selected billing invoice for itemized preview modal
  const [selectedBillInvoice, setSelectedBillInvoice] = useState<PortalInvoice | null>(null)
  const [billDetailModalOpen, setBillDetailModalOpen] = useState(false)

  // Payment checkout modal state
  const [checkoutModalOpen, setCheckoutModalOpen] = useState(false)
  const [invoiceToPay, setInvoiceToPay] = useState<PortalInvoice | null>(null)

  // Filters & Pagination for Payment & Transaction History
  const [txSearchQuery, setTxSearchQuery] = useState('')
  const [txStatusFilter, setTxStatusFilter] = useState<'all' | 'success' | 'pending' | 'failed'>('all')
  const [txPage, setTxPage] = useState(1)
  const txPageSize = 5
  const [selectedTransaction, setSelectedTransaction] = useState<PortalTransaction | null>(null)
  const [txDetailModalOpen, setTxDetailModalOpen] = useState(false)

  // Filters & Pagination for Current Bills (Default: 'unpaid' for actionable dues)
  const [billStatusFilter, setBillStatusFilter] = useState<'all' | 'unpaid' | 'paid'>('unpaid')
  const [billSearchQuery, setBillSearchQuery] = useState('')
  const [billPage, setBillPage] = useState(1)
  const billPageSize = 5

  // Filters & Pagination for Package Orders
  const [orderSearch, setOrderSearch] = useState('')
  const [orderPage, setOrderPage] = useState(1)
  const orderPageSize = 5

  useModalA11y(invoiceModalOpen, () => setInvoiceModalOpen(false))
  useModalA11y(billDetailModalOpen, () => setBillDetailModalOpen(false))
  useModalA11y(txDetailModalOpen, () => setTxDetailModalOpen(false))

  useEffect(() => {
    if (hasHydrated && !isAuthenticated) {
      router.push('/login?redirect=' + encodeURIComponent('/dashboard/orders') + '&reason=existing_customer_only')
    }
  }, [hasHydrated, isAuthenticated, router])

  const fetchCustomerOrders = useCallback(async () => {
    if (!user?.id) return
    setOrdersLoading(true)
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
      setOrdersLoading(false)
    }
  }, [user?.id])

  const loadLiveBilling = useCallback(async () => {
    setBillingLoading(true)
    setBillingError(null)
    try {
      const [summaryResult, invoicesResult] = await Promise.all([
        fetchMySummary(),
        fetchMyInvoices(),
      ])

      if (!summaryResult.success) {
        setBillingOnline(false)
      } else {
        setBillingOnline(true)
        setLiveSummary(summaryResult.summary || null)
        const subPkg = summaryResult.summary?.subscriber?.packageName
        if (subPkg && subPkg !== user?.packageName) {
          updateUser({ packageName: subPkg, package: subPkg })
        }
      }

      if (invoicesResult.success) {
        setLiveInvoices(invoicesResult.invoices || [])
        setLiveTransactions(invoicesResult.transactions || [])
      }
    } catch {
      setBillingOnline(false)
    } finally {
      setBillingLoading(false)
    }
  }, [updateUser, user?.packageName])

  const refreshAll = useCallback(() => {
    fetchCustomerOrders()
    loadLiveBilling()
  }, [fetchCustomerOrders, loadLiveBilling])

  useEffect(() => {
    if (isAuthenticated && user?.id) {
      refreshAll()
    }
  }, [isAuthenticated, user?.id, refreshAll])

  const handlePayLiveInvoice = async (invoice: PortalInvoice) => {
    setPayingInvoiceId(invoice.id)
    setBillingError(null)
    const result = await payInvoice(invoice.id, gatewayChoice)
    setPayingInvoiceId(null)

    if (!result.success || !result.redirectUrl) {
      setBillingError(result.error || 'Could not start the payment. Please try again.')
      return
    }

    window.location.href = result.redirectUrl
  }

  const handleDownloadInvoicePdf = async (invoice: PortalInvoice) => {
    setDownloadingInvoiceId(invoice.id)
    const ok = await downloadInvoicePdf(invoice.id)
    setDownloadingInvoiceId(null)
    if (!ok) {
      // Fallback: open itemized invoice modal so user can print/save PDF
      setSelectedBillInvoice(invoice)
      setBillDetailModalOpen(true)
    }
  }

  const handleOpenInvoice = (order: OrderItem) => {
    setSelectedOrder(order)
    setInvoiceModalOpen(true)
  }

  const currencyOf = (invoice?: PortalInvoice | null) =>
    String(invoice?.raw_data?.currency || 'USD').toUpperCase()

  // Filtered + Paginated Current Bills
  const filteredBills = useMemo(() => {
    return liveInvoices.filter((inv) => {
      if (String(inv.status) === 'carried_forward') return false
      if (billStatusFilter === 'unpaid' && inv.status === 'paid') return false
      if (billStatusFilter === 'paid' && inv.status !== 'paid') return false
      if (billSearchQuery.trim()) {
        const q = billSearchQuery.toLowerCase()
        const idMatch = String(inv.id || '').toLowerCase().includes(q)
        const periodMatch = String(inv.raw_data?.period || '').toLowerCase().includes(q)
        const pkgMatch = String(inv.raw_data?.packageName || '').toLowerCase().includes(q)
        return idMatch || periodMatch || pkgMatch
      }
      return true
    })
  }, [liveInvoices, billStatusFilter, billSearchQuery])

  const totalBillPages = Math.max(1, Math.ceil(filteredBills.length / billPageSize))
  const paginatedBills = useMemo(() => {
    const start = (billPage - 1) * billPageSize
    return filteredBills.slice(start, start + billPageSize)
  }, [filteredBills, billPage])

  // Filtered + Paginated Transactions
  const filteredTransactions = useMemo(() => {
    return liveTransactions.filter((tx) => {
      if (txStatusFilter !== 'all' && tx.status?.toLowerCase() !== txStatusFilter) return false
      if (txSearchQuery.trim()) {
        const q = txSearchQuery.toLowerCase()
        const idMatch = String(tx.id || '').toLowerCase().includes(q)
        const invMatch = String(tx.invoice_id || '').toLowerCase().includes(q)
        const gwMatch = String(tx.gateway || '').toLowerCase().includes(q)
        const txnIdMatch = String(tx.gateway_txn_id || '').toLowerCase().includes(q)
        return idMatch || invMatch || gwMatch || txnIdMatch
      }
      return true
    })
  }, [liveTransactions, txStatusFilter, txSearchQuery])

  const totalTxPages = Math.max(1, Math.ceil(filteredTransactions.length / txPageSize))
  const paginatedTransactions = useMemo(() => {
    const start = (txPage - 1) * txPageSize
    return filteredTransactions.slice(start, start + txPageSize)
  }, [filteredTransactions, txPage])

  // Filtered + Paginated Orders
  const filteredOrders = useMemo(() => {
    if (!orderSearch.trim()) return orders
    const q = orderSearch.toLowerCase()
    return orders.filter(
      (o) =>
        String(o.id || '').toLowerCase().includes(q) ||
        String(o.package_name || '').toLowerCase().includes(q) ||
        String(o.trx_id || '').toLowerCase().includes(q)
    )
  }, [orders, orderSearch])

  const totalOrderPages = Math.max(1, Math.ceil(filteredOrders.length / orderPageSize))
  const paginatedOrders = useMemo(() => {
    const start = (orderPage - 1) * orderPageSize
    return filteredOrders.slice(start, start + orderPageSize)
  }, [filteredOrders, orderPage])

  if (!isAuthenticated && !hasHydrated) {
    return null
  }

  const activePackageName =
    liveSummary?.subscriber?.packageName || user?.packageName || user?.package || 'No active plan'
  const invoiceCurrency = currencyOf(liveInvoices[0])

  return (
    <div className="min-h-screen bg-background py-8 sm:py-12">
      <div className="container mx-auto px-4 max-w-6xl space-y-8">
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
              My Orders &amp; Current Bills
            </h1>
            <p className="text-xs sm:text-sm text-muted-foreground">
              Manage your current bills, settle invoices online, download itemized PDF statements, and view package orders.
            </p>
          </div>

          <div className="flex items-center gap-2.5">
            <Button
              variant="outline"
              size="sm"
              onClick={refreshAll}
              className="text-xs h-9 gap-1.5"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${ordersLoading || billingLoading ? 'animate-spin' : ''}`} />
              <span>Refresh All</span>
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
            <Badge variant="outline" className="font-bold text-primary" data-testid="orders-active-package">
              {activePackageName}
            </Badge>
          </div>
        </div>

        {/* ─────────────────────────────────────────────────────────────
            1. CURRENT BILLS CARD (Moved from Dashboard per Requirement 12)
        ───────────────────────────────────────────────────────────── */}
        <Card className="border shadow-sm" data-testid="current-bills-card">
          <CardHeader>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <CardTitle>Current Bills</CardTitle>
                <CardDescription>
                  Live invoices issued by the NextLink Billing Engine — settle with bKash, Nagad, SSLCommerz or Rocket
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Badge
                  className={
                    billingOnline === true
                      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400 border-emerald-200'
                      : billingOnline === false
                        ? 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400 border-amber-200'
                        : 'bg-muted text-muted-foreground border-border'
                  }
                >
                  {billingOnline === true ? 'Billing Online' : billingOnline === false ? 'Billing Offline' : 'Checking…'}
                </Badge>
                <Button variant="outline" size="sm" onClick={loadLiveBilling} className="h-8 text-xs">
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                  Refresh
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {(!billingOnline || billingError) && (
              <div className="p-4 rounded-xl bg-destructive/10 border border-destructive/30 text-destructive text-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <AlertCircle className="h-5 w-5 shrink-0" />
                  <div>
                    <p className="font-bold">Unable to sync billing invoices</p>
                    <p className="text-xs text-destructive/80">{billingError || 'Billing service is currently unreachable.'}</p>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={loadLiveBilling}
                  className="h-8 text-xs shrink-0 border-destructive/40 hover:bg-destructive/10"
                >
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                  Retry
                </Button>
              </div>
            )}

            {liveSummary && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Outstanding</p>
                  <p className="text-lg font-bold text-amber-600 font-mono">
                    {invoiceCurrency} {Number(liveSummary.outstanding || 0).toFixed(2)}
                  </p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Unpaid Bills</p>
                  <p className="text-lg font-bold font-mono">{liveSummary.unpaidCount}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Paid Invoices</p>
                  <p className="text-lg font-bold text-emerald-600 font-mono">{liveSummary.paidCount}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Referral Credit</p>
                  <p className="text-lg font-bold text-emerald-600 font-mono">
                    {(liveSummary.subscriber?.creditBalance ?? 0) > 0
                      ? `${invoiceCurrency} ${Number(liveSummary.subscriber!.creditBalance).toFixed(2)}`
                      : '$0.00'}
                  </p>
                </div>
              </div>
            )}

            {/* Gateway Selection + Filters */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pt-2 border-t">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-muted-foreground">Pay via:</span>
                {(['bkash', 'nagad', 'sslcommerz', 'rocket'] as const).map((gateway) => (
                  <Button
                    key={gateway}
                    size="sm"
                    variant={gatewayChoice === gateway ? 'default' : 'outline'}
                    onClick={() => setGatewayChoice(gateway)}
                    className="h-8 text-xs"
                  >
                    {gateway === 'sslcommerz'
                      ? 'SSLCommerz'
                      : gateway === 'bkash'
                        ? 'bKash'
                        : gateway === 'nagad'
                          ? 'Nagad'
                          : 'Rocket'}
                  </Button>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="relative w-48">
                  <Search className="h-3.5 w-3.5 absolute left-2.5 top-2.5 text-muted-foreground" />
                  <Input
                    placeholder="Filter invoice or plan..."
                    value={billSearchQuery}
                    onChange={(e) => {
                      setBillSearchQuery(e.target.value)
                      setBillPage(1)
                    }}
                    className="pl-8 h-8 text-xs"
                  />
                </div>
                <div className="flex items-center gap-1">
                  {(['unpaid', 'paid', 'all'] as const).map((st) => {
                    const count =
                      st === 'unpaid'
                        ? liveInvoices.filter((i) => String(i.status) !== 'carried_forward' && i.status !== 'paid').length
                        : st === 'paid'
                          ? liveInvoices.filter((i) => String(i.status) !== 'carried_forward' && i.status === 'paid').length
                          : liveInvoices.filter((i) => String(i.status) !== 'carried_forward').length
                    return (
                      <Button
                        key={st}
                        size="sm"
                        variant={billStatusFilter === st ? 'secondary' : 'ghost'}
                        onClick={() => {
                          setBillStatusFilter(st)
                          setBillPage(1)
                        }}
                        className="h-8 text-xs capitalize px-2.5"
                      >
                        {st === 'unpaid' ? `Unpaid (${count})` : st === 'paid' ? `Paid (${count})` : `All (${count})`}
                      </Button>
                    )
                  })}
                </div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs sm:text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground text-left bg-muted/30">
                    <th className="py-3 px-4 font-semibold">Invoice No</th>
                    <th className="py-3 px-4 font-semibold">Package (Speed)</th>
                    <th className="py-3 px-4 font-semibold">Billing Month</th>
                    <th className="py-3 px-4 font-semibold">Line Items Breakdown</th>
                    <th className="py-3 px-4 font-semibold">Total</th>
                    <th className="py-3 px-4 font-semibold">Due Date</th>
                    <th className="py-3 px-4 font-semibold">Status</th>
                    <th className="py-3 px-4 font-semibold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {billingLoading ? (
                    <tr>
                      <td colSpan={8} className="py-8 px-4">
                        <div className="space-y-3">
                          {[1, 2, 3].map((n) => (
                            <div key={n} className="h-10 w-full bg-muted/60 animate-pulse rounded-md" />
                          ))}
                        </div>
                      </td>
                    </tr>
                  ) : paginatedBills.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="text-center py-12 text-muted-foreground">
                        <div className="flex flex-col items-center justify-center gap-2">
                          <CheckCircle2 className="h-8 w-8 text-emerald-500/60" />
                          <p className="font-semibold text-foreground text-sm">
                            {billStatusFilter === 'unpaid'
                              ? 'No pending bills'
                              : billStatusFilter === 'paid'
                                ? 'No paid invoices found'
                                : 'No billing invoices found'}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {billStatusFilter === 'unpaid'
                              ? 'All your subscription invoices are settled up to date.'
                              : 'Your statement records will appear here once invoices are issued.'}
                          </p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    paginatedBills.map((invoice) => {
                      const installFee = Number(invoice.installation_fee ?? invoice.raw_data?.installationFee ?? 0)
                      const taxFee = Number(invoice.tax_fee ?? invoice.raw_data?.taxFee ?? 0)
                      const lateFee = Number(invoice.late_fee ?? invoice.raw_data?.lateFee ?? 0)
                      const carriedOver = Number(invoice.carried_over_amount ?? invoice.raw_data?.carriedOverAmount ?? 0)
                      const packageName = invoice.package_name || invoice.raw_data?.packageName || 'Standard Fiber'
                      const packageSpeed = invoice.package_speed || invoice.raw_data?.packageSpeed || 200
                      const rawLines = Array.isArray(invoice.raw_data?.lines) ? invoice.raw_data.lines : []
                      const monthlyBase = Number(
                        invoice.package_price ||
                          invoice.raw_data?.packagePrice ||
                          Math.max(0, Number(invoice.amount) - (installFee + taxFee + lateFee + carriedOver))
                      )

                      return (
                        <tr key={invoice.id} className="hover:bg-muted/30">
                          <td className="py-3 px-4 font-mono text-xs font-bold text-primary">{invoice.id}</td>
                          <td className="py-3 px-4 font-medium">
                            <div>
                              <span>{packageName}</span>
                              <span className="text-xs text-muted-foreground ml-1">({packageSpeed} Mbps)</span>
                            </div>
                          </td>
                          <td className="py-3 px-4 text-muted-foreground">
                            {invoice.raw_data?.period ||
                              (invoice.due_date
                                ? new Date(invoice.due_date).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
                                : 'Current Month')}
                          </td>
                          <td className="py-3 px-4 text-xs">
                            <div className="flex flex-wrap gap-1">
                              <Badge variant="outline" className="text-[10px] bg-muted/40">
                                Monthly: ${monthlyBase.toFixed(2)}
                              </Badge>
                              {installFee > 0 && (
                                <Badge variant="outline" className="text-[10px] border-blue-500/40 text-blue-600 bg-blue-50/50">
                                  Install: +${installFee.toFixed(2)}
                                </Badge>
                              )}
                              {taxFee > 0 && (
                                <Badge variant="outline" className="text-[10px] border-blue-500/40 text-blue-600 bg-blue-50/50">
                                  Tax: +${taxFee.toFixed(2)}
                                </Badge>
                              )}
                              {carriedOver > 0 && (
                                <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-600 bg-amber-50/50">
                                  Past Due: +${carriedOver.toFixed(2)}
                                </Badge>
                              )}
                              {lateFee > 0 && (
                                <Badge variant="outline" className="text-[10px] border-destructive/40 text-destructive bg-destructive/10">
                                  Late Fee: +${lateFee.toFixed(2)}
                                </Badge>
                              )}
                            </div>
                          </td>
                          <td className="py-3 px-4 font-bold font-mono text-foreground">
                            {currencyOf(invoice)} {Number(invoice.amount || 0).toFixed(2)}
                          </td>
                          <td className="py-3 px-4 text-muted-foreground font-mono text-xs">
                            {invoice.due_date || '—'}
                          </td>
                          <td className="py-3 px-4">
                            {invoice.status === 'paid' ? (
                              <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400 border-emerald-200">
                                Paid
                              </Badge>
                            ) : (
                              <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400 border-amber-200">
                                Unpaid
                              </Badge>
                            )}
                          </td>
                          <td className="py-3 px-4 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  setSelectedBillInvoice(invoice)
                                  setBillDetailModalOpen(true)
                                }}
                                className="h-7 text-xs px-2"
                                title="View Itemized Invoice"
                              >
                                <FileText className="h-3.5 w-3.5 mr-1" />
                                View
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleDownloadInvoicePdf(invoice)}
                                disabled={downloadingInvoiceId === invoice.id}
                                className="h-7 text-xs px-2"
                                title="Download PDF Invoice"
                              >
                                <Download className="h-3.5 w-3.5 mr-1" />
                                PDF
                              </Button>
                              {invoice.status !== 'paid' && (
                                <Button
                                  size="sm"
                                  onClick={() => {
                                    setInvoiceToPay(invoice)
                                    setCheckoutModalOpen(true)
                                  }}
                                  disabled={!billingOnline}
                                  className="h-7 text-xs px-2.5 font-bold shadow-sm"
                                  data-testid={`pay-invoice-${invoice.id}`}
                                >
                                  Pay Now
                                </Button>
                              )}
                            </div>
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination for Current Bills */}
            {filteredBills.length > billPageSize && (
              <div className="flex items-center justify-between pt-2 border-t text-xs text-muted-foreground">
                <span>
                  Showing {(billPage - 1) * billPageSize + 1}–
                  {Math.min(billPage * billPageSize, filteredBills.length)} of {filteredBills.length} bills
                </span>
                <div className="flex items-center gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={billPage <= 1}
                    onClick={() => setBillPage((p) => Math.max(1, p - 1))}
                    className="h-7 px-2 text-xs"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" /> Prev
                  </Button>
                  <span className="font-mono px-2">
                    Page {billPage} / {totalBillPages}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={billPage >= totalBillPages}
                    onClick={() => setBillPage((p) => Math.min(totalBillPages, p + 1))}
                    className="h-7 px-2 text-xs"
                  >
                    Next <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ─────────────────────────────────────────────────────────────
            2. PAYMENT & TRANSACTION HISTORY (Ownership Enforced)
        ───────────────────────────────────────────────────────────── */}
        <Card className="border shadow-sm" data-testid="payment-history-card">
          <CardHeader className="pb-3 border-b flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base font-bold flex items-center gap-2">
                <CreditCard className="h-4 w-4 text-primary" />
                <span>Payment &amp; Transaction History</span>
              </CardTitle>
              <CardDescription className="text-xs">
                Audited settlement ledger for your subscriber account with carrier references and downloadable receipts.
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative w-48">
                <Search className="h-3.5 w-3.5 absolute left-2.5 top-2.5 text-muted-foreground" />
                <Input
                  placeholder="Search Txn or Invoice ID..."
                  value={txSearchQuery}
                  onChange={(e) => {
                    setTxSearchQuery(e.target.value)
                    setTxPage(1)
                  }}
                  className="pl-8 h-8 text-xs"
                />
              </div>

              <div className="flex items-center gap-1">
                {(['all', 'success', 'pending', 'failed'] as const).map((st) => (
                  <Button
                    key={st}
                    size="sm"
                    variant={txStatusFilter === st ? 'secondary' : 'ghost'}
                    onClick={() => {
                      setTxStatusFilter(st)
                      setTxPage(1)
                    }}
                    className="h-8 text-xs capitalize px-2.5"
                  >
                    {st === 'success' ? 'Settled' : st}
                  </Button>
                ))}
              </div>

              <Badge variant="secondary" className="font-mono text-xs">
                {filteredTransactions.length} Txns
              </Badge>
            </div>
          </CardHeader>

          <CardContent className="p-0">
            {billingLoading ? (
              <div className="py-12 text-center text-muted-foreground flex items-center justify-center gap-2">
                <RefreshCw className="h-4 w-4 animate-spin text-primary" />
                <span className="text-xs">Loading transaction ledger...</span>
              </div>
            ) : paginatedTransactions.length === 0 ? (
              <div className="py-12 text-center space-y-2">
                <CreditCard className="h-8 w-8 text-muted-foreground mx-auto stroke-1" />
                <p className="font-semibold text-sm text-foreground">No Transactions Found</p>
                <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                  {txSearchQuery || txStatusFilter !== 'all'
                    ? 'No transactions matched your search or status filter.'
                    : 'Payment receipts will appear here once you settle an invoice.'}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead className="bg-muted/40 border-b text-[11px] font-semibold text-muted-foreground uppercase">
                    <tr>
                      <th className="py-3 px-4">Transaction ID</th>
                      <th className="py-3 px-4">Invoice ID</th>
                      <th className="py-3 px-4">Gateway</th>
                      <th className="py-3 px-4">Amount</th>
                      <th className="py-3 px-4">Gateway Ref</th>
                      <th className="py-3 px-4">Date</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y font-mono">
                    {paginatedTransactions.map((tx) => {
                      const isSuccess = tx.status === 'success' || tx.status === 'completed'
                      const isPending = tx.status === 'pending' || tx.status === 'initiated'
                      const isFailed = tx.status === 'failed' || tx.status === 'cancelled'
                      const gatewayName = String(tx.gateway || 'MFS').toUpperCase()

                      return (
                        <tr key={tx.id} className="hover:bg-muted/30 transition-colors">
                          <td className="py-3 px-4 font-bold text-primary font-mono">{tx.id}</td>
                          <td className="py-3 px-4 text-foreground font-sans">
                            <span className="font-mono font-semibold">{tx.invoice_id}</span>
                          </td>
                          <td className="py-3 px-4 font-sans">
                            <Badge
                              variant="outline"
                              className={`text-[10px] uppercase font-bold ${
                                tx.gateway === 'bkash'
                                  ? 'border-pink-500/40 text-pink-600 bg-pink-50/50 dark:bg-pink-950/40'
                                  : tx.gateway === 'nagad'
                                    ? 'border-orange-500/40 text-orange-600 bg-orange-50/50 dark:bg-orange-950/40'
                                    : tx.gateway === 'rocket'
                                      ? 'border-purple-500/40 text-purple-600 bg-purple-50/50 dark:bg-purple-950/40'
                                      : 'border-blue-500/40 text-blue-600 bg-blue-50/50 dark:bg-blue-950/40'
                              }`}
                            >
                              {gatewayName}
                            </Badge>
                          </td>
                          <td className="py-3 px-4 font-bold text-foreground">
                            ${Number(tx.amount || 0).toFixed(2)} USD
                          </td>
                          <td className="py-3 px-4 text-[11px] text-muted-foreground truncate max-w-[120px]">
                            {tx.gateway_txn_id || '—'}
                          </td>
                          <td className="py-3 px-4 text-muted-foreground font-sans text-[11px]">
                            {tx.created_at ? new Date(tx.created_at).toLocaleDateString('en-GB') : '—'}
                          </td>
                          <td className="py-3 px-4 font-sans">
                            {isSuccess ? (
                              <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400 border-emerald-200 text-[10px]">
                                Settled
                              </Badge>
                            ) : isPending ? (
                              <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400 border-amber-200 text-[10px]">
                                Pending
                              </Badge>
                            ) : (
                              <Badge className="bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-400 border-rose-200 text-[10px]">
                                Failed
                              </Badge>
                            )}
                          </td>
                          <td className="py-3 px-4 text-right font-sans">
                            <div className="flex items-center justify-end gap-1.5">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  setSelectedTransaction(tx)
                                  setTxDetailModalOpen(true)
                                }}
                                className="h-7 text-xs px-2"
                                title="View Safe Transaction Details"
                              >
                                Details
                              </Button>
                              {tx.invoice_id && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleDownloadInvoicePdf({ id: tx.invoice_id } as any)}
                                  disabled={downloadingInvoiceId === tx.invoice_id}
                                  className="h-7 text-xs px-2"
                                  title="Download Invoice PDF"
                                >
                                  <Download className="h-3 w-3 mr-1" />
                                  PDF
                                </Button>
                              )}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {filteredTransactions.length > txPageSize && (
              <div className="flex items-center justify-between p-4 border-t text-xs text-muted-foreground">
                <span>
                  Showing {(txPage - 1) * txPageSize + 1}–
                  {Math.min(txPage * txPageSize, filteredTransactions.length)} of {filteredTransactions.length} transactions
                </span>
                <div className="flex items-center gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={txPage <= 1}
                    onClick={() => setTxPage((p) => Math.max(1, p - 1))}
                    className="h-7 px-2 text-xs"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" /> Prev
                  </Button>
                  <span className="font-mono px-2">
                    Page {txPage} / {totalTxPages}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={txPage >= totalTxPages}
                    onClick={() => setTxPage((p) => Math.min(totalTxPages, p + 1))}
                    className="h-7 px-2 text-xs"
                  >
                    Next <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ─────────────────────────────────────────────────────────────
            3. PACKAGE ORDERS & PROVISIONING LEDGER
        ───────────────────────────────────────────────────────────── */}
        <Card className="border shadow-sm">
          <CardHeader className="pb-3 border-b flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base font-bold">Package Upgrade &amp; Provisioning Orders</CardTitle>
              <CardDescription className="text-xs">
                All package plan upgrades and secondary line deployments with printable carrier receipts.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative w-48">
                <Search className="h-3.5 w-3.5 absolute left-2.5 top-2.5 text-muted-foreground" />
                <Input
                  placeholder="Search order ID or plan..."
                  value={orderSearch}
                  onChange={(e) => {
                    setOrderSearch(e.target.value)
                    setOrderPage(1)
                  }}
                  className="pl-8 h-8 text-xs"
                />
              </div>
              <Badge variant="secondary" className="font-mono text-xs">
                {filteredOrders.length} Orders
              </Badge>
            </div>
          </CardHeader>

          <CardContent className="p-0">
            {fetchError && (
              <div className="m-4 p-3 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-xs flex items-center gap-2">
                <AlertTriangle size={14} className="shrink-0" />
                <span>{fetchError}</span>
              </div>
            )}
            {ordersLoading ? (
              <div className="py-12 text-center text-muted-foreground flex items-center justify-center gap-2">
                <RefreshCw className="h-4 w-4 animate-spin text-primary" />
                <span className="text-xs">Loading order ledger from database...</span>
              </div>
            ) : paginatedOrders.length === 0 ? (
              <div className="py-12 text-center space-y-3">
                <PackageCheck className="h-10 w-10 text-muted-foreground mx-auto stroke-1" />
                <p className="font-semibold text-sm text-foreground">No Package Orders Found</p>
                <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                  You can upgrade your symmetrical optical speed or add a secondary line at any time.
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
                    {paginatedOrders.map((ord) => {
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
                              {ord.download_speed >= 1000
                                ? `${ord.download_speed / 1000} Gbps`
                                : `${ord.download_speed} Mbps`}{' '}
                              Symmetrical
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
                            {new Date(ord.created_at).toLocaleDateString('en-US', {
                              day: '2-digit',
                              month: 'short',
                              year: 'numeric',
                            })}
                          </td>
                          <td className="py-3 px-4 text-right">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleOpenInvoice(ord)}
                              className="h-7 text-[11px] gap-1 px-2.5 font-semibold"
                            >
                              <Printer className="h-3 w-3" />
                              <span>Receipt</span>
                            </Button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {filteredOrders.length > orderPageSize && (
              <div className="flex items-center justify-between p-4 border-t text-xs text-muted-foreground">
                <span>
                  Showing {(orderPage - 1) * orderPageSize + 1}–
                  {Math.min(orderPage * orderPageSize, filteredOrders.length)} of {filteredOrders.length} orders
                </span>
                <div className="flex items-center gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={orderPage <= 1}
                    onClick={() => setOrderPage((p) => Math.max(1, p - 1))}
                    className="h-7 px-2 text-xs"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" /> Prev
                  </Button>
                  <span className="font-mono px-2">
                    Page {orderPage} / {totalOrderPages}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={orderPage >= totalOrderPages}
                    onClick={() => setOrderPage((p) => Math.min(totalOrderPages, p + 1))}
                    className="h-7 px-2 text-xs"
                  >
                    Next <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ─────────────────────────────────────────────────────────────
          ITEMIZED BILLING INVOICE MODAL (Shows Package Price, Install Fee, Tax Fee, Carryover, Late Fee)
      ───────────────────────────────────────────────────────────── */}
      {billDetailModalOpen && selectedBillInvoice && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-label="Billing invoice breakdown"
        >
          <Card className="w-full max-w-2xl bg-card border shadow-2xl animate-in zoom-in-95 my-8">
            <CardHeader className="border-b pb-4 flex flex-row items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="h-9 w-9 rounded-xl bg-primary text-primary-foreground flex items-center justify-center">
                  <Wifi className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-black text-base text-foreground leading-none">NextLink Global ISP</h3>
                  <p className="text-[10px] text-muted-foreground font-mono mt-0.5">ITEMIZED BILLING STATEMENT</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleDownloadInvoicePdf(selectedBillInvoice)}
                  className="h-8 gap-1.5 text-xs"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>PDF</span>
                </Button>
                <Button size="sm" variant="outline" onClick={() => window.print()} className="h-8 gap-1.5 text-xs">
                  <Printer className="h-3.5 w-3.5" />
                  <span>Print</span>
                </Button>
                <button
                  onClick={() => setBillDetailModalOpen(false)}
                  className="p-1.5 rounded-full hover:bg-muted text-muted-foreground"
                >
                  <X size={18} />
                </button>
              </div>
            </CardHeader>

            <CardContent className="p-6 space-y-5 text-xs">
              <div className="flex justify-between items-start">
                <div>
                  <span className="text-[10px] uppercase font-bold text-muted-foreground">Billed To</span>
                  <p className="font-bold text-sm text-foreground mt-0.5">{user?.name}</p>
                  <p className="text-muted-foreground font-mono">Subscriber ID: {selectedBillInvoice.subscriber_id}</p>
                  <p className="text-muted-foreground font-mono">
                    Plan: {selectedBillInvoice.raw_data?.packageName || activePackageName}
                  </p>
                </div>
                <div className="text-right">
                  <span className="text-[10px] uppercase font-bold text-muted-foreground">Invoice Number</span>
                  <p className="font-mono font-bold text-sm text-primary mt-0.5">{selectedBillInvoice.id}</p>
                  <p className="text-muted-foreground font-mono">Due Date: {selectedBillInvoice.due_date}</p>
                  <Badge
                    className={`mt-1 text-[10px] ${
                      selectedBillInvoice.status === 'paid'
                        ? 'bg-emerald-500 text-white'
                        : 'bg-amber-500 text-white'
                    }`}
                  >
                    {selectedBillInvoice.status.toUpperCase()}
                  </Badge>
                </div>
              </div>

              {/* Itemized Line Items */}
              <div className="border rounded-xl overflow-hidden">
                <table className="w-full text-left">
                  <thead className="bg-muted/50 border-b text-[11px] font-semibold text-muted-foreground">
                    <tr>
                      <th className="p-3">Line Item Description</th>
                      <th className="p-3">Type</th>
                      <th className="p-3 text-right">Amount (USD)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y font-mono">
                    {Array.isArray(selectedBillInvoice.raw_data?.lines) &&
                    selectedBillInvoice.raw_data.lines.length > 0 ? (
                      selectedBillInvoice.raw_data.lines.map((line: any, idx: number) => (
                        <tr key={idx}>
                          <td className="p-3 font-sans font-medium text-foreground">{line.label}</td>
                          <td className="p-3 text-muted-foreground uppercase text-[10px]">{line.type || 'charge'}</td>
                          <td className="p-3 text-right font-bold text-foreground">
                            ${Number(line.amount || 0).toFixed(2)}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <>
                        <tr>
                          <td className="p-3 font-sans font-medium text-foreground">
                            Monthly Package Subscription ({selectedBillInvoice.raw_data?.packageName || activePackageName})
                          </td>
                          <td className="p-3 text-muted-foreground uppercase text-[10px]">subscription</td>
                          <td className="p-3 text-right font-bold text-foreground">
                            $
                            {Number(
                              selectedBillInvoice.raw_data?.packagePrice ?? selectedBillInvoice.amount ?? 0
                            ).toFixed(2)}
                          </td>
                        </tr>
                        {Number(selectedBillInvoice.installation_fee || 0) > 0 && (
                          <tr>
                            <td className="p-3 font-sans text-foreground">One-Time Installation Fee</td>
                            <td className="p-3 text-muted-foreground uppercase text-[10px]">installation_fee</td>
                            <td className="p-3 text-right font-semibold text-foreground">
                              ${Number(selectedBillInvoice.installation_fee).toFixed(2)}
                            </td>
                          </tr>
                        )}
                        {Number(selectedBillInvoice.tax_fee || 0) > 0 && (
                          <tr>
                            <td className="p-3 font-sans text-foreground">Tax Fee</td>
                            <td className="p-3 text-muted-foreground uppercase text-[10px]">tax_fee</td>
                            <td className="p-3 text-right font-semibold text-foreground">
                              ${Number(selectedBillInvoice.tax_fee).toFixed(2)}
                            </td>
                          </tr>
                        )}
                        {Number(selectedBillInvoice.carried_over_amount || 0) > 0 && (
                          <tr>
                            <td className="p-3 font-sans text-amber-600">Carried-Over Unpaid Balance</td>
                            <td className="p-3 text-muted-foreground uppercase text-[10px]">carried_over</td>
                            <td className="p-3 text-right font-semibold text-amber-600">
                              ${Number(selectedBillInvoice.carried_over_amount).toFixed(2)}
                            </td>
                          </tr>
                        )}
                        {Number(selectedBillInvoice.late_fee || 0) > 0 && (
                          <tr>
                            <td className="p-3 font-sans text-destructive">Late Payment Fee (2% of Plan)</td>
                            <td className="p-3 text-muted-foreground uppercase text-[10px]">late_fee</td>
                            <td className="p-3 text-right font-semibold text-destructive">
                              ${Number(selectedBillInvoice.late_fee).toFixed(2)}
                            </td>
                          </tr>
                        )}
                      </>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="flex justify-between items-center pt-2 border-t">
                <div>
                  <p className="text-[11px] text-muted-foreground">
                    Billing Period: <strong className="text-foreground">{selectedBillInvoice.raw_data?.period || 'Monthly'}</strong>
                  </p>
                </div>
                <div className="text-right">
                  <span className="text-[11px] text-muted-foreground">Total Invoice Amount:</span>
                  <p className="text-xl font-black text-foreground font-mono">
                    ${Number(selectedBillInvoice.amount || 0).toFixed(2)} USD
                  </p>
                </div>
              </div>

              {selectedBillInvoice.status !== 'paid' && (
                <div className="pt-2 flex justify-end">
                  <Button
                    onClick={() => {
                      setBillDetailModalOpen(false)
                      handlePayLiveInvoice(selectedBillInvoice)
                    }}
                    className="font-bold text-xs"
                  >
                    <CreditCard className="h-4 w-4 mr-1.5" />
                    Pay ${Number(selectedBillInvoice.amount || 0).toFixed(2)} Now
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          PRINTABLE ORDER RECEIPT MODAL
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

            <CardContent className="p-6 space-y-5 text-xs">
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
                  <p className="text-muted-foreground font-mono">
                    Date: {new Date(selectedOrder.created_at).toLocaleDateString('en-GB')}
                  </p>
                  <div className="flex items-center justify-end gap-1.5 mt-1">
                    <Badge className="bg-emerald-500 text-white text-[10px]">
                      {selectedOrder.payment_status.toUpperCase()}
                    </Badge>
                    <Badge variant="outline" className="text-[10px] font-semibold">
                      {selectedOrder.order_status || 'Active'}
                    </Badge>
                  </div>
                </div>
              </div>

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
                          {selectedOrder.download_speed >= 1000
                            ? `${selectedOrder.download_speed / 1000} Gbps`
                            : `${selectedOrder.download_speed} Mbps`}{' '}
                          Symmetrical Speed
                        </span>
                      </td>
                      <td className="p-3 text-muted-foreground">
                        {selectedOrder.purchase_type_label ||
                          selectedOrder.purchaseTypeLabel ||
                          (String(selectedOrder.purchase_type).toLowerCase() === 'upgrade'
                            ? 'Package Plan Upgrade'
                            : 'Additional Secondary Drop')}
                      </td>
                      <td className="p-3 text-right font-bold text-foreground">
                        ${Number(selectedOrder.monthly_price ?? selectedOrder.total_payable ?? 0).toFixed(2)}
                      </td>
                    </tr>
                    {Number(selectedOrder.installation_fee) > 0 && (
                      <tr>
                        <td className="p-3 text-muted-foreground">One-Time Installation Fee</td>
                        <td className="p-3 text-muted-foreground">Setup</td>
                        <td className="p-3 text-right font-semibold text-foreground">
                          ${Number(selectedOrder.installation_fee).toFixed(2)}
                        </td>
                      </tr>
                    )}
                    {Number(selectedOrder.taxes) > 0 && (
                      <tr>
                        <td className="p-3 text-muted-foreground">Telecommunications Tax Fee</td>
                        <td className="p-3 text-muted-foreground">Tax</td>
                        <td className="p-3 text-right font-semibold text-foreground">
                          ${Number(selectedOrder.taxes || 0).toFixed(2)}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="flex justify-between items-center pt-2 border-t">
                <div>
                  <p className="text-[11px] text-muted-foreground">
                    Payment Gateway: <strong className="text-foreground capitalize">{selectedOrder.payment_method}</strong>
                  </p>
                  <p className="text-[11px] font-mono text-muted-foreground">Trx Ref: {selectedOrder.trx_id}</p>
                </div>
                <div className="text-right">
                  <span className="text-[11px] text-muted-foreground">Total Paid:</span>
                  <p className="text-xl font-black text-foreground font-mono">
                    ${Number(selectedOrder.total_payable || 0).toFixed(2)} USD
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          SAFE TRANSACTION DETAILS MODAL (Ownership Enforced)
      ───────────────────────────────────────────────────────────── */}
      {txDetailModalOpen && selectedTransaction && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-label="Transaction Details"
        >
          <Card className="w-full max-w-lg bg-card border shadow-2xl animate-in zoom-in-95 my-8">
            <CardHeader className="border-b pb-4 flex flex-row items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="h-9 w-9 rounded-xl bg-primary text-primary-foreground flex items-center justify-center">
                  <CreditCard className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-black text-base text-foreground leading-none">Payment Record</h3>
                  <p className="text-[10px] text-muted-foreground font-mono mt-0.5">TRANSACTION AUDIT LEDGER</p>
                </div>
              </div>
              <button
                onClick={() => setTxDetailModalOpen(false)}
                className="p-1.5 rounded-full hover:bg-muted text-muted-foreground"
              >
                <X size={18} />
              </button>
            </CardHeader>

            <CardContent className="p-6 space-y-4 text-xs">
              <div className="rounded-xl border bg-muted/30 p-4 space-y-2.5 font-mono">
                <div className="flex justify-between items-center font-sans">
                  <span className="text-muted-foreground">Subscriber Account:</span>
                  <span className="font-bold text-foreground">{user?.name} ({user?.id})</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground font-sans">Transaction ID:</span>
                  <span className="font-bold text-primary">{selectedTransaction.id}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground font-sans">Invoice ID:</span>
                  <span className="text-foreground">{selectedTransaction.invoice_id}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground font-sans">Payment Method:</span>
                  <Badge variant="outline" className="text-[10px] uppercase font-sans">
                    {selectedTransaction.gateway}
                  </Badge>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground font-sans">Gateway Txn ID:</span>
                  <span className="text-foreground truncate max-w-[200px]">{selectedTransaction.gateway_txn_id || '—'}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground font-sans">Timestamp:</span>
                  <span className="text-foreground">
                    {selectedTransaction.created_at ? new Date(selectedTransaction.created_at).toLocaleString() : '—'}
                  </span>
                </div>
                <div className="flex justify-between items-center pt-2 border-t font-sans">
                  <span className="font-bold text-foreground">Settled Amount:</span>
                  <span className="text-base font-black font-mono text-primary">
                    ${Number(selectedTransaction.amount || 0).toFixed(2)} USD
                  </span>
                </div>
                <div className="flex justify-between items-center font-sans">
                  <span className="text-muted-foreground">Status:</span>
                  <Badge
                    className={`text-[10px] uppercase ${
                      selectedTransaction.status === 'success' || selectedTransaction.status === 'completed'
                        ? 'bg-emerald-500 text-white'
                        : selectedTransaction.status === 'pending'
                          ? 'bg-amber-500 text-white'
                          : 'bg-rose-500 text-white'
                    }`}
                  >
                    {selectedTransaction.status}
                  </Badge>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t">
                {selectedTransaction.invoice_id && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleDownloadInvoicePdf({ id: selectedTransaction.invoice_id } as any)}
                    className="text-xs h-8 gap-1.5"
                  >
                    <Download className="h-3.5 w-3.5" />
                    <span>Download Invoice PDF</span>
                  </Button>
                )}
                <Button
                  size="sm"
                  onClick={() => setTxDetailModalOpen(false)}
                  className="text-xs h-8"
                >
                  Close
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          RESPONSIVE CHECKOUT MODAL (Phase 4.4.4 Payment Integration)
      ───────────────────────────────────────────────────────────── */}
      <PaymentModal
        open={checkoutModalOpen}
        invoice={invoiceToPay}
        onClose={() => {
          setCheckoutModalOpen(false)
          setInvoiceToPay(null)
        }}
        onSuccess={() => {
          setCheckoutModalOpen(false)
          setInvoiceToPay(null)
          refreshAll()
        }}
      />
    </div>
  )
}
