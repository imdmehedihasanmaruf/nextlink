'use client'

import React, { useState, useEffect } from 'react'
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
  Globe
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

  // Retention States
  const [turboActive, setTurboActive] = useState(false)
  const [turboHoursLeft, setTurboHoursLeft] = useState(6)
  const [copiedReferral, setCopiedReferral] = useState(false)
  const [pingRunning, setPingRunning] = useState(false)
  const [pings, setPings] = useState<Record<string, string>>({ peering: '1.8 ms', google: '18 ms', cloudflare: '9 ms' })

  // Payable balance state
  const [balance, setBalance] = useState(0.00)

  // Payment Modal & Receipt States (Requirement 22)
  const [payModalOpen, setPayModalOpen] = useState(false)
  const [paymentMethod, setPaymentMethod] = useState<'card' | 'paypal' | 'applepay' | 'wire'>('card')
  const [isProcessingPay, setIsProcessingPay] = useState(false)
  const [receiptModalOpen, setReceiptModalOpen] = useState(false)
  const [latestReceipt, setLatestReceipt] = useState<{
    receiptNo: string;
    trxId: string;
    date: string;
    amount: string;
    method: string;
  } | null>(null)

  // Payment History State
  const [paymentHistory, setPaymentHistory] = useState<PaymentRecord[]>([])

  // Card form state
  const [cardHolder, setCardHolder] = useState('')
  const [cardNumber, setCardNumber] = useState('')
  const [cardExpiry, setCardExpiry] = useState('')
  const [cardCvc, setCardCvc] = useState('')

  useEffect(() => {
    if (hasHydrated && !isAuthenticated) {
      router.push('/login')
    }
  }, [hasHydrated, isAuthenticated, router])

  const handleOpenPayModal = () => {
    setPayModalOpen(true)
  }

  const handleProcessPayment = () => {
    setIsProcessingPay(true)
    setTimeout(() => {
      const generatedTrx = 'TRX-' + Math.random().toString(36).substring(2, 9).toUpperCase()
      const receiptNo = 'REC-' + Date.now().toString().slice(-6)
      const now = new Date()
      const dateStr = now.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' })
      const monthStr = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
      const invId = `INV-${now.getFullYear()}-${String(paymentHistory.length + 1).padStart(3, '0')}`

      const methodNames = {
        card: 'Credit Card (Stripe Global)',
        paypal: 'PayPal Express',
        applepay: 'Apple / Google Pay',
        wire: 'International Wire / SWIFT'
      }

      const record: PaymentRecord = {
        id: invId,
        month: monthStr,
        date: dateStr,
        amount: `$${balance.toFixed(2)}`,
        method: methodNames[paymentMethod],
        trxId: generatedTrx,
        status: 'Paid'
      }

      setLatestReceipt({
        receiptNo,
        trxId: generatedTrx,
        date: `${dateStr} ${now.toLocaleTimeString()}`,
        amount: `$${balance.toFixed(2)}`,
        method: methodNames[paymentMethod]
      })

      setPaymentHistory([record, ...paymentHistory])
      setBalance(0.00)
      setIsProcessingPay(false)
      setPayModalOpen(false)
      setReceiptModalOpen(true)
    }, 1500)
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
              <Badge className="bg-amber-400 text-slate-900 font-bold border-none">
                ⭐ Platinum Tier Member
              </Badge>
            </div>
            <h1 className="text-3xl font-black tracking-tight text-white">
              {t('welcomeBack')}, {user?.name || 'Alexander Wright'}!
            </h1>
          </div>

          <div className="flex flex-wrap gap-3">
            {/* Requirement 22: Interactive Pay Current Bill */}
            <Button 
              onClick={handleOpenPayModal}
              className="bg-white text-slate-900 hover:bg-slate-100 shadow font-bold"
            >
              <CreditCard className="mr-2 h-4 w-4 text-primary" />
              {t('payCurrentBill')}
            </Button>

            <Link href="/tickets">
              <Button variant="outline" className="bg-white/10 border-white text-white hover:bg-white/20 font-semibold">
                <HelpCircle className="mr-2 h-4 w-4" />
                {t('openTicket')}
              </Button>
            </Link>
          </div>
        </div>
      </div>

      {/* KPI Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border shadow-sm">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                {t('currentPackage')}
              </p>
              <Wifi className="h-5 w-5 text-primary" />
            </div>
            <div className="mt-3">
              <h3 className="text-2xl font-bold">{turboActive ? 'Turbo 1000 Mbps' : 'Ultra Gigabit 500'}</h3>
              <p className="text-xs text-muted-foreground mt-1">Symmetrical 100% Optical Fiber</p>
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
              <h3 className="text-2xl font-bold">15 Feb 2026</h3>
              <p className="text-xs text-emerald-600 font-semibold mt-1">Auto-Renewal Active</p>
            </div>
          </CardContent>
        </Card>

        <Card className="border shadow-sm">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                {t('payableAmount')}
              </p>
              <DollarSign className="h-5 w-5 text-primary" />
            </div>
            <div className="mt-3">
              <h3 className={`text-2xl font-bold ${balance === 0 ? 'text-emerald-600' : 'text-primary'}`}>
                ${balance.toFixed(2)}
              </h3>
              <p className="text-xs text-muted-foreground mt-1">
                {balance === 0 ? 'All bills cleared & paid' : 'Due via Card, PayPal, or Wire'}
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
              <p className="text-lg font-bold text-primary mt-1">+1 (800) 550-LINK</p>
            </div>
          </CardContent>
        </Card>
      </div>

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

      {/* ================= PAYMENT MODAL (Requirement 22) ================= */}
      {payModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in">
          <Card className="w-full max-w-lg shadow-2xl border-2 animate-in zoom-in-95">
            <CardHeader className="relative pb-4 border-b">
              <button 
                onClick={() => setPayModalOpen(false)}
                className="absolute right-4 top-4 p-1.5 rounded-full hover:bg-muted text-muted-foreground"
              >
                <X size={18} />
              </button>
              <div className="flex items-center gap-2">
                <CreditCard className="h-6 w-6 text-primary" />
                <div>
                  <CardTitle className="text-xl">{t('payModalTitle')}</CardTitle>
                  <CardDescription className="text-xs">{t('payModalDesc')}</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-5 pt-5">
              {/* Invoice Summary */}
              <div className="rounded-xl bg-muted/50 p-4 border flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">Current Outstanding Invoice</p>
                  <p className="font-bold text-sm">Ultra Gigabit 500 Mbps (Feb 2024)</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">Total Due</p>
                  <p className="text-2xl font-black text-primary">${balance.toFixed(2)}</p>
                </div>
              </div>

              {/* Payment Method Selector */}
              <div>
                <Label className="text-xs font-semibold uppercase text-muted-foreground">Select Payment Gateway</Label>
                <div className="grid grid-cols-2 gap-2 mt-2">
                  <button
                    type="button"
                    onClick={() => setPaymentMethod('card')}
                    className={`p-3 rounded-xl border-2 text-left font-semibold text-xs flex items-center gap-2 transition-all ${
                      paymentMethod === 'card' ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-muted'
                    }`}
                  >
                    <CreditCard size={16} />
                    <span>Credit / Debit Card</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setPaymentMethod('paypal')}
                    className={`p-3 rounded-xl border-2 text-left font-semibold text-xs flex items-center gap-2 transition-all ${
                      paymentMethod === 'paypal' ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-muted'
                    }`}
                  >
                    <Globe size={16} />
                    <span>PayPal Express</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setPaymentMethod('applepay')}
                    className={`p-3 rounded-xl border-2 text-left font-semibold text-xs flex items-center gap-2 transition-all ${
                      paymentMethod === 'applepay' ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-muted'
                    }`}
                  >
                    <Zap size={16} />
                    <span>Apple / Google Pay</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setPaymentMethod('wire')}
                    className={`p-3 rounded-xl border-2 text-left font-semibold text-xs flex items-center gap-2 transition-all ${
                      paymentMethod === 'wire' ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-muted'
                    }`}
                  >
                    <ShieldCheck size={16} />
                    <span>Bank Wire / SWIFT</span>
                  </button>
                </div>
              </div>

              {/* Method Details */}
              {paymentMethod === 'card' && (
                <div className="space-y-3 pt-1">
                  <div>
                    <Label className="text-xs">Cardholder Name</Label>
                    <Input 
                      value={cardHolder} 
                      onChange={(e) => setCardHolder(e.target.value)} 
                      className="mt-1"
                      placeholder="Name on card"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Card Number</Label>
                    <Input 
                      value={cardNumber} 
                      onChange={(e) => setCardNumber(e.target.value)} 
                      className="mt-1 font-mono"
                      placeholder="4000 1234 5678 9010"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Expiry Date</Label>
                      <Input 
                        value={cardExpiry} 
                        onChange={(e) => setCardExpiry(e.target.value)} 
                        className="mt-1 font-mono"
                        placeholder="MM/YY"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">CVC / CVV</Label>
                      <Input 
                        value={cardCvc} 
                        onChange={(e) => setCardCvc(e.target.value)} 
                        className="mt-1 font-mono"
                        placeholder="123"
                      />
                    </div>
                  </div>
                </div>
              )}

              {paymentMethod === 'paypal' && (
                <div className="rounded-xl border p-4 bg-muted/30 text-center space-y-2">
                  <p className="text-sm font-semibold">PayPal One-Click Checkout</p>
                  <p className="text-xs text-muted-foreground">You will be securely authenticated via PayPal Global Checkout to clear ${balance.toFixed(2)}.</p>
                </div>
              )}

              {paymentMethod === 'applepay' && (
                <div className="rounded-xl border p-4 bg-muted/30 text-center space-y-2">
                  <p className="text-sm font-semibold">Biometric Touch / Face ID</p>
                  <p className="text-xs text-muted-foreground">Authorize with your linked Apple Pay / Google Wallet card instantly.</p>
                </div>
              )}

              {paymentMethod === 'wire' && (
                <div className="rounded-xl border p-4 bg-muted/30 space-y-1.5 text-xs font-mono">
                  <p className="font-sans font-semibold text-foreground">Global SWIFT Wire Routing</p>
                  <p>Bank: JPMorgan Chase Bank, N.A., New York</p>
                  <p>Account: 9482-1102-4981 (USD)</p>
                  <p>SWIFT / BIC: CHASUS33XXX</p>
                </div>
              )}

              <Button 
                onClick={handleProcessPayment} 
                className="w-full font-bold shadow-lg h-11"
                disabled={isProcessingPay || balance <= 0}
              >
                {isProcessingPay ? (
                  <span className="flex items-center gap-2">
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    Processing Payment...
                  </span>
                ) : (
                  <span>Confirm & Pay ${balance.toFixed(2)}</span>
                )}
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ================= PAYMENT RECEIPT MODAL (Requirement 22) ================= */}
      {receiptModalOpen && latestReceipt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in">
          <Card className="w-full max-w-md shadow-2xl border-2 animate-in zoom-in-95">
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
        </div>
      )}
    </div>
  )
}
