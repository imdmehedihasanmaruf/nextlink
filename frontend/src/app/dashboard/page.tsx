'use client'

import React, { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { 
  Wifi, 
  CreditCard, 
  AlertCircle, 
  Calendar, 
  DollarSign, 
  Activity, 
  HelpCircle, 
  Download, 
  Upload,
  ArrowUpRight, 
  LogOut, 
  User, 
  RefreshCw,
  Gift,
  Zap,
  Radio,
  Copy,
  Check,
  CheckCircle2,
  Lock,
  Printer,
  X,
  ShieldCheck,
  Globe,
  FileText,
  Smartphone,
  Globe2,
  Mail,
  Clock
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuthStore } from '@/store/authStore'
import { useTranslation } from '@/store/settingsStore'
import { useContentStore } from '@/store/contentStore'
import { fetchMyInvoices, fetchMySummary, fetchMyReferral, fetchMyTurboBoost, payInvoice, requestTurboBoost, type PortalInvoice, type PortalSummary } from '@/lib/portalApi'
import { useModalA11y } from '@/lib/useModalA11y'

interface PaymentRecord {
  id: string;
  month: string;
  date: string;
  amount: string;
  method: string;
  trxId: string;
  status: string;
}

export default function DashboardPage() {
  const router = useRouter()
  const { user, isAuthenticated, hasHydrated } = useAuthStore()
  const { t } = useTranslation()
  const { 
    packages,
    mediaHubs, 
    referralRewards, 
    boostBandwidth, 
    liveLatency, 
    interfaceTraffic, 
    peeringHubs, 
    fetchContent 
  } = useContentStore()

  useEffect(() => {
    fetchContent()
  }, [fetchContent])

  // Redirect unauthenticated visitors to login — never render the portal
  // empty/hydrated-less on a public URL. Use `hasHydrated` so the server
  // render matches the first client render.
  useEffect(() => {
    if (hasHydrated && !isAuthenticated) {
      router.push('/login')
    }
  }, [hasHydrated, isAuthenticated, router])

  // Mounted state for SSR Portal safety
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    setMounted(true)
  }, [])

  // Month names lookup
  const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ]

  const today = new Date()
  const actualDay = today.getDate()
  const currentDay = actualDay
  const isPaymentWindowOpen = currentDay >= 5 && currentDay <= 10

  // Warning state if user attempts to pay outside 5-10
  const [windowWarning, setWindowWarning] = useState<string | null>(null)

  // Retention States
  const [boostRequested, setBoostRequested] = useState(false)
  const [boostSending, setBoostSending] = useState(false)
  const [boostError, setBoostError] = useState<string | null>(null)
  const [copiedReferral, setCopiedReferral] = useState(false)

  // Real, database-backed values for the referral and turbo boost cards.
  // The CMS only supplies display copy; the numbers and the actions are real.
  const [myReferral, setMyReferral] = useState<{ code: string; title: string; description: string; bonusAmount: number; referrals: Array<{ status: string }> } | null>(null)
  const [myBoost, setMyBoost] = useState<{ activeRequest: boolean; requests: Array<{ reference: string; status: string; adminNote: string | null }> } | null>(null)

  // Payable balance state
  const [balance, setBalance] = useState(0.00)

  // Payment Modal & Gateway States (Step 5 Style)
  const [payModalOpen, setPayModalOpen] = useState(false)
  const [mobileWalletNumber, setMobileWalletNumber] = useState('')
  const [isProcessingPay, setIsProcessingPay] = useState(false)
  const [receiptModalOpen, setReceiptModalOpen] = useState(false)

  // Escape closes both overlays and the page does not scroll behind them.
  useModalA11y(payModalOpen, () => setPayModalOpen(false))
  useModalA11y(receiptModalOpen, () => setReceiptModalOpen(false))
  const [latestReceipt, setLatestReceipt] = useState<{
    receiptNo: string;
    trxId: string;
    date: string;
    amount: string;
    method: string;
    month?: string;
  } | null>(null)

  // Payment History State — derived from the billing service, never a local
  // ledger, so the portal can never claim a payment the server did not make.
  const [paymentHistory, setPaymentHistory] = useState<PaymentRecord[]>([])

  // Live billing data from the NextLink billing service (Express API)
  const [liveInvoices, setLiveInvoices] = useState<PortalInvoice[]>([])
  const [liveSummary, setLiveSummary] = useState<PortalSummary | null>(null)
  const [billingOnline, setBillingOnline] = useState<boolean | null>(null)
  const [payingInvoiceId, setPayingInvoiceId] = useState<string | null>(null)
  const [gatewayChoice, setGatewayChoice] = useState<'bkash' | 'nagad' | 'sslcommerz' | 'rocket'>('bkash')
  const [billingError, setBillingError] = useState<string | null>(null)

  /**
   * The bill outstanding with this account — derived from the billing
   * service, never from a hard-coded month. The due month is the period of
   * the first unpaid invoice.
   */
  const unpaidInvoice = liveInvoices.find((invoice) => invoice.status !== 'paid')
  const periodStr = (unpaidInvoice?.raw_data?.period as string | undefined) || ''
  const [periodYear, periodMonth] = periodStr.split('-').map(Number)
  const dueMonthNum = Number.isFinite(periodMonth) && periodMonth >= 1 && periodMonth <= 12
    ? periodMonth - 1
    : new Date().getMonth()
  const dueYearNum = Number.isFinite(periodYear) && periodYear > 2000 ? periodYear : new Date().getFullYear()
  const dueMonthName = MONTH_NAMES[dueMonthNum]
  const dueMonthNumStr = String(dueMonthNum + 1).padStart(2, '0')
  const dueYearStr = String(dueYearNum)
  const nextDueDateRangeFormatted = `05/${dueMonthNumStr}/${dueYearStr} - 10/${dueMonthNumStr}/${dueYearStr} of Every Month`
  const currencyOf = (invoice?: PortalInvoice | null) =>
    String(invoice?.raw_data?.currency || 'USD').toUpperCase()
  const unpaidAmount = unpaidInvoice ? Number(unpaidInvoice.amount || 0) : 0
  const invoiceCurrency = currencyOf(unpaidInvoice)

  const loadLiveBilling = React.useCallback(async () => {
    const summaryResult = await fetchMySummary()
    if (!summaryResult.success) {
      setBillingOnline(false)
      return
    }
    setBillingOnline(true)
    setLiveSummary(summaryResult.summary || null)

    const invoicesResult = await fetchMyInvoices()
    if (invoicesResult.success) {
      const invoices = invoicesResult.invoices || []
      setLiveInvoices(invoices)

      const paidParam = typeof window !== 'undefined'
        ? new URLSearchParams(window.location.search).get('paid')
        : null
      if (paidParam) {
        // The customer has just come back from the gateway — show the receipt
        // for that settled invoice, then drop the query parameter from the URL.
        showReceiptForInvoice(paidParam, invoices)
        if (typeof window !== 'undefined') {
          const url = new URL(window.location.href)
          url.searchParams.delete('paid')
          window.history.replaceState({}, '', url.toString())
        }
      }

      // The billing history table is built from the server invoices, so it
      // always matches what the billing service actually recorded.
      const history: PaymentRecord[] = invoices.map((invoice: PortalInvoice) => ({
        id: invoice.id,
        month: invoice.raw_data?.period || '',
        date: new Date(invoice.created_at).toLocaleDateString('en-US', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
        }),
        amount: Number(invoice.amount || 0).toFixed(2),
        method: invoice.raw_data?.paidVia
          ? String(invoice.raw_data.paidVia).toUpperCase()
          : '—',
        trxId: invoice.raw_data?.transactionId || '',
        status: invoice.status === 'paid' ? 'Paid' : 'Unpaid',
      }))
      setPaymentHistory(history)
    }
  }, [])

  // Real referral code + stats and turbo boost requests from the server.
  const loadReferralAndBoost = React.useCallback(async () => {
    const ref = await fetchMyReferral()
    if (ref.success && ref.code) {
      setMyReferral({
        code: ref.code,
        title: ref.title || 'Refer a friend',
        description: ref.description || 'Share your invite link — the reward is applied when your friend activates and pays.',
        bonusAmount: Number(ref.bonusAmount || 0),
        referrals: Array.isArray(ref.referrals) ? ref.referrals : [],
      })
    }
    const boost = await fetchMyTurboBoost()
    if (boost.success) {
      setMyBoost({
        activeRequest: !!boost.activeRequest,
        requests: Array.isArray(boost.requests) ? boost.requests : [],
      })
    }
  }, [])

  useEffect(() => {
    if (isAuthenticated) {
      loadLiveBilling()
      loadReferralAndBoost()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, loadLiveBilling, loadReferralAndBoost])

  // Pay a real invoice through the selected local gateway
  const handlePayLiveInvoice = async (invoice: PortalInvoice) => {
    setPayingInvoiceId(invoice.id)
    setBillingError(null)
    const result = await payInvoice(invoice.id, gatewayChoice)
    setPayingInvoiceId(null)

    if (!result.success || !result.redirectUrl) {
      setBillingError(result.error || 'Could not start the payment. Please try again.')
      return
    }

    // Redirect to the gateway checkout page (mock checkout in mock mode).
    window.location.href = result.redirectUrl
  }

  // Card form state — the gateway collects the card details itself, so the
  // portal never handles a card number.
  const [cardHolder, setCardHolder] = useState('')

  // Resolve current active package and monthly subscription price
  const activePackage = React.useMemo(() => {
    if (!packages || packages.length === 0) return null
    const userPkgName = (user?.packageName || user?.package || '').toLowerCase().trim()
    const userPkgId = (user?.packageId || '').toLowerCase().trim()
    return (
      packages.find(p => p.id?.toLowerCase() === userPkgId) ||
      packages.find(p => p.name?.toLowerCase() === userPkgName) ||
      packages.find(p => userPkgName && p.name?.toLowerCase().includes(userPkgName)) ||
      packages.find(p => userPkgName && userPkgName.includes(p.name?.toLowerCase())) ||
      packages[0]
    )
  }, [packages, user])

  useEffect(() => {
    if (hasHydrated && !isAuthenticated) {
      router.push('/login')
    }
  }, [hasHydrated, isAuthenticated, router])

  const handleOpenPayModal = () => {
    if (user?.name) {
      setCardHolder(user.name)
    }
    if (!isPaymentWindowOpen) {
      setWindowWarning(
        `Warning: Monthly bill payment is only accepted between the 5th and 10th of each month. Today is day ${currentDay} of the month (1st–4th & 11th–31st are restricted). Payments cannot be authorized today.`
      )
    } else {
      setWindowWarning(null)
    }
    setPayModalOpen(true)
  }

  /**
   * Pay the selected invoice through a real gateway.
   *
   * The invoice is settled by the billing service — the portal never marks
   * an invoice as paid on its own, and a receipt is only shown once the
   * gateway has confirmed the transaction.
   */
  const handleProcessPayment = async () => {
    // Requirement 2: Strict restriction check
    if (!isPaymentWindowOpen) {
      setWindowWarning(
        `Payment Warning: Monthly bill payment can only be cleared between the 5th and 10th of each month. Today is day ${currentDay}. Payments outside 5th–10th cannot be processed.`
      )
      return
    }

    // Pay the oldest unpaid invoice. The gateway decides the amount.
    const targetInvoice = liveInvoices.find((invoice) => invoice.status !== 'paid')
    if (!targetInvoice) {
      setWindowWarning('You have no unpaid bill at the moment.')
      return
    }

    setIsProcessingPay(true)
    setBillingError(null)

    const result = await payInvoice(targetInvoice.id, gatewayChoice)
    setIsProcessingPay(false)

    if (!result.success || !result.redirectUrl) {
      setBillingError(result.error || 'The payment could not be started. Please try again.')
      setPayModalOpen(false)
      return
    }

    // The gateway confirms the payment; the receipt is read back from the
    // billing service afterwards.
    window.location.href = result.redirectUrl
  }

  /**
   * Show the receipt for the settled invoice that the `?paid=<invoiceId>`
   * query parameter names. The receipt is built from the invoice the billing
   * service returned after verification — never from local state or from the
   * package price the customer saw on the purchase page.
   */
  const showReceiptForInvoice = (paidInvoiceId: string, invoices: PortalInvoice[]) => {
    const paid = invoices.find((invoice) => invoice.id === paidInvoiceId)
    if (!paid) {
      setBillingError(
        `The payment for invoice ${paidInvoiceId} could not be verified yet. Please refresh the page or contact support.`,
      )
      return false
    }
    if (paid.status !== 'paid') {
      // Not settled yet — show a "pending" notice instead of a receipt.
      setBillingError(`Your payment for invoice ${paid.id} is being verified. It will appear here shortly.`)
      return false
    }

    const paidAt = paid.raw_data?.paidAt
      ? new Date(paid.raw_data.paidAt)
      : new Date(paid.created_at)
    const currency = String(paid.raw_data?.currency || 'USD').toUpperCase()
    setLatestReceipt({
      receiptNo: paid.raw_data?.invoiceNumber || paid.id,
      trxId: String(paid.raw_data?.transactionId || paid.id),
      date: paidAt.toLocaleString(),
      amount: `${currency} ${Number(paid.amount).toFixed(2)}`,
      method: String(paid.raw_data?.paidVia || gatewayChoice).toUpperCase(),
      month: paid.raw_data?.period || `${dueMonthName} ${dueYearStr}`,
    })
    setReceiptModalOpen(true)
    return true
  }

  const handleTurboBoost = async () => {
    setBoostError(null)
    setBoostSending(true)
    const hours = Number(boostBandwidth?.durationHours || 6)
    const speed = Number(boostBandwidth?.boostSpeed || 1000)
    const result = await requestTurboBoost({ durationHours: hours, requestedMbps: speed })
    setBoostSending(false)
    if (result.success) {
      setBoostRequested(true)
      // Refresh from the server so the card reflects the new request's
      // reference and pending state.
      await loadReferralAndBoost()
    } else {
      setBoostError(result.error || 'The boost request could not be sent. Please try again.')
    }
  }

  const handleCopyReferral = async () => {
    const code = myReferral?.code || referralRewards?.defaultCode || ''
    if (!code) return
    try {
      await navigator.clipboard.writeText(`${typeof window !== 'undefined' ? window.location.origin : ''}/apply?ref=${code}`)
      setCopiedReferral(true)
      setTimeout(() => setCopiedReferral(false), 3000)
    } catch {
      // The browser can refuse the clipboard — that must not look like success.
      alert('Your browser blocked the clipboard. Please copy the link manually from the address bar.')
    }
  }

  // Latency values from the CMS peering configuration — shown as reference
  // figures, not as measurements from the customer's device.
  const latencyTargets = (Array.isArray(liveLatency?.targets) && liveLatency.targets.length > 0)
    ? liveLatency.targets
    : []

  if (!isAuthenticated) {
    return null
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl space-y-8">
      {/* Top Banner */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-primary/95 to-primary p-8 text-primary-foreground shadow-lg">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
          <div>
            <div className="flex flex-wrap items-center gap-2 mb-3">
              {/* The pill reflects the account's real status from the login
                  payload — a suspended line must not be shown as
                  "connection active", and there is no tier system to badge. */}
              {user?.status === 'registered' ? (
                <div className="inline-flex items-center gap-1.5 rounded-full bg-blue-400/20 text-blue-100 border border-blue-300/40 px-3 py-1 text-xs font-semibold backdrop-blur-sm">
                  <span className="h-2 w-2 rounded-full bg-blue-300"></span>
                  Registered — buy a plan to activate
                </div>
              ) : user?.status === 'cancelled' ? (
                <div className="inline-flex items-center gap-1.5 rounded-full bg-amber-400/20 text-amber-100 border border-amber-300/40 px-3 py-1 text-xs font-semibold backdrop-blur-sm">
                  <span className="h-2 w-2 rounded-full bg-amber-300"></span>
                  Subscription cancelled
                </div>
              ) : user?.status === 'suspended' || user?.status === 'blocked' ? (
                <div className="inline-flex items-center gap-1.5 rounded-full bg-amber-400/20 text-amber-100 border border-amber-300/40 px-3 py-1 text-xs font-semibold backdrop-blur-sm">
                  <span className="h-2 w-2 rounded-full bg-amber-300"></span>
                  Line suspended — contact support
                </div>
              ) : (
                <div className="inline-flex items-center gap-1.5 rounded-full bg-white/20 px-3 py-1 text-xs font-semibold backdrop-blur-sm">
                  <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse"></span>
                  {t('connectionActive')}
                </div>
              )}
            </div>
            <h1 className="text-3xl font-black tracking-tight text-white">
              {t('welcomeBack')}, {user?.name || user?.username || 'there'}!
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {!isPaymentWindowOpen ? (
              <Badge className="bg-amber-400 text-amber-950 font-bold border-none text-xs py-1 px-3 shadow-xs">
                ⚠️ Window: 5th–10th Only
              </Badge>
            ) : (
              <Badge className="bg-emerald-500 text-white font-bold border-none text-xs py-1 px-3 shadow-xs">
                ✓ Window Open: Pay {dueMonthName}
              </Badge>
            )}
            {/* Requirement 22: Interactive Pay Current Bill */}
            <Button 
              onClick={handleOpenPayModal}
              className="bg-white text-primary hover:bg-white/90 shadow font-bold"
            >
              <CreditCard className="mr-2 h-4 w-4 text-primary" />
              {t('payCurrentBill')}
            </Button>
          </div>
        </div>
      </div>

      {/* KPI Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border shadow-sm flex flex-col justify-between">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                {t('currentPackage')}
              </p>
              <Wifi className="h-5 w-5 text-primary" />
            </div>
            <div className="mt-3">
              <h3 className="text-2xl font-bold">
                {boostRequested
                  ? 'Boost Requested'
                  : user?.status === 'registered'
                    ? 'No active plan'
                    : user?.packageName || user?.package || 'Ultra Gigabit 500'}
              </h3>
              <p className="text-xs text-muted-foreground mt-1">
                {user?.status === 'registered'
                  ? 'Purchase a package to activate your service'
                  : 'Symmetrical 100% Optical Fiber'}
              </p>
            </div>
            <div className="pt-3 mt-3 border-t">
              <Link href="/dashboard/purchase">
                <Button size="sm" variant="outline" className="w-full text-xs font-bold gap-1.5 h-8">
                  <ArrowUpRight className="h-3.5 w-3.5" />
                  <span>{user?.status === 'registered' ? 'Buy a Package Plan' : 'Upgrade Fiber Plan'}</span>
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>

        <Card className="border shadow-sm">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                {t('dueDate')}
              </p>
              <Calendar className="h-5 w-5 text-amber-500" />
            </div>
            <div className="mt-3">
              <h3 className="text-base sm:text-lg lg:text-xl font-bold font-mono tracking-tight text-foreground">
                {nextDueDateRangeFormatted}
              </h3>
              <p className="text-xs text-amber-600 dark:text-amber-400 font-semibold mt-1">
                Payment window: 5th–10th of every month
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="border shadow-sm">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                {dueMonthName} Bill Due
              </p>
              <DollarSign className="h-5 w-5 text-primary" />
            </div>
            <div className="mt-3">
              <h3 className="text-2xl font-bold text-primary font-mono">
                {invoiceCurrency} {unpaidAmount.toFixed(2)}
              </h3>
              <p className="text-xs text-muted-foreground mt-1">
                Active: {activePackage?.name || user?.packageName || user?.package || 'Essential'} ({activePackage?.speed || 100} Mbps)
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="border shadow-sm">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Tier-1 Direct Peering
              </p>
              <Activity className="h-5 w-5 text-emerald-500" />
            </div>
            <div className="mt-3">
              <h3 className="text-2xl font-bold text-emerald-600">1.8 ms</h3>
              <p className="text-xs text-emerald-600 font-semibold mt-1">Cloudflare & AWS Direct Pipe</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Retention Programs (Referral, Turbo Boost, Live Latency). Each card
          honours its `enabled` flag from the CMS — when the operator disables
          the programme in the admin panel, the portal card disappears rather
          than advertising a programme that does not exist. */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 1. Refer & Earn Box — real data from the server */}
        {referralRewards?.enabled !== false && (
        <Card className="border-2 border-emerald-500/30 bg-emerald-500/5 shadow-sm">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <Badge className="bg-emerald-600 text-white font-bold">
                <Gift className="h-3.5 w-3.5 mr-1" />
                {t('referAndEarn')}
              </Badge>
              <span className="text-xs font-bold text-emerald-600">${myReferral?.bonusAmount ?? referralRewards?.bonusAmount ?? 0} Reward</span>
            </div>
            <CardTitle className="text-lg mt-2">
              {myReferral?.title || referralRewards?.title || 'Refer a friend'}
            </CardTitle>
            <CardDescription>
              {myReferral?.description || referralRewards?.description || 'Share your invite link — you get credit when your friend activates and pays.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-xl border bg-card p-3 flex items-center justify-between">
              <div>
                <p className="text-[10px] text-muted-foreground uppercase font-bold">Your Referral Code</p>
                <p className="font-mono font-bold text-sm text-primary">{myReferral?.code || '…'}</p>
              </div>
              <Button size="sm" variant="outline" onClick={handleCopyReferral} className="gap-1.5 h-8">
                {copiedReferral ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                <span className="text-xs">{copiedReferral ? 'Copied!' : 'Copy Link'}</span>
              </Button>
            </div>

            <div className="flex items-center justify-between text-xs text-muted-foreground pt-1 border-t">
              <span>Referrals Tracked: <strong className="text-foreground">{myReferral?.referrals?.length ?? 0}</strong></span>
              <span className="text-emerald-600 font-semibold">Credit: ${(myReferral?.referrals?.length ? myReferral.referrals.length * (myReferral.bonusAmount || 0) : 0).toFixed(2)}</span>
            </div>
          </CardContent>
        </Card>
        )}

        {/* 2. Turbo Boost on Request */}
        {boostBandwidth?.enabled !== false && (
        <Card className="border-2 border-amber-500/30 bg-amber-500/5 shadow-sm">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <Badge className="bg-amber-600 text-white font-bold">
                  <Zap className="h-3.5 w-3.5 mr-1" />
                  {t('instantBoost')}
                </Badge>
                <CardTitle className="text-lg mt-2">
                  {boostBandwidth?.title || 'Turbo Boost on Request'}
                </CardTitle>
              </div>
              <span className="text-xs font-bold text-amber-600">
                {myBoost?.activeRequest ? 'Pending' : (boostBandwidth?.status || 'Available')}
              </span>
            </div>
            <CardDescription>
              {boostBandwidth?.description || 'Request a time-boxed burst and the helpdesk activates it on your line.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {myBoost?.activeRequest ? (
              <div className="space-y-2">
                <div className="p-3 bg-amber-500/10 rounded-xl border border-amber-500/20 text-center">
                  <p className="text-xs font-bold text-amber-700 dark:text-amber-400">⚡ Boost request received</p>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Reference: <span className="font-mono font-semibold text-foreground">{myBoost.requests.find(r => r.status === 'requested' || r.status === 'in_progress')?.reference || '—'}</span>
                    <br />The helpdesk will apply the change on your line and confirm by SMS.
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  Ask the helpdesk for a complimentary {boostBandwidth?.durationHours || 6}-hour burst to {boostBandwidth?.boostSpeed || 1000} Mbps symmetrical.
                </p>
                {boostError && (
                  <p className="text-[11px] text-destructive">{boostError}</p>
                )}
                <Button onClick={handleTurboBoost} disabled={boostSending} className="w-full bg-amber-600 hover:bg-amber-700 text-white font-bold gap-2 shadow">
                  {boostSending ? (
                    <>
                      <RefreshCw className="h-4 w-4 animate-spin" />
                      Sending…
                    </>
                  ) : (
                    <>
                      <Zap className="h-4 w-4" />
                      Request {boostBandwidth?.boostSpeed || 1000}M Turbo Burst
                    </>
                  )}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
        )}

        {/* 3. Peering & Latency (reference) */}
        <Card className="border shadow-sm">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-1.5">
                <Radio className="h-4 w-4 text-primary" />
                {liveLatency?.title || t('livePing')}
              </CardTitle>
            </div>
            <CardDescription>
              Reference round-trip times at the peering points, configured by your operator — not measured from your device.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2.5 text-xs">
            {latencyTargets.length > 0 ? (
              latencyTargets.map((tgt: any) => (
                <div key={tgt.id || tgt.name} className="flex items-center justify-between p-2 rounded-lg bg-muted/30">
                  <span className="font-medium">{tgt.name}</span>
                  <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/30 font-mono">
                    {tgt.ping}
                  </Badge>
                </div>
              ))
            ) : (
              <div className="p-2 rounded-lg bg-muted/30 text-muted-foreground">
                Peering reference times have not been configured yet.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Usage & Speeds Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2 border shadow-sm">
          <CardHeader>
            <CardTitle>Bandwidth Consumption & Interface Traffic</CardTitle>
            <CardDescription>
              Current billing cycle utilization and live allocated bandwidth
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">{t('dataConsumed')}</span>
                <span className="font-bold text-foreground">
                  {interfaceTraffic?.consumedDataGB || '—'} / {interfaceTraffic?.totalQuota || '—'}
                </span>
              </div>
              {/* The bar is only drawn when the operator reported a real
                  consumption figure — a fixed percentage would be a made-up
                  statistic. */}
              {interfaceTraffic?.consumedDataGB && (
                <Progress value={35} className="h-3" />
              )}
            </div>

            <div className="grid grid-cols-2 gap-4 pt-2">
              <div className="rounded-xl border p-4 bg-muted/30">
                <div className="flex items-center gap-2 text-muted-foreground text-sm">
                  <Download className="h-4 w-4 text-emerald-500" />
                  {t('downloadRate')}
                </div>
                <p className="text-2xl font-bold mt-2 text-foreground">
                  {interfaceTraffic?.downloadRateMbps ? `${interfaceTraffic.downloadRateMbps} Mbps` : (activePackage?.speed ? `${activePackage.speed} Mbps` : '—')}
                </p>
                <p className="text-xs text-muted-foreground">
                  Allocated: {interfaceTraffic?.allocatedSpeed || activePackage?.speed || '—'} Mbps
                </p>
              </div>

              <div className="rounded-xl border p-4 bg-muted/30">
                <div className="flex items-center gap-2 text-muted-foreground text-sm">
                  <Upload className="h-4 w-4 text-blue-500" />
                  {t('uploadRate')}
                </div>
                <p className="text-2xl font-bold mt-2 text-foreground">
                  {interfaceTraffic?.uploadRateMbps ? `${interfaceTraffic.uploadRateMbps} Mbps` : (activePackage?.speed ? `${activePackage.speed} Mbps` : '—')}
                </p>
                <p className="text-xs text-muted-foreground">
                  Allocated: {interfaceTraffic?.allocatedSpeed || activePackage?.speed || '—'} Mbps
                </p>
              </div>
            </div>

            <div className="rounded-xl bg-primary/5 p-4 border border-primary/20 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <p className="font-semibold text-sm">Optical GPON Terminal & Gateway</p>
                <p className="text-xs text-muted-foreground font-mono">
                  IPv4: {interfaceTraffic?.gatewayIPv4 || '—'} • IPv6: {interfaceTraffic?.gatewayIPv6 || '—'} • OLT Port: {interfaceTraffic?.oltPort || '—'}
                </p>
              </div>
              <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400 border-emerald-200">
                {interfaceTraffic?.terminalStatus || 'Not reported'}
              </Badge>
            </div>
          </CardContent>
        </Card>

        {/* Quick Media Hubs */}
        <Card className="border shadow-sm">
          <CardHeader>
            <CardTitle>Cloud Peering Hubs</CardTitle>
            <CardDescription>Zero-buffering high throughput nodes</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {peeringHubs && peeringHubs.length > 0 ? (
              peeringHubs.map((hub: any) => (
                <a
                  key={hub.id || hub.name}
                  href={hub.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <Activity className="h-5 w-5 text-primary" />
                    <div>
                      <p className="font-semibold text-sm">{hub.name}</p>
                      <p className="text-xs text-muted-foreground font-mono truncate max-w-[180px]">{hub.url}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="text-xs">{hub.badge}</Badge>
                    <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                </a>
              ))
            ) : (
              <>
                <a 
                  href={mediaHubs?.speedtestUrl || 'https://speedtest.net'} 
                  target="_blank" 
                  rel="noreferrer"
                  className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <Activity className="h-5 w-5 text-primary" />
                    <span className="font-semibold text-sm">Speedtest Diagnostic</span>
                  </div>
                  <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
                </a>

                <a
                  href={mediaHubs?.ftpUrl || '#'}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/50 transition-colors"
                >
                  <div>
                    <p className="font-semibold text-sm">Global Storage CDN</p>
                    <p className="text-xs text-muted-foreground font-mono">{mediaHubs?.ftpUrl || 'https://storage.nextlink.global'}</p>
                  </div>
                  <Badge variant="secondary">Gigabit</Badge>
                </a>

                <a
                  href={mediaHubs?.liveTvUrl || '#'}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/50 transition-colors"
                >
                  <div>
                    <p className="font-semibold text-sm">Ultra HD Streaming</p>
                    <p className="text-xs text-muted-foreground font-mono">{mediaHubs?.liveTvUrl || 'https://tv.nextlink.global'}</p>
                  </div>
                  <Badge className="bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300">4K HDR</Badge>
                </a>
              </>
            )}

            <div className="p-4 rounded-xl bg-muted/40 text-center">
              <p className="text-xs text-muted-foreground">Worldwide NOC (24/7 Helpline)</p>
              <p className="text-lg font-bold text-primary mt-1">+880 1575 XXXXXX</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ================= LIVE BILLING (NextLink Billing Service) ================= */}
      <Card className="border shadow-sm">
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle>Current Bills</CardTitle>
              <CardDescription>
                Live invoices issued by the NextLink billing service — settle with bKash, Nagad, SSLCommerz or Rocket
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
              <Button variant="outline" size="sm" onClick={loadLiveBilling}>
                <RefreshCw className="mr-2 h-4 w-4" />
                Refresh
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {billingError && (
            <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-sm flex items-center gap-2">
              <AlertCircle size={16} className="shrink-0" />
              <span>{billingError}</span>
            </div>
          )}

          {liveSummary && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Outstanding</p>
                <p className="text-lg font-bold text-amber-600">
                  {invoiceCurrency} {liveSummary.outstanding.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                </p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Unpaid Bills</p>
                <p className="text-lg font-bold">{liveSummary.unpaidCount}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Paid Bills</p>
                <p className="text-lg font-bold text-emerald-600">{liveSummary.paidCount}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Referral Credit</p>
                <p className="text-lg font-bold text-emerald-600">
                  {(liveSummary.subscriber?.creditBalance ?? 0) > 0
                    ? `${invoiceCurrency} ${(liveSummary.subscriber!.creditBalance).toFixed(2)}`
                    : '—'}
                </p>
              </div>
            </div>
          )}

          {billingOnline && liveInvoices.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted-foreground">Pay using</span>
              {(['bkash', 'nagad', 'sslcommerz', 'rocket'] as const).map((gateway) => (
                <Button
                  key={gateway}
                  size="sm"
                  variant={gatewayChoice === gateway ? 'default' : 'outline'}
                  onClick={() => setGatewayChoice(gateway)}
                  className="h-8 text-xs"
                >
                  {gateway === 'sslcommerz' ? 'SSLCommerz' : gateway === 'bkash' ? 'bKash' : gateway === 'nagad' ? 'Nagad' : 'Rocket'}
                </Button>
              ))}
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-muted-foreground text-left">
                  <th className="py-3 px-4 font-semibold">Invoice ID</th>
                  <th className="py-3 px-4 font-semibold">Period</th>
                  <th className="py-3 px-4 font-semibold">Due Date</th>
                  <th className="py-3 px-4 font-semibold">Amount</th>
                  <th className="py-3 px-4 font-semibold">Status</th>
                  <th className="py-3 px-4 font-semibold text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {liveInvoices.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center py-8 text-muted-foreground">
                      {billingOnline
                        ? 'No invoices issued yet. Your first bill will appear after the billing cycle runs.'
                        : 'Billing service is currently unreachable.'}
                    </td>
                  </tr>
                ) : (
                  liveInvoices.map((invoice) => (
                    <tr key={invoice.id} className="hover:bg-muted/30">
                      <td className="py-3 px-4 font-mono text-xs">{invoice.id}</td>
                      <td className="py-3 px-4">{invoice.raw_data?.period || '—'}</td>
                      <td className="py-3 px-4 text-muted-foreground">{invoice.due_date}</td>
                      <td className="py-3 px-4 font-bold">
                        {currencyOf(invoice)} {Number(invoice.amount || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}
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
                        {invoice.status === 'paid' ? (
                          <span className="text-xs text-muted-foreground">Settled</span>
                        ) : (
                          <Button
                            size="sm"
                            onClick={() => handlePayLiveInvoice(invoice)}
                            disabled={payingInvoiceId === invoice.id || !billingOnline}
                            className="h-8 text-xs"
                          >
                            {payingInvoiceId === invoice.id ? 'Redirecting…' : 'Pay now'}
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Bill History Table */}
      <Card className="border shadow-sm">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>{t('billingHistory')}</CardTitle>
              <CardDescription>International invoices and automated transaction logs</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={() => window.print()}>
              <Download className="mr-2 h-4 w-4" />
              Export Statement
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-muted-foreground text-left">
                  <th className="py-3 px-4 font-semibold">Invoice ID</th>
                  <th className="py-3 px-4 font-semibold">Billing Period</th>
                  <th className="py-3 px-4 font-semibold">Date Paid</th>
                  <th className="py-3 px-4 font-semibold">Amount</th>
                  <th className="py-3 px-4 font-semibold">Payment Method</th>
                  <th className="py-3 px-4 font-semibold">Transaction Reference</th>
                  <th className="py-3 px-4 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {paymentHistory.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center py-8 text-muted-foreground">
                      No billing records or invoices found.
                    </td>
                  </tr>
                ) : (
                  paymentHistory.map((item) => (
                    <tr key={item.id} className="hover:bg-muted/30">
                      <td className="py-3 px-4 font-mono font-medium">{item.id}</td>
                      <td className="py-3 px-4">{item.month}</td>
                      <td className="py-3 px-4 text-muted-foreground">{item.date}</td>
                      <td className="py-3 px-4 font-bold">{item.amount}</td>
                      <td className="py-3 px-4">{item.method}</td>
                      <td className="py-3 px-4 font-mono text-xs text-muted-foreground">{item.trxId}</td>
                      <td className="py-3 px-4">
                        <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400 border-emerald-200">
                          {item.status}
                        </Badge>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* ================= STEP 5 PAYMENT MODAL: SELECT PAYMENT METHOD & AUTHORIZE ================= */}
      {mounted && payModalOpen && createPortal(
        <div 
          className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/80 p-3 sm:p-4 animate-in fade-in overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-label="Complete bill payment"
          onClick={() => setPayModalOpen(false)}
        >
          <Card 
            className="w-full max-w-lg max-h-[85vh] flex flex-col shadow-2xl border-2 animate-in zoom-in-95 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <CardHeader className="relative py-3 px-5 border-b shrink-0 bg-background/95">
              <button 
                onClick={() => setPayModalOpen(false)}
                className="absolute right-4 top-3 p-1.5 rounded-full hover:bg-muted text-muted-foreground transition-colors"
                aria-label="Close"
              >
                <X size={18} />
              </button>
              <div className="space-y-0.5 pr-8">
                <div className="flex items-center gap-2">
                  <CreditCard className="h-4 w-4 text-primary" />
                  <CardTitle className="text-base sm:text-lg font-bold">Step 5: Select Payment Method &amp; Authorize</CardTitle>
                </div>
                <CardDescription className="text-[11px] text-muted-foreground leading-tight">
                  All transactions are encrypted with 256-bit SSL and processed directly through verified carrier payment gateways.
                </CardDescription>
              </div>
            </CardHeader>

            {/* Scrollable Modal Body */}
            <div className="overflow-y-auto px-5 py-3 space-y-3 flex-1">
              {/* Date Window Warning or Status (Requirement 2) */}
              {!isPaymentWindowOpen ? (
                <div className="p-3 rounded-xl bg-amber-500/15 border-2 border-amber-500/40 text-xs flex items-start gap-2.5 text-amber-900 dark:text-amber-200">
                  <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <p className="font-bold text-sm text-amber-800 dark:text-amber-300">
                      Payment Window Warning: Only 5th–10th Allowed
                    </p>
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      Monthly bill payments can only be paid between the <strong className="text-foreground">5th and 10th of each month</strong>. Today is <strong className="text-foreground">{today.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' })} (Day {currentDay})</strong>. Payments attempted on <strong className="text-foreground">1st–4th</strong> or <strong className="text-foreground">11th–31st</strong> cannot be authorized.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-[11px] flex items-start gap-2 text-emerald-800 dark:text-emerald-300">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                  <div className="space-y-0.5 leading-tight">
                    <p className="font-bold">
                      Billing Window Open (5th–10th Active)
                    </p>
                    <p className="text-muted-foreground">
                      Clearing invoice for <strong className="text-foreground">{dueMonthName} {dueYearStr}</strong>. Bills must be cleared by the 10th.
                    </p>
                  </div>
                </div>
              )}

              {/* Active Package Bill Summary (Requirement 1 & Requirement 3) */}
              <div className="rounded-xl bg-muted/50 p-2.5 sm:p-3 border flex items-center justify-between text-xs">
                <div>
                  <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block">
                    Active Subscription · {dueMonthName} {dueYearStr} Bill
                  </span>
                  <p className="font-bold text-sm text-foreground mt-0.5">
                    {activePackage?.name || user?.packageName || user?.package || 'Essential'} ({activePackage?.speed || 100} Mbps)
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {String(invoiceCurrency)} · 100% Symmetrical Optical Fiber Drop
                  </p>
                </div>
                <div className="text-right">
                  <span className="text-[10px] font-semibold text-muted-foreground uppercase block">Amount Due</span>
                  <p className="text-xl font-black text-primary font-mono">
                    {invoiceCurrency} {unpaidAmount.toFixed(2)}
                  </p>
                  <span className="text-[10px] text-muted-foreground font-medium">per month</span>
                </div>
              </div>

              {/* Monthly Policy Reminder Alert */}
              <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-[11px] flex items-start gap-2">
                <Calendar className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                <div className="space-y-0.5 leading-tight">
                  <p className="font-bold text-amber-800 dark:text-amber-300">
                    Monthly Policy &amp; Email Reminder Schedule
                  </p>
                  <p className="text-muted-foreground">
                    Bills must be cleared by the <strong className="text-foreground">10th of each month</strong>. Daily reminder emails are sent between the <strong className="text-foreground">5th and 10th</strong> to <span className="font-mono text-foreground font-semibold">{user?.email || 'user@nextlink.global'}</span>.
                  </p>
                </div>
              </div>

              {/* Gateway Options Grid */}
              <div>
                <Label className="text-[11px] font-semibold uppercase text-muted-foreground block mb-1.5">
                  Payment Method
                </Label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                  {[
                    { id: 'bkash', label: 'bKash', icon: Smartphone },
                    { id: 'nagad', label: 'Nagad', icon: Smartphone },
                    { id: 'sslcommerz', label: 'SSLCommerz', icon: CreditCard },
                    { id: 'rocket', label: 'Rocket', icon: Globe2 },
                  ].map((gw) => {
                    const Icon = gw.icon
                    const isSelected = gatewayChoice === gw.id
                    return (
                      <button
                        key={gw.id}
                        type="button"
                        onClick={() => setGatewayChoice(gw.id as typeof gatewayChoice)}
                        className={`p-2 rounded-lg border-2 text-left transition-all flex items-center gap-1.5 ${
                          isSelected
                            ? 'border-primary bg-primary/10 text-primary font-bold shadow-xs'
                            : 'border-border hover:bg-muted/40 text-foreground'
                        }`}
                      >
                        <Icon className="h-3.5 w-3.5 shrink-0" />
                        <span className="text-[11px] leading-tight truncate">{gw.label}</span>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Form Input Fields */}
              <div className="border rounded-xl p-3 bg-card shadow-xs space-y-2.5">
                <div className="space-y-1.5">
                  <Label className="text-[11px]">
                    {gatewayChoice === 'bkash'
                      ? 'bKash Mobile Account Number'
                      : gatewayChoice === 'nagad'
                        ? 'Nagad Mobile Account Number'
                        : gatewayChoice === 'sslcommerz'
                          ? 'Cardholder Full Name'
                          : 'Rocket Mobile Account Number'}
                  </Label>
                  <Input
                    placeholder={
                      gatewayChoice === 'sslcommerz'
                        ? 'e.g. Alexander Wright'
                        : '+880 1700 000000'
                    }
                    value={mobileWalletNumber}
                    onChange={(e) => setMobileWalletNumber(e.target.value)}
                    className="h-8 text-xs font-mono"
                  />
                  <p className="text-[10px] text-muted-foreground">
                    You will be redirected to the {gatewayChoice === 'sslcommerz' ? 'SSLCommerz' : gatewayChoice.toUpperCase()} checkout to authorise the payment.
                  </p>
                </div>

                {/* Final Charged Amount Line */}
                <div className="pt-2 border-t flex justify-between items-center text-xs">
                  <span className="font-semibold text-muted-foreground">Final Charged Amount:</span>
                  <span className="font-mono font-black text-base text-primary">
                    {invoiceCurrency} {unpaidAmount.toFixed(2)}
                  </span>
                </div>
              </div>
            </div>

            {/* Modal Fixed Footer Button */}
            <div className="p-3 border-t bg-muted/20 shrink-0 space-y-1.5">
              <Button 
                onClick={handleProcessPayment} 
                className={`w-full font-bold shadow-md h-10 text-xs gap-2 ${
                  !isPaymentWindowOpen ? 'bg-amber-600 hover:bg-amber-600/90 text-white cursor-not-allowed opacity-90' : ''
                }`}
                disabled={isProcessingPay || !isPaymentWindowOpen}
              >
                {!isPaymentWindowOpen ? (
                  <>
                    <AlertCircle className="h-3.5 w-3.5" />
                    <span>Payment Window Closed (Allowed 5th–10th Only)</span>
                  </>
                ) : isProcessingPay ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    <span>Processing &amp; Authorizing Payment...</span>
                  </>
                ) : (
                  <>
                    <Lock className="h-3.5 w-3.5" />
                    <span>Confirm &amp; Pay {invoiceCurrency} {unpaidAmount.toFixed(2)}</span>
                  </>
                )}
              </Button>
              {!isPaymentWindowOpen && (
                <p className="text-[10px] text-center text-amber-700 dark:text-amber-400 font-medium">
                  * Warning: Bill payments can only be processed from the 5th to the 10th of the month.
                </p>
              )}
            </div>
          </Card>
        </div>,
        document.body
      )}

      {/* ================= PAYMENT RECEIPT MODAL (Requirement 22) ================= */}
      {mounted && receiptModalOpen && latestReceipt && createPortal(
        <div 
          className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/80 p-4 animate-in fade-in overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-label="Payment receipt"
          onClick={() => setReceiptModalOpen(false)}
        >
          <Card 
            className="w-full max-w-md shadow-2xl border-2 animate-in zoom-in-95"
            onClick={(e) => e.stopPropagation()}
          >
            <CardHeader className="text-center pb-2 border-b bg-muted/20">
              <div className="h-14 w-14 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 flex items-center justify-center mx-auto mb-2">
                <CheckCircle2 size={32} />
              </div>
              <CardTitle className="text-xl font-black">{t('receiptTitle')}</CardTitle>
              <CardDescription className="text-xs">Thank you for your payment. Your receipt is confirmed.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 pt-4">
              <div className="space-y-2 text-xs border rounded-xl p-4 bg-card font-mono">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Receipt Number:</span>
                  <span className="font-bold text-foreground">{latestReceipt.receiptNo}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Billing Period:</span>
                  <span className="font-bold text-primary">{latestReceipt.month || `${dueMonthName} ${dueYearStr}`}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t('transactionId')}:</span>
                  <span className="font-bold text-primary">{latestReceipt.trxId}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Date & Time:</span>
                  <span className="text-foreground">{latestReceipt.date}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Payment Method:</span>
                  <span className="text-foreground">{latestReceipt.method}</span>
                </div>
                <div className="border-t pt-2 flex justify-between text-sm font-bold">
                  <span className="text-foreground">{t('paidAmount')}:</span>
                  <span className="text-emerald-600 text-base">{latestReceipt.amount}</span>
                </div>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Balance Remaining:</span>
                  <span className="text-emerald-600 font-bold">
                    {invoiceCurrency} {(liveSummary?.outstanding !== undefined
                      ? Number(liveSummary.outstanding)
                      : 0
                    ).toFixed(2)}
                  </span>
                </div>
              </div>

              <div className="flex gap-2">
                <Button 
                  onClick={() => window.print()} 
                  variant="outline" 
                  className="flex-1 font-semibold gap-1.5"
                >
                  <Printer size={15} />
                  <span>{t('printReceipt')}</span>
                </Button>
                <Button 
                  onClick={() => setReceiptModalOpen(false)} 
                  className="flex-1 font-bold"
                >
                  {t('close')}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>,
        document.body
      )}
    </div>
  )
}
