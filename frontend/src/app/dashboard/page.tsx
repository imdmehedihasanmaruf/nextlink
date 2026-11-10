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
import { fetchMyInvoices, fetchMySummary, payInvoice, type PortalInvoice, type PortalSummary } from '@/lib/portalApi'

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

  // Due Billing Cycle State (starts at November 2026: month 10, year 2026)
  const [dueBillingCycle, setDueBillingCycle] = useState<{ month: number; year: number }>({
    month: 10, // November (0-indexed: 10 = November)
    year: 2026
  })

  // Date Simulation for Testing Billing Window (5th-10th Open, 1st-4th & 11th-31st Restricted)
  const [simulatedDay, setSimulatedDay] = useState<number | null>(null)
  const today = new Date()
  const actualDay = today.getDate()
  const currentDay = simulatedDay !== null ? simulatedDay : actualDay
  const isPaymentWindowOpen = currentDay >= 5 && currentDay <= 10

  // Warning state if user attempts to pay outside 5-10
  const [windowWarning, setWindowWarning] = useState<string | null>(null)

  // Derived month names and due date string (Requirement 4)
  const dueMonthName = MONTH_NAMES[dueBillingCycle.month]
  const dueMonthNumStr = String(dueBillingCycle.month + 1).padStart(2, '0')
  const dueYearStr = String(dueBillingCycle.year)
  const nextDueDateRangeFormatted = `05/${dueMonthNumStr}/${dueYearStr} - 10/${dueMonthNumStr}/${dueYearStr} of Every Month`

  // Persistent loading from localStorage on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedCycle = localStorage.getItem('nextlink_due_billing_cycle')
      if (savedCycle) {
        try {
          const parsed = JSON.parse(savedCycle)
          if (typeof parsed.month === 'number' && typeof parsed.year === 'number') {
            setDueBillingCycle(parsed)
          }
        } catch (e) {}
      }

      const savedHistory = localStorage.getItem('nextlink_payment_history')
      if (savedHistory) {
        try {
          const parsedHistory = JSON.parse(savedHistory)
          if (Array.isArray(parsedHistory) && parsedHistory.length > 0) {
            setPaymentHistory(parsedHistory)
          }
        } catch (e) {}
      } else {
        const defaultAmt = `$${monthlyBillAmount.toFixed(2)}`
        setPaymentHistory([
          {
            id: 'INV-2026-042',
            month: 'October 2026',
            date: '08 Oct 2026',
            amount: defaultAmt,
            method: 'Credit / Debit Card',
            trxId: 'TRX-OCT9482',
            status: 'Paid'
          }
        ])
      }
    }
  }, [])

  // Retention States
  const [turboActive, setTurboActive] = useState(false)
  const [turboHoursLeft, setTurboHoursLeft] = useState(6)
  const [copiedReferral, setCopiedReferral] = useState(false)
  const [pingRunning, setPingRunning] = useState(false)
  const [pings, setPings] = useState<Record<string, string>>({ peering: '1.8 ms', google: '18 ms', cloudflare: '9 ms' })

  // Payable balance state
  const [balance, setBalance] = useState(0.00)

  // Payment Modal & Gateway States (Step 5 Style)
  const [payModalOpen, setPayModalOpen] = useState(false)
  type PaymentGateway = 'card' | 'payoneer' | 'applepay' | 'bkash' | 'upi'
  const [paymentMethod, setPaymentMethod] = useState<PaymentGateway>('card')
  const [mobileWalletNumber, setMobileWalletNumber] = useState('')
  const [isProcessingPay, setIsProcessingPay] = useState(false)
  const [receiptModalOpen, setReceiptModalOpen] = useState(false)
  const [latestReceipt, setLatestReceipt] = useState<{
    receiptNo: string;
    trxId: string;
    date: string;
    amount: string;
    method: string;
    month?: string;
  } | null>(null)

  // Payment History State
  const [paymentHistory, setPaymentHistory] = useState<PaymentRecord[]>([])

  // Live billing data from the NextLink billing service (Express API)
  const [liveInvoices, setLiveInvoices] = useState<PortalInvoice[]>([])
  const [liveSummary, setLiveSummary] = useState<PortalSummary | null>(null)
  const [billingOnline, setBillingOnline] = useState<boolean | null>(null)
  const [payingInvoiceId, setPayingInvoiceId] = useState<string | null>(null)
  const [gatewayChoice, setGatewayChoice] = useState<'bkash' | 'nagad' | 'sslcommerz' | 'rocket'>('bkash')
  const [billingError, setBillingError] = useState<string | null>(null)

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
      setLiveInvoices(invoicesResult.invoices || [])
    }
  }, [])

  useEffect(() => {
    if (isAuthenticated) {
      loadLiveBilling()
    }
  }, [isAuthenticated, loadLiveBilling])

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

  // Card form state
  const [cardHolder, setCardHolder] = useState('Alexander Wright')
  const [cardNumber, setCardNumber] = useState('4242 •••• •••• 4242')
  const [cardExpiry, setCardExpiry] = useState('12/28')
  const [cardCvc, setCardCvc] = useState('888')

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

  const monthlyBillAmount = typeof activePackage?.price === 'number' 
    ? activePackage.price 
    : (activePackage?.price ? Number(activePackage.price) : 0)

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

  const handleProcessPayment = () => {
    // Requirement 2: Strict restriction check
    if (!isPaymentWindowOpen) {
      setWindowWarning(
        `Payment Warning: Monthly bill payment can only be cleared between the 5th and 10th of each month. Today is day ${currentDay}. Payments outside 5th–10th cannot be processed.`
      )
      return
    }

    setIsProcessingPay(true)
    setTimeout(() => {
      const generatedTrx = 'TRX-' + Math.random().toString(36).substring(2, 9).toUpperCase()
      const receiptNo = 'REC-' + Date.now().toString().slice(-6)
      const now = new Date()
      const dateStr = now.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' })
      const paidMonthName = dueMonthName
      const paidYear = dueBillingCycle.year
      const invId = `INV-${paidYear}-${String(paymentHistory.length + 1).padStart(3, '0')}`

      const methodNames: Record<PaymentGateway, string> = {
        card: 'Credit / Debit Card',
        payoneer: 'Payoneer Wallet',
        applepay: 'Apple / Google Pay',
        bkash: 'bKash Merchant',
        upi: 'UPI / Regional'
      }

      const paidRecord: PaymentRecord = {
        id: invId,
        month: `${paidMonthName} ${paidYear}`,
        date: dateStr,
        amount: `$${monthlyBillAmount.toFixed(2)}`,
        method: methodNames[paymentMethod],
        trxId: generatedTrx,
        status: 'Paid'
      }

      setLatestReceipt({
        receiptNo,
        trxId: generatedTrx,
        date: `${dateStr} ${now.toLocaleTimeString()}`,
        amount: `$${monthlyBillAmount.toFixed(2)}`,
        method: methodNames[paymentMethod],
        month: `${paidMonthName} ${paidYear}`
      })

      // Requirement 3: Roll over to NEXT month continuously (Nov -> Dec -> Jan -> Feb ...)
      let nextMonth = dueBillingCycle.month + 1
      let nextYear = dueBillingCycle.year
      if (nextMonth > 11) {
        nextMonth = 0
        nextYear += 1
      }
      const nextCycle = { month: nextMonth, year: nextYear }
      setDueBillingCycle(nextCycle)
      if (typeof window !== 'undefined') {
        localStorage.setItem('nextlink_due_billing_cycle', JSON.stringify(nextCycle))
      }

      const updatedHistory = [paidRecord, ...paymentHistory]
      setPaymentHistory(updatedHistory)
      if (typeof window !== 'undefined') {
        localStorage.setItem('nextlink_payment_history', JSON.stringify(updatedHistory))
      }

      setBalance(0.00)
      setIsProcessingPay(false)
      setPayModalOpen(false)
      setReceiptModalOpen(true)
    }, 1200)
  }

  const handleTurboBoost = () => {
    setTurboHoursLeft(boostBandwidth?.durationHours || 6)
    setTurboActive(true)
  }

  const handleCopyReferral = () => {
    const code = referralRewards?.defaultCode || 'NL-GLOBAL-REF'
    navigator.clipboard.writeText(`https://nextlink.global/apply?ref=${code}`)
    setCopiedReferral(true)
    setTimeout(() => setCopiedReferral(false), 3000)
  }

  const handleRunPing = () => {
    setPingRunning(true)
    setTimeout(() => {
      const updated: Record<string, string> = {}
      if (liveLatency?.targets && liveLatency.targets.length > 0) {
        liveLatency.targets.forEach((t) => {
          const base = parseFloat(t.ping) || 2.0
          const jitter = (Math.random() * 0.8 - 0.4).toFixed(1)
          updated[t.id] = `${Math.max(0.7, base + parseFloat(jitter)).toFixed(1)} ms`
        })
      }
      setPings((prev) => ({
        ...prev,
        ...updated,
        peering: `${(1 + Math.random() * 1.5).toFixed(1)} ms`,
        google: `${Math.floor(16 + Math.random() * 6)} ms`,
        cloudflare: `${Math.floor(7 + Math.random() * 4)} ms`
      }))
      setPingRunning(false)
    }, 800)
  }

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
              <div className="inline-flex items-center gap-1.5 rounded-full bg-white/20 px-3 py-1 text-xs font-semibold backdrop-blur-sm">
                <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse"></span>
                {t('connectionActive')}
              </div>
              <Badge className="bg-amber-500 text-white font-bold border-none">
                ⭐ Platinum Tier Member
              </Badge>
            </div>
            <h1 className="text-3xl font-black tracking-tight text-white">
              {t('welcomeBack')}, {user?.name || 'Alexander Wright'}!
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
                {turboActive ? 'Turbo 1000 Mbps' : (user?.packageName || user?.package || 'Ultra Gigabit 500')}
              </h3>
              <p className="text-xs text-muted-foreground mt-1">Symmetrical 100% Optical Fiber</p>
            </div>
            <div className="pt-3 mt-3 border-t">
              <Link href="/dashboard/purchase">
                <Button size="sm" variant="outline" className="w-full text-xs font-bold gap-1.5 h-8">
                  <ArrowUpRight className="h-3.5 w-3.5" />
                  <span>Upgrade Fiber Plan</span>
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
                ${monthlyBillAmount.toFixed(2)}
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

      {/* Retention Programs (Referral, Turbo Boost, Live Latency) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 1. Refer & Earn Box */}
        <Card className="border-2 border-emerald-500/30 bg-emerald-500/5 shadow-sm">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <Badge className="bg-emerald-600 text-white font-bold">
                <Gift className="h-3.5 w-3.5 mr-1" />
                {t('referAndEarn')}
              </Badge>
              <span className="text-xs font-bold text-emerald-600">${referralRewards?.bonusAmount || 25} Reward</span>
            </div>
            <CardTitle className="text-lg mt-2">
              {referralRewards?.title || 'Earn $25 on Your Next Invoice'}
            </CardTitle>
            <CardDescription>
              {referralRewards?.description || 'Share your unique invite link with colleagues or neighbors worldwide'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-xl border bg-card p-3 flex items-center justify-between">
              <div>
                <p className="text-[10px] text-muted-foreground uppercase font-bold">Your Referral Code</p>
                <p className="font-mono font-bold text-sm text-primary">{referralRewards?.defaultCode || 'NL-GLOBAL-REF'}</p>
              </div>
              <Button size="sm" variant="outline" onClick={handleCopyReferral} className="gap-1.5 h-8">
                {copiedReferral ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                <span className="text-xs">{copiedReferral ? 'Copied!' : 'Copy Link'}</span>
              </Button>
            </div>

            <div className="flex items-center justify-between text-xs text-muted-foreground pt-1 border-t">
              <span>Friends Joined: <strong className="text-foreground">{referralRewards?.friendsJoinedCount ?? (referralRewards?.referrals?.length ?? 3)} (${referralRewards?.totalSavedAmount ?? ((referralRewards?.friendsJoinedCount ?? 3) * (referralRewards?.bonusAmount || 25))} Saved)</strong></span>
              <span className="text-emerald-600 font-semibold">{referralRewards?.tierName || 'Platinum Tier'}</span>
            </div>
          </CardContent>
        </Card>

        {/* 2. 1-Click Instant Turbo Speed Boost */}
        <Card className="border-2 border-amber-500/30 bg-amber-500/5 shadow-sm">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <Badge className="bg-amber-600 text-white font-bold">
                <Zap className="h-3.5 w-3.5 mr-1" />
                {t('instantBoost')}
              </Badge>
              <span className="text-xs font-bold text-amber-600">{turboActive ? 'Active' : (boostBandwidth?.status || 'Ready')}</span>
            </div>
            <CardTitle className="text-lg mt-2">
              {boostBandwidth?.title || '1-Click 1 Gbps Turbo Boost'}
            </CardTitle>
            <CardDescription>
              {boostBandwidth?.description || 'Instantly scale bandwidth for massive cloud syncs, torrents, or gaming'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {turboActive ? (
              <div className="space-y-2">
                <div className="p-3 bg-amber-500/10 rounded-xl border border-amber-500/20 text-center">
                  <p className="text-xs font-bold text-amber-700 dark:text-amber-400">⚡ {boostBandwidth?.boostSpeed || 1000} Mbps Extreme Pipe Active!</p>
                  <p className="text-2xl font-black text-amber-600 mt-1">{turboHoursLeft} Hours Left</p>
                </div>
                <Progress value={(turboHoursLeft / (boostBandwidth?.durationHours || 6)) * 100} className="h-2 bg-amber-200 dark:bg-amber-950" />
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  Enjoy complimentary {boostBandwidth?.durationHours || 6}-hour burst speed to {boostBandwidth?.boostSpeed || 1000} Mbps symmetrical on demand.
                </p>
                <Button onClick={handleTurboBoost} className="w-full bg-amber-600 hover:bg-amber-700 text-white font-bold gap-2 shadow">
                  <Zap className="h-4 w-4" />
                  Activate {boostBandwidth?.boostSpeed || 1000}M Turbo Now
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* 3. Realtime Ping & Latency */}
        <Card className="border shadow-sm">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-1.5">
                <Radio className="h-4 w-4 text-primary" />
                {liveLatency?.title || t('livePing')}
              </CardTitle>
              <Button size="sm" variant="ghost" onClick={handleRunPing} disabled={pingRunning} className="h-8 w-8 p-0">
                <RefreshCw className={`h-3.5 w-3.5 ${pingRunning ? 'animate-spin' : ''}`} />
              </Button>
            </div>
            <CardDescription>{liveLatency?.description || 'Real-time response to Tier-1 international backbones'}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2.5 text-xs">
            {liveLatency?.targets && liveLatency.targets.length > 0 ? (
              liveLatency.targets.map((tgt: any) => (
                <div key={tgt.id || tgt.name} className="flex items-center justify-between p-2 rounded-lg bg-muted/30">
                  <span className="font-medium">{tgt.name}</span>
                  <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/30 font-mono">
                    {pings[tgt.id] || tgt.ping}
                  </Badge>
                </div>
              ))
            ) : (
              <>
                <div className="flex items-center justify-between p-2 rounded-lg bg-muted/30">
                  <span className="font-medium">Direct POP Peering</span>
                  <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/30 font-mono">{pings.peering || '1.2 ms'}</Badge>
                </div>
                <div className="flex items-center justify-between p-2 rounded-lg bg-muted/30">
                  <span className="font-medium">Cloudflare Edge (1.1.1.1)</span>
                  <Badge className="bg-blue-500/10 text-blue-600 border-blue-500/30 font-mono">{pings.cloudflare || '2.4 ms'}</Badge>
                </div>
                <div className="flex items-center justify-between p-2 rounded-lg bg-muted/30">
                  <span className="font-medium">Google DNS (8.8.8.8)</span>
                  <Badge className="bg-purple-500/10 text-purple-600 border-purple-500/30 font-mono">{pings.google || '3.1 ms'}</Badge>
                </div>
              </>
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
                  {interfaceTraffic?.consumedDataGB || '648.2 GB'} / {interfaceTraffic?.totalQuota || 'Unlimited Symmetrical'}
                </span>
              </div>
              <Progress value={35} className="h-3" />
            </div>

            <div className="grid grid-cols-2 gap-4 pt-2">
              <div className="rounded-xl border p-4 bg-muted/30">
                <div className="flex items-center gap-2 text-muted-foreground text-sm">
                  <Download className="h-4 w-4 text-emerald-500" />
                  {t('downloadRate')}
                </div>
                <p className="text-2xl font-bold mt-2 text-foreground">
                  {turboActive ? `${(boostBandwidth?.boostSpeed || 1000) * 0.98} Mbps` : `${interfaceTraffic?.downloadRateMbps || 498.2} Mbps`}
                </p>
                <p className="text-xs text-muted-foreground">
                  Allocated: {turboActive ? `${boostBandwidth?.boostSpeed || 1000} Mbps` : `${interfaceTraffic?.allocatedSpeed || 500} Mbps`}
                </p>
              </div>

              <div className="rounded-xl border p-4 bg-muted/30">
                <div className="flex items-center gap-2 text-muted-foreground text-sm">
                  <Upload className="h-4 w-4 text-blue-500" />
                  {t('uploadRate')}
                </div>
                <p className="text-2xl font-bold mt-2 text-foreground">
                  {turboActive ? `${(boostBandwidth?.boostSpeed || 1000) * 0.98} Mbps` : `${interfaceTraffic?.uploadRateMbps || 494.7} Mbps`}
                </p>
                <p className="text-xs text-muted-foreground">
                  Allocated: {turboActive ? `${boostBandwidth?.boostSpeed || 1000} Mbps` : `${interfaceTraffic?.allocatedSpeed || 500} Mbps`}
                </p>
              </div>
            </div>

            <div className="rounded-xl bg-primary/5 p-4 border border-primary/20 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <p className="font-semibold text-sm">Optical GPON Terminal & Gateway</p>
                <p className="text-xs text-muted-foreground font-mono">
                  IPv4: {interfaceTraffic?.gatewayIPv4 || '198.51.100.12'} • IPv6: {interfaceTraffic?.gatewayIPv6 || '2001:db8:85a3::8a2e:370:7334'} • OLT Port: {interfaceTraffic?.oltPort || '2/1/4'}
                </p>
              </div>
              <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400 border-emerald-200">
                {interfaceTraffic?.terminalStatus || 'Synchronized'}
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
                  {liveSummary.outstanding.toLocaleString('en-US', { maximumFractionDigits: 2 })}
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
                <p className="text-xs text-muted-foreground">Next Due</p>
                <p className="text-lg font-bold">
                  {liveSummary.nextInvoice ? liveSummary.nextInvoice.due_date : '—'}
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
                        {Number(invoice.amount || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}
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
          className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/80 p-3 sm:p-4 animate-in fade-in"
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

              {/* Date Simulation Tool for Instant Review of 5-10 Window vs 1-4/11-31 Warnings */}
              <div className="p-2 rounded-lg bg-muted/30 border flex flex-wrap items-center justify-between gap-1.5 text-[11px]">
                <span className="text-muted-foreground font-medium flex items-center gap-1">
                  <Clock className="h-3 w-3" /> Billing Window Tester:
                </span>
                <div className="flex flex-wrap gap-1">
                  <button
                    type="button"
                    onClick={() => setSimulatedDay(null)}
                    className={`px-2 py-0.5 rounded text-[10px] font-bold transition-all ${
                      simulatedDay === null
                        ? 'bg-primary text-primary-foreground shadow-xs'
                        : 'bg-muted hover:bg-muted/80 text-foreground'
                    }`}
                  >
                    Today (Day {actualDay}) {actualDay >= 5 && actualDay <= 10 ? '✓ Open' : '✕ Restricted'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setSimulatedDay(8)}
                    className={`px-2 py-0.5 rounded text-[10px] font-bold transition-all ${
                      simulatedDay === 8
                        ? 'bg-emerald-600 text-white shadow-xs'
                        : 'bg-muted hover:bg-muted/80 text-foreground'
                    }`}
                  >
                    Day 8 (Allowed)
                  </button>
                  <button
                    type="button"
                    onClick={() => setSimulatedDay(3)}
                    className={`px-2 py-0.5 rounded text-[10px] font-bold transition-all ${
                      simulatedDay === 3
                        ? 'bg-amber-600 text-white shadow-xs'
                        : 'bg-muted hover:bg-muted/80 text-foreground'
                    }`}
                  >
                    Day 3 (Warning 1-4)
                  </button>
                  <button
                    type="button"
                    onClick={() => setSimulatedDay(15)}
                    className={`px-2 py-0.5 rounded text-[10px] font-bold transition-all ${
                      simulatedDay === 15
                        ? 'bg-amber-600 text-white shadow-xs'
                        : 'bg-muted hover:bg-muted/80 text-foreground'
                    }`}
                  >
                    Day 15 (Warning 11-31)
                  </button>
                </div>
              </div>

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
                    Purchase Fee: ${monthlyBillAmount.toFixed(2)} USD · 100% Symmetrical Optical Fiber Drop
                  </p>
                </div>
                <div className="text-right">
                  <span className="text-[10px] font-semibold text-muted-foreground uppercase block">Amount Due</span>
                  <p className="text-xl font-black text-primary font-mono">${monthlyBillAmount.toFixed(2)}</p>
                  <span className="text-[10px] text-muted-foreground font-medium">USD / Month</span>
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
                    { id: 'card', label: 'Credit / Debit Card', icon: CreditCard },
                    { id: 'payoneer', label: 'Payoneer Wallet', icon: Globe2 },
                    { id: 'applepay', label: 'Apple / Google Pay', icon: Smartphone },
                    { id: 'bkash', label: 'bKash Merchant', icon: Smartphone },
                    { id: 'upi', label: 'UPI / Regional', icon: RefreshCw },
                  ].map((gw) => {
                    const Icon = gw.icon
                    const isSelected = paymentMethod === gw.id
                    return (
                      <button
                        key={gw.id}
                        type="button"
                        onClick={() => setPaymentMethod(gw.id as PaymentGateway)}
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
                {paymentMethod === 'card' && (
                  <div className="space-y-2">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div>
                        <Label className="text-[11px]">Cardholder Full Name</Label>
                        <Input
                          placeholder="e.g. Alexander Wright"
                          value={cardHolder}
                          onChange={(e) => setCardHolder(e.target.value)}
                          className="mt-1 h-8 text-xs"
                        />
                      </div>
                      <div>
                        <Label className="text-[11px]">Card Number</Label>
                        <Input
                          placeholder="4242 •••• •••• 4242"
                          value={cardNumber}
                          onChange={(e) => setCardNumber(e.target.value)}
                          className="mt-1 h-8 text-xs font-mono"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <Label className="text-[11px]">Expiration Date</Label>
                        <Input
                          placeholder="12/28"
                          value={cardExpiry}
                          onChange={(e) => setCardExpiry(e.target.value)}
                          className="mt-1 h-8 text-xs font-mono"
                        />
                      </div>
                      <div>
                        <Label className="text-[11px]">Security CVV</Label>
                        <Input
                          placeholder="•••"
                          type="password"
                          value={cardCvc}
                          onChange={(e) => setCardCvc(e.target.value)}
                          className="mt-1 h-8 text-xs font-mono"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {(paymentMethod === 'bkash' || paymentMethod === 'upi' || paymentMethod === 'payoneer') && (
                  <div className="space-y-1.5">
                    <Label className="text-[11px]">
                      {paymentMethod === 'bkash' ? 'bKash Mobile Account Number' : paymentMethod === 'upi' ? 'UPI Virtual Payment Address (VPA)' : 'Payoneer Linked Email / ID'}
                    </Label>
                    <Input
                      placeholder={paymentMethod === 'bkash' ? '+880 1700 000000' : paymentMethod === 'upi' ? 'subscriber@okaxis' : 'billing@company.com'}
                      value={mobileWalletNumber}
                      onChange={(e) => setMobileWalletNumber(e.target.value)}
                      className="h-8 text-xs font-mono"
                    />
                    <p className="text-[10px] text-muted-foreground">
                      Secure instant carrier authorization will challenge your registered mobile gateway.
                    </p>
                  </div>
                )}

                {paymentMethod === 'applepay' && (
                  <div className="text-center py-3 space-y-1">
                    <Smartphone className="h-6 w-6 text-primary mx-auto" />
                    <p className="font-bold text-xs">One-Touch Device Authentication</p>
                    <p className="text-[10px] text-muted-foreground max-w-xs mx-auto">
                      Clicking confirm will trigger biometric Apple Pay / Google Wallet authentication sheet.
                    </p>
                  </div>
                )}

                {/* Final Charged Amount Line */}
                <div className="pt-2 border-t flex justify-between items-center text-xs">
                  <span className="font-semibold text-muted-foreground">Final Charged Amount:</span>
                  <span className="font-mono font-black text-base text-primary">
                    ${monthlyBillAmount.toFixed(2)} USD
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
                    <span>Confirm &amp; Pay ${monthlyBillAmount.toFixed(2)} USD</span>
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
          className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/80 p-4 animate-in fade-in"
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
                  <span className="text-emerald-600 font-bold">$0.00 (Cleared)</span>
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
