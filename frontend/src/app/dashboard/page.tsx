'use client'

import React, { useState, useEffect, useCallback, useMemo, Suspense } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  Wifi,
  CreditCard,
  AlertCircle,
  Calendar,
  DollarSign,
  Activity,
  Download,
  Upload,
  ArrowUpRight,
  RefreshCw,
  Gift,
  Zap,
  Radio,
  Copy,
  Check,
  CheckCircle2,
  Cpu,
  Network,
  Server,
  Clock,
  ShieldCheck,
  Power,
  PowerOff,
  Ban,
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { useAuthStore } from '@/store/authStore'
import { useTranslation } from '@/store/settingsStore'
import { useContentStore } from '@/store/contentStore'
import {
  fetchMySummary,
  fetchLiveTelemetry,
  requestTurboBoost,
  deactivateTurboBoost,
  downloadInvoicePdf,
  type PortalSummary,
} from '@/lib/portalApi'

function formatRemainingDuration(totalSeconds: number): string {
  const sec = Math.max(0, Math.floor(totalSeconds))
  const hours = Math.floor(sec / 3600)
  const mins = Math.floor((sec % 3600) / 60)
  const secs = sec % 60
  return `${hours}h ${String(mins).padStart(2, '0')}m ${String(secs).padStart(2, '0')}s`
}

function CardSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3 animate-pulse py-2" data-testid="card-skeleton">
      <div className="h-5 w-1/2 rounded bg-muted" />
      {Array.from({ length: rows }).map((_, idx) => (
        <div key={idx} className="h-10 w-full rounded-lg bg-muted/70" />
      ))}
    </div>
  )
}

function DashboardContent() {
  const router = useRouter()
  const { user, isAuthenticated, hasHydrated, updateUser } = useAuthStore()
  const { t } = useTranslation()
  const { brand, packages, fetchContent } = useContentStore()

  const [liveSummary, setLiveSummary] = useState<PortalSummary | null>(null)
  const [telemetry, setTelemetry] = useState<any | null>(null)
  const [telemetryLoading, setTelemetryLoading] = useState(true)
  const [telemetryOnline, setTelemetryOnline] = useState<boolean | null>(null)
  const [lastUpdated, setLastUpdated] = useState<string>('')

  // Ping history samples for live chart in Card 9
  const [pingSamples, setPingSamples] = useState<Array<{ time: string; ping: number; jitter: number }>>([])

  // Local 1-second countdown for active Turbo Boost
  const [boostRemainingSec, setBoostRemainingSec] = useState<number>(0)
  const [boostActionLoading, setBoostActionLoading] = useState(false)
  const [boostError, setBoostError] = useState<string | null>(null)
  const [copiedReferral, setCopiedReferral] = useState(false)

  // Paid query param handler for gateway redirects (?paid=INV-...)
  const searchParams = useSearchParams()
  const paidInvoiceParam = searchParams?.get('paid')
  const [paidBannerVisible, setPaidBannerVisible] = useState(false)
  const [paidInvoiceId, setPaidInvoiceId] = useState<string | null>(null)
  const [downloadingPdf, setDownloadingPdf] = useState(false)

  useEffect(() => {
    fetchContent()
  }, [fetchContent])

  useEffect(() => {
    if (hasHydrated && !isAuthenticated) {
      router.push('/login')
    }
  }, [hasHydrated, isAuthenticated, router])

  const loadDashboardLive = useCallback(async (isInitial = false) => {
    if (isInitial) setTelemetryLoading(true)
    try {
      const [summaryRes, telemetryRes] = await Promise.all([
        fetchMySummary(),
        fetchLiveTelemetry(),
      ])

      if (summaryRes.success && summaryRes.summary) {
        setLiveSummary(summaryRes.summary)
      }

      if (telemetryRes.success && telemetryRes.telemetry) {
        const tData = telemetryRes.telemetry
        setTelemetry(tData)
        setTelemetryOnline(true)
        setLastUpdated(new Date(tData.timestamp || Date.now()).toLocaleTimeString())
        setBoostRemainingSec(Number(tData.turboBoost?.remainingSeconds || 0))

        // Append live ping sample to chart history (keep last 16 samples)
        const avgPing = Number(tData.liveLatency?.avgPingMs || 0)
        const avgJitter = Number(tData.liveLatency?.jitterMs || 0)
        if (avgPing > 0) {
          const label = new Date().toLocaleTimeString([], { hour12: false, minute: '2-digit', second: '2-digit' })
          setPingSamples((prev) => [...prev.slice(-15), { time: label, ping: avgPing, jitter: avgJitter }])
        }

        // Sync authoritative subscriber package & name into authStore so header and cards stay fresh
        const sub = tData.subscriber
        if (sub) {
          const updates: Record<string, any> = {}
          if (sub.packageName && sub.packageName !== user?.packageName) {
            updates.packageName = sub.packageName
            updates.package = sub.packageName
          }
          if (sub.packageId && sub.packageId !== user?.packageId) {
            updates.packageId = sub.packageId
          }
          if (sub.firstName && sub.firstName !== user?.firstName) {
            updates.firstName = sub.firstName
          }
          if (sub.lastName && sub.lastName !== user?.lastName) {
            updates.lastName = sub.lastName
          }
          if (sub.name && sub.name !== user?.name) {
            updates.name = sub.name
          }
          if (Object.keys(updates).length > 0) {
            updateUser(updates)
          }
        }
      } else {
        setTelemetryOnline(false)
      }
    } catch {
      setTelemetryOnline(false)
    } finally {
      if (isInitial) setTelemetryLoading(false)
    }
  }, [updateUser, user?.firstName, user?.lastName, user?.name, user?.packageId, user?.packageName])

  // Initial load + 4-second real-time polling
  useEffect(() => {
    if (!isAuthenticated) return
    loadDashboardLive(true)
    const interval = setInterval(() => {
      loadDashboardLive(false)
    }, 4000)
    return () => clearInterval(interval)
  }, [isAuthenticated, loadDashboardLive])

  // Refresh invoice & balance immediately when redirected with ?paid=INV-...
  useEffect(() => {
    if (paidInvoiceParam) {
      setPaidInvoiceId(paidInvoiceParam)
      setPaidBannerVisible(true)
      loadDashboardLive(true)
    }
  }, [paidInvoiceParam, loadDashboardLive])

  // 1-second local countdown for active Turbo Boost
  useEffect(() => {
    if (!telemetry?.turboBoost?.active || boostRemainingSec <= 0) return
    const timer = setInterval(() => {
      setBoostRemainingSec((prev) => {
        if (prev <= 1) {
          loadDashboardLive(false)
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [telemetry?.turboBoost?.active, boostRemainingSec, loadDashboardLive])

  // Requirement 3: Authoritative Current Package Name (never fallback to 'Essential' or packages[0])
  const accountStatus = String(
    telemetry?.subscriber?.status || liveSummary?.subscriber?.status || user?.status || ''
  ).toLowerCase()

  const accountPackageId = String(
    telemetry?.subscriber?.packageId || liveSummary?.subscriber?.packageId || user?.packageId || ''
  ).trim()

  const matchedCatalogPackage = useMemo(() => {
    if (!packages || packages.length === 0) return null
    if (accountPackageId) {
      const byId = packages.find((p) => p.id?.toLowerCase() === accountPackageId.toLowerCase())
      if (byId) return byId
    }
    const rawName = String(
      telemetry?.subscriber?.packageName || liveSummary?.subscriber?.packageName || user?.packageName || user?.package || ''
    ).trim()
    if (rawName) {
      return packages.find((p) => p.name?.toLowerCase() === rawName.toLowerCase()) || null
    }
    return null
  }, [packages, accountPackageId, telemetry?.subscriber?.packageName, liveSummary?.subscriber?.packageName, user?.packageName, user?.package])

  const accountPackageName = useMemo(() => {
    if (accountStatus === 'registered') return 'No active plan'
    return (
      telemetry?.subscriber?.packageName ||
      liveSummary?.subscriber?.packageName ||
      matchedCatalogPackage?.name ||
      user?.packageName ||
      user?.package ||
      'No active plan'
    )
  }, [accountStatus, telemetry?.subscriber?.packageName, liveSummary?.subscriber?.packageName, matchedCatalogPackage?.name, user?.packageName, user?.package])

  const monthlyBillAmount = useMemo(() => {
    if (telemetry?.subscriber?.price !== undefined && Number(telemetry.subscriber.price) > 0) {
      return Number(telemetry.subscriber.price)
    }
    if (matchedCatalogPackage && matchedCatalogPackage.price !== undefined) {
      return Number(matchedCatalogPackage.price)
    }
    return 0
  }, [telemetry?.subscriber?.price, matchedCatalogPackage])

  const allocatedSpeedMbps = useMemo(() => {
    if (telemetry?.subscriber?.speedMbps && Number(telemetry.subscriber.speedMbps) > 0) {
      return Number(telemetry.subscriber.speedMbps)
    }
    if (matchedCatalogPackage?.speed) {
      return Number(matchedCatalogPackage.speed)
    }
    return 0
  }, [telemetry?.subscriber?.speedMbps, matchedCatalogPackage?.speed])

  const handleActivateBoost = async () => {
    setBoostError(null)
    setBoostActionLoading(true)
    const hours = Number(telemetry?.turboBoost?.durationHours || 6)
    const speed = Number(telemetry?.turboBoost?.boostSpeedMbps || 1000)
    const result = await requestTurboBoost({
      durationHours: hours,
      requestedMbps: speed,
      action: 'activate',
    })
    setBoostActionLoading(false)
    if (result.success) {
      await loadDashboardLive(false)
    } else {
      setBoostError(result.error || 'Could not activate Turbo Boost. Please try again.')
    }
  }

  const handleDeactivateBoost = async () => {
    setBoostError(null)
    setBoostActionLoading(true)
    const activeId = telemetry?.turboBoost?.activeBoost?.id
    const result = await deactivateTurboBoost(activeId)
    setBoostActionLoading(false)
    if (result.success) {
      await loadDashboardLive(false)
    } else {
      setBoostError(result.error || 'Could not deactivate Turbo Boost. Please try again.')
    }
  }

  const handleCopyReferral = async () => {
    const link =
      telemetry?.referral?.referralLink ||
      (telemetry?.referral?.code && typeof window !== 'undefined'
        ? `${window.location.origin}/apply?ref=${telemetry.referral.code}`
        : '')
    if (!link) return
    try {
      await navigator.clipboard.writeText(link)
      setCopiedReferral(true)
      setTimeout(() => setCopiedReferral(false), 3000)
    } catch {
      alert('Your browser blocked clipboard access. Please copy the referral code manually.')
    }
  }

  if (!isAuthenticated) {
    return null
  }

  const bw = telemetry?.bandwidthTraffic
  const refData = telemetry?.referral
  const boostData = telemetry?.turboBoost
  const ontData = telemetry?.opticalTerminal
  const latencyData = telemetry?.liveLatency
  const hubsData: any[] = Array.isArray(telemetry?.peeringHubs) ? telemetry.peeringHubs : []
  const tier1Data = telemetry?.tier1Peering

  const greetingFirstName =
    telemetry?.subscriber?.firstName ||
    user?.firstName ||
    (user?.name ? user.name.trim().split(/\s+/)[0] : '') ||
    user?.username ||
    'Subscriber'

  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl space-y-8">
      {/* Payment Settled Success Banner */}
      {paidBannerVisible && paidInvoiceId && (
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 animate-in fade-in slide-in-from-top-2">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-emerald-500 text-white flex items-center justify-center shadow-sm shrink-0">
              <CheckCircle2 size={22} className="stroke-[2.5]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-foreground text-sm sm:text-base">Payment Settled Successfully</h3>
                <Badge className="bg-emerald-600 text-white text-[10px]">Paid</Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Invoice <strong className="font-mono text-primary font-bold">{paidInvoiceId}</strong> has been confirmed by the gateway. Your subscriber account balance is updated.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                setDownloadingPdf(true)
                await downloadInvoicePdf(paidInvoiceId)
                setDownloadingPdf(false)
              }}
              disabled={downloadingPdf}
              className="text-xs h-8 gap-1.5"
            >
              <Download className="h-3.5 w-3.5" />
              <span>{downloadingPdf ? 'Downloading…' : 'Download Receipt'}</span>
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setPaidBannerVisible(false)}
              className="text-xs h-8 text-muted-foreground"
            >
              Dismiss
            </Button>
          </div>
        </div>
      )}

      {/* Top Banner */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-primary/95 to-primary p-8 text-primary-foreground shadow-lg">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
          <div>
            <div className="flex flex-wrap items-center gap-2 mb-3">
              {accountStatus === 'registered' ? (
                <div className="inline-flex items-center gap-1.5 rounded-full bg-blue-400/20 text-blue-100 border border-blue-300/40 px-3 py-1 text-xs font-semibold backdrop-blur-sm">
                  <span className="h-2 w-2 rounded-full bg-blue-300" />
                  Registered — buy a plan to activate
                </div>
              ) : accountStatus === 'cancelled' ? (
                <div className="inline-flex items-center gap-1.5 rounded-full bg-amber-400/20 text-amber-100 border border-amber-300/40 px-3 py-1 text-xs font-semibold backdrop-blur-sm">
                  <span className="h-2 w-2 rounded-full bg-amber-300" />
                  Subscription cancelled
                </div>
              ) : accountStatus === 'suspended' || accountStatus === 'blocked' ? (
                <div className="inline-flex items-center gap-1.5 rounded-full bg-amber-400/20 text-amber-100 border border-amber-300/40 px-3 py-1 text-xs font-semibold backdrop-blur-sm">
                  <span className="h-2 w-2 rounded-full bg-amber-300" />
                  Line suspended — contact support
                </div>
              ) : (
                <div className="inline-flex items-center gap-1.5 rounded-full bg-white/20 px-3 py-1 text-xs font-semibold backdrop-blur-sm">
                  <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                  {t('connectionActive')}
                </div>
              )}

              <Badge className="bg-white/15 text-white border-white/25 text-[11px] font-mono">
                {telemetryOnline === true
                  ? `Live Telemetry • ${lastUpdated}`
                  : telemetryOnline === false
                    ? 'Telemetry Offline'
                    : 'Connecting…'}
              </Badge>
            </div>
            <h1 className="text-3xl font-black tracking-tight text-white">
              Hi, {greetingFirstName}!
            </h1>
            <p className="text-xs text-primary-foreground/80 mt-1">
              Active Plan: <strong className="text-white">{accountPackageName}</strong>
              {allocatedSpeedMbps > 0 ? ` (${allocatedSpeedMbps} Mbps Symmetrical Optical)` : ''}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => loadDashboardLive(false)}
              className="bg-white/15 text-white hover:bg-white/25 border border-white/25 text-xs font-semibold"
            >
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              Refresh Live Data
            </Button>
            <Link href="/cancel">
              <Button className="bg-white text-destructive hover:bg-white/90 shadow font-bold">
                <Ban className="mr-2 h-4 w-4 text-destructive" />
                My Cancelled Orders
              </Button>
            </Link>
          </div>
        </div>
      </div>

      {/* KPI Summary Row (Includes Requirement 3 Current Package & Requirement 11 Tier-1 Direct Peering) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Current Package Card (Requirement 3) */}
        <Card className="border shadow-sm flex flex-col justify-between" data-testid="current-package-card">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                {t('currentPackage')}
              </p>
              <Wifi className="h-5 w-5 text-primary" />
            </div>
            <div className="mt-3">
              <h3 className="text-2xl font-bold text-foreground" data-testid="current-package-name">
                {accountPackageName}
              </h3>
              <p className="text-xs text-muted-foreground mt-1">
                {accountStatus === 'registered'
                  ? 'Purchase a package to activate your service'
                  : allocatedSpeedMbps > 0
                    ? `${allocatedSpeedMbps} Mbps Symmetrical Optical Fiber`
                    : 'Symmetrical 100% Optical Fiber'}
              </p>
            </div>
            <div className="pt-3 mt-3 border-t">
              <Link href="/dashboard/purchase">
                <Button size="sm" variant="outline" className="w-full text-xs font-bold gap-1.5 h-8">
                  <ArrowUpRight className="h-3.5 w-3.5" />
                  <span>{accountStatus === 'registered' ? 'Buy a Package Plan' : 'Upgrade Fiber Plan'}</span>
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>

        {/* Next Invoice / Due Date */}
        <Card className="border shadow-sm flex flex-col justify-between">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Next Billing Due
              </p>
              <Calendar className="h-5 w-5 text-amber-500" />
            </div>
            <div className="mt-3">
              <h3 className="text-lg font-bold font-mono tracking-tight text-foreground">
                {liveSummary?.nextInvoice?.due_date || 'Monthly Cycle (UTC)'}
              </h3>
              <p className="text-xs text-muted-foreground mt-1">
                Unpaid Invoices: <strong className="text-foreground">{liveSummary?.unpaidCount ?? 0}</strong> • Paid:{' '}
                <strong className="text-emerald-600">{liveSummary?.paidCount ?? 0}</strong>
              </p>
            </div>
            <div className="pt-3 mt-3 border-t space-y-2">
              {((liveSummary?.unpaidCount ?? 0) > 0 || !liveSummary?.isCurrentPeriodPaid) && (telemetry?.subscriber?.packageId || user?.packageId) && (
                <Link href={`/dashboard/purchase?package=${encodeURIComponent(telemetry?.subscriber?.packageId || user?.packageId || '')}&type=RENEWAL`}>
                  <Button
                    size="sm"
                    className="w-full text-xs font-bold h-8 gap-1.5 cursor-pointer bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm"
                    aria-label="Pay Monthly Bill"
                    data-testid="pay-now-btn"
                  >
                    <CreditCard className="h-3.5 w-3.5" />
                    <span>Pay Monthly Bill</span>
                  </Button>
                </Link>
              )}
              <Link href="/packages">
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full text-xs font-semibold h-8 gap-1.5 cursor-pointer hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary"
                  aria-label="View Fiber Package Plan"
                  data-testid="view-fiber-package-plan-btn"
                >
                  <ArrowUpRight className="h-3.5 w-3.5 text-primary" />
                  <span>View Fiber Package Plan</span>
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>

        {/* Plan Price & Outstanding Balance */}
        <Card className="border shadow-sm flex flex-col justify-between">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Plan Rate &amp; Balance
              </p>
              <DollarSign className="h-5 w-5 text-primary" />
            </div>
            <div className="mt-3">
              <h3 className="text-2xl font-bold text-primary font-mono">
                ${monthlyBillAmount.toFixed(2)}
                <span className="text-xs font-normal text-muted-foreground"> / mo</span>
              </h3>
              <p className="text-xs text-muted-foreground mt-1">
                Outstanding:{' '}
                <strong className={Number(liveSummary?.outstanding || 0) > 0 ? 'text-amber-600' : 'text-emerald-600'}>
                  ${Number(liveSummary?.outstanding || 0).toFixed(2)}
                </strong>
              </p>
            </div>
            <div className="pt-3 mt-3 border-t">
              <Link href="/dashboard/orders">
                <Button size="sm" variant="outline" className="w-full text-xs font-semibold h-8">
                  Pay / Download Receipts
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>

        {/* Card 11: Tier-1 Direct Peering (KPI & Live Route Status) */}
        <Card className="border shadow-sm flex flex-col justify-between" data-testid="tier1-peering-card">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Tier-1 Direct Peering
              </p>
              <Activity className="h-5 w-5 text-emerald-500" />
            </div>
            {telemetryLoading && !telemetry ? (
              <CardSkeleton rows={2} />
            ) : !tier1Data || telemetryOnline === false ? (
              <div className="mt-3">
                <p className="text-sm font-semibold text-muted-foreground">Offline / No data</p>
                <p className="text-xs text-muted-foreground mt-1">Peering telemetry unavailable</p>
              </div>
            ) : (
              <div className="mt-3 space-y-1.5">
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="text-2xl font-bold text-emerald-600 font-mono">
                    {tier1Data.avgLatencyMs !== undefined ? `${tier1Data.avgLatencyMs} ms` : '—'}
                  </h3>
                  <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/30 text-[10px]">
                    {tier1Data.routeStatus || 'Optimal BGP'}
                  </Badge>
                </div>
                <p className="text-xs font-semibold text-foreground truncate">{tier1Data.provider}</p>
                <p className="text-[11px] text-muted-foreground font-mono">
                  {tier1Data.asn} • {tier1Data.capacityGbps} Gbps • {tier1Data.uptimePercent}% SLA
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Cards 6, 7, 9: Refer a Friend, 1 Gbps On-Demand Turbo Boost, Realtime Ping & Latency */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Card 6: Refer a Friend & Earn $25 Credit */}
        <Card className="border-2 border-emerald-500/30 bg-emerald-500/5 shadow-sm" data-testid="referral-card">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <Badge className="bg-emerald-600 text-white font-bold">
                <Gift className="h-3.5 w-3.5 mr-1" />
                {t('referAndEarn')}
              </Badge>
              <span className="text-xs font-bold text-emerald-600">
                ${Number(refData?.bonusAmount ?? 25).toFixed(0)} Credit
              </span>
            </div>
            <CardTitle className="text-lg mt-2">
              {refData?.title || `Refer a Friend & Earn $${Number(refData?.bonusAmount ?? 25).toFixed(0)} Credit`}
            </CardTitle>
            <CardDescription>
              {refData?.description ||
                'Share your personal invite link — earn account credit when your friend activates and pays.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {telemetryLoading && !telemetry ? (
              <CardSkeleton rows={3} />
            ) : !refData || telemetryOnline === false ? (
              <div className="p-4 rounded-xl border bg-card text-center text-xs text-muted-foreground">
                Offline / No referral data available
              </div>
            ) : (
              <>
                <div className="rounded-xl border bg-card p-3 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[10px] text-muted-foreground uppercase font-bold">Your Referral Code</p>
                    <p className="font-mono font-bold text-sm text-primary truncate" data-testid="referral-code">
                      {refData.code || 'Not assigned'}
                    </p>
                    {refData.referralLink && (
                      <p className="text-[10px] text-muted-foreground font-mono truncate mt-0.5">
                        {refData.referralLink}
                      </p>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleCopyReferral}
                    disabled={!refData.code}
                    className="gap-1.5 h-8 shrink-0"
                  >
                    {copiedReferral ? (
                      <Check className="h-3.5 w-3.5 text-emerald-600" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                    <span className="text-xs">{copiedReferral ? 'Copied!' : 'Copy Link'}</span>
                  </Button>
                </div>

                <div className="grid grid-cols-3 gap-2 pt-1 text-center text-xs">
                  <div className="rounded-lg border bg-card p-2">
                    <span className="text-[10px] text-muted-foreground block uppercase">Referrals</span>
                    <strong className="font-mono text-sm text-foreground">{refData.referralCount ?? 0}</strong>
                  </div>
                  <div className="rounded-lg border bg-card p-2">
                    <span className="text-[10px] text-muted-foreground block uppercase">Earned</span>
                    <strong className="font-mono text-sm text-emerald-600">
                      ${Number(refData.creditsEarned ?? 0).toFixed(2)}
                    </strong>
                  </div>
                  <div className="rounded-lg border bg-card p-2">
                    <span className="text-[10px] text-muted-foreground block uppercase">Pending</span>
                    <strong className="font-mono text-sm text-amber-600">
                      ${Number(refData.creditsPending ?? 0).toFixed(2)}
                    </strong>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Card 7: 1 Gbps On-Demand Turbo Boost */}
        <Card className="border-2 border-amber-500/30 bg-amber-500/5 shadow-sm" data-testid="turbo-boost-card">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <Badge className="bg-amber-600 text-white font-bold">
                <Zap className="h-3.5 w-3.5 mr-1" />
                {t('instantBoost')}
              </Badge>
              <Badge
                variant="outline"
                className={
                  boostData?.active
                    ? 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30 font-bold uppercase text-[10px]'
                    : boostData?.status === 'expired'
                      ? 'bg-muted text-muted-foreground border-border uppercase text-[10px]'
                      : 'bg-amber-500/15 text-amber-600 border-amber-500/30 font-bold uppercase text-[10px]'
                }
              >
                {boostData?.active
                  ? 'Active'
                  : boostData?.status === 'expired'
                    ? 'Expired'
                    : boostData?.status === 'requested'
                      ? 'Requested'
                      : 'Available'}
              </Badge>
            </div>
            <CardTitle className="text-lg mt-2">
              {boostData?.title || '1 Gbps On-Demand Turbo Boost'}
            </CardTitle>
            <CardDescription>
              {boostData?.description ||
                'Activate an instant symmetrical optical speed burst on your line with real-time countdown.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {telemetryLoading && !telemetry ? (
              <CardSkeleton rows={3} />
            ) : !boostData || telemetryOnline === false ? (
              <div className="p-4 rounded-xl border bg-card text-center text-xs text-muted-foreground">
                Offline / No Turbo Boost telemetry available
              </div>
            ) : boostData.active ? (
              <div className="space-y-3">
                <div className="p-3.5 bg-emerald-500/10 rounded-xl border border-emerald-500/30 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
                      <Zap className="h-4 w-4" />
                      {boostData.boostSpeedMbps || 1000} Mbps Active
                    </span>
                    <span className="font-mono text-[11px] text-muted-foreground">
                      Ref: {boostData.activeBoost?.reference || '—'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between pt-1 border-t border-emerald-500/20 text-xs">
                    <span className="text-muted-foreground flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5" /> Remaining Time:
                    </span>
                    <span className="font-mono font-black text-sm text-foreground" data-testid="boost-remaining-time">
                      {formatRemainingDuration(boostRemainingSec)}
                    </span>
                  </div>
                </div>
                {boostError && <p className="text-[11px] text-destructive">{boostError}</p>}
                <Button
                  variant="outline"
                  onClick={handleDeactivateBoost}
                  disabled={boostActionLoading}
                  className="w-full border-destructive/40 text-destructive hover:bg-destructive/10 font-bold gap-2 h-9 text-xs"
                >
                  {boostActionLoading ? (
                    <>
                      <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                      Deactivating…
                    </>
                  ) : (
                    <>
                      <PowerOff className="h-3.5 w-3.5" />
                      Deactivate Turbo Boost
                    </>
                  )}
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="rounded-xl border bg-card p-3 flex items-center justify-between text-xs">
                  <div>
                    <span className="text-[10px] text-muted-foreground uppercase block font-bold">Burst Profile</span>
                    <strong className="text-foreground font-mono">
                      {boostData.boostSpeedMbps || 1000} Mbps ({boostData.durationHours || 6} Hours)
                    </strong>
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] text-muted-foreground uppercase block font-bold">Last Status</span>
                    <span className="font-semibold capitalize text-muted-foreground">
                      {boostData.status || 'Ready'}
                    </span>
                  </div>
                </div>
                {boostError && <p className="text-[11px] text-destructive">{boostError}</p>}
                <Button
                  onClick={handleActivateBoost}
                  disabled={boostActionLoading}
                  className="w-full bg-amber-600 hover:bg-amber-700 text-white font-bold gap-2 shadow h-9 text-xs"
                >
                  {boostActionLoading ? (
                    <>
                      <RefreshCw className="h-4 w-4 animate-spin" />
                      Activating…
                    </>
                  ) : (
                    <>
                      <Power className="h-4 w-4" />
                      Activate {boostData.boostSpeedMbps || 1000} Mbps Turbo Boost
                    </>
                  )}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Card 9: Realtime Ping & Latency */}
        <Card className="border shadow-sm" data-testid="live-latency-card">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-1.5">
                <Radio className="h-4 w-4 text-primary" />
                {latencyData?.title || 'Realtime Ping & Latency'}
              </CardTitle>
              <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/30 text-[10px]">
                Live Probe
              </Badge>
            </div>
            <CardDescription>
              {latencyData?.description || 'Live TCP probe latency, jitter, and packet loss to Tier-1 backbones'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-xs">
            {telemetryLoading && !telemetry ? (
              <CardSkeleton rows={4} />
            ) : !latencyData || telemetryOnline === false ? (
              <div className="p-4 rounded-xl border bg-muted/30 text-center text-muted-foreground">
                Offline / No latency telemetry available
              </div>
            ) : (
              <>
                {/* Summary Metrics: Ping, Jitter, Packet Loss */}
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg border bg-muted/30 p-2">
                    <span className="text-[10px] text-muted-foreground uppercase block">Avg Ping</span>
                    <strong className="font-mono text-sm text-emerald-600">
                      {latencyData.avgPingMs !== undefined ? `${latencyData.avgPingMs} ms` : '—'}
                    </strong>
                  </div>
                  <div className="rounded-lg border bg-muted/30 p-2">
                    <span className="text-[10px] text-muted-foreground uppercase block">Jitter</span>
                    <strong className="font-mono text-sm text-foreground">
                      {latencyData.jitterMs !== undefined ? `${latencyData.jitterMs} ms` : '—'}
                    </strong>
                  </div>
                  <div className="rounded-lg border bg-muted/30 p-2">
                    <span className="text-[10px] text-muted-foreground uppercase block">Packet Loss</span>
                    <strong className="font-mono text-sm text-foreground">
                      {latencyData.packetLossPercent !== undefined ? `${latencyData.packetLossPercent}%` : '0%'}
                    </strong>
                  </div>
                </div>

                {/* Live Chart of Recent Ping Samples */}
                {pingSamples.length > 0 && (
                  <div className="rounded-lg border bg-muted/20 p-2.5 space-y-1.5">
                    <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                      <span className="font-semibold uppercase">Live Latency Telemetry Chart</span>
                      <span className="font-mono">{pingSamples.length} samples</span>
                    </div>
                    <div className="flex items-end gap-1 h-12 pt-1">
                      {pingSamples.map((s, idx) => {
                        const maxPing = Math.max(...pingSamples.map((p) => p.ping), 20)
                        const heightPct = Math.max(18, Math.min(100, Math.round((s.ping / maxPing) * 100)))
                        return (
                          <div
                            key={`${s.time}-${idx}`}
                            className="flex-1 bg-emerald-500/80 hover:bg-emerald-500 rounded-t transition-all"
                            style={{ height: `${heightPct}%` }}
                            title={`${s.time}: ${s.ping} ms (Jitter ${s.jitter} ms)`}
                          />
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* Per-Target Breakdown */}
                {Array.isArray(latencyData.targets) && latencyData.targets.length > 0 ? (
                  <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                    {latencyData.targets.map((tgt: any) => (
                      <div
                        key={tgt.id || tgt.name}
                        className="flex items-center justify-between p-2 rounded-lg bg-muted/30 border border-border/50"
                      >
                        <div className="min-w-0">
                          <span className="font-medium block truncate">{tgt.name}</span>
                          <span className="text-[10px] text-muted-foreground font-mono">
                            {tgt.host} • Jitter: {tgt.jitterMs ?? 0}ms • Loss: {tgt.packetLossPercent ?? 0}%
                          </span>
                        </div>
                        <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/30 font-mono shrink-0">
                          {tgt.ping}
                        </Badge>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-2 rounded-lg bg-muted/30 text-muted-foreground text-center">
                    No latency targets configured in Live Latency &amp; Ping module.
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Cards 5, 8, 10: Bandwidth Consumption & Interface Traffic, Optical GPON Terminal & Gateway, Cloud Peering Hubs */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Card 5: Bandwidth Consumption & Interface Traffic */}
        <Card className="lg:col-span-2 border shadow-sm" data-testid="bandwidth-traffic-card">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Bandwidth Consumption &amp; Interface Traffic</CardTitle>
                <CardDescription>
                  Real-time throughput, cycle data utilization, and physical interface counters
                </CardDescription>
              </div>
              <Badge variant="outline" className="font-mono text-xs">
                {bw?.allocatedDownloadMbps ? `${bw.allocatedDownloadMbps} Mbps Plan` : 'Live Link'}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {telemetryLoading && !telemetry ? (
              <CardSkeleton rows={4} />
            ) : !bw || telemetryOnline === false ? (
              <div className="p-6 rounded-xl border bg-muted/30 text-center text-sm text-muted-foreground">
                Offline / Bandwidth telemetry currently unavailable
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{t('dataConsumed')}</span>
                    <span className="font-bold text-foreground font-mono">
                      {bw.consumedDataGB} GB / {bw.totalQuotaGB}
                    </span>
                  </div>
                  <Progress value={Number(bw.utilizationPercent || 0)} className="h-3" />
                  <p className="text-[11px] text-muted-foreground text-right font-mono">
                    Cycle Utilization: {Number(bw.utilizationPercent || 0)}%
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="rounded-xl border p-4 bg-muted/30">
                    <div className="flex items-center gap-2 text-muted-foreground text-sm">
                      <Download className="h-4 w-4 text-emerald-500" />
                      {t('downloadRate')}
                    </div>
                    <p className="text-2xl font-bold mt-2 text-foreground font-mono">
                      {bw.downloadRateMbps} Mbps
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Allocated: {bw.allocatedDownloadMbps} Mbps
                    </p>
                  </div>

                  <div className="rounded-xl border p-4 bg-muted/30">
                    <div className="flex items-center gap-2 text-muted-foreground text-sm">
                      <Upload className="h-4 w-4 text-blue-500" />
                      {t('uploadRate')}
                    </div>
                    <p className="text-2xl font-bold mt-2 text-foreground font-mono">
                      {bw.uploadRateMbps} Mbps
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Allocated: {bw.allocatedUploadMbps} Mbps
                    </p>
                  </div>
                </div>

                {Array.isArray(bw.interfaces) && bw.interfaces.length > 0 ? (
                  <div className="border rounded-xl overflow-hidden">
                    <div className="bg-muted/40 px-4 py-2 border-b flex items-center justify-between">
                      <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                        Optical &amp; Physical Interfaces
                      </span>
                      <span className="text-[11px] text-emerald-600 font-semibold">Live Telemetry</span>
                    </div>
                    <div className="divide-y text-xs">
                      {bw.interfaces.map((iface: any) => (
                        <div
                          key={iface.id || iface.name}
                          className="px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 hover:bg-muted/20"
                        >
                          <div>
                            <span className="font-semibold text-foreground">{iface.name}</span>
                            <span className="ml-2 text-[10px] font-mono text-muted-foreground px-1.5 py-0.5 rounded bg-muted">
                              {iface.type}
                            </span>
                          </div>
                          <div className="flex items-center gap-3 font-mono">
                            <span className="text-emerald-600 dark:text-emerald-400">RX: {iface.rx}</span>
                            <span className="text-blue-600 dark:text-blue-400">TX: {iface.tx}</span>
                            <Badge className="bg-emerald-500/15 text-emerald-600 border-emerald-500/30 text-[10px]">
                              {iface.status}
                            </Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="p-3 rounded-xl border bg-muted/20 text-xs text-muted-foreground text-center">
                    No active interface counters reported.
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* Right Column: Card 8 (Optical GPON Terminal & Gateway) & Card 10 (Cloud Peering Hubs) */}
        <div className="space-y-6">
          {/* Card 8: Optical GPON Terminal & Gateway */}
          <Card className="border shadow-sm" data-testid="optical-terminal-card">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <Cpu className="h-4 w-4 text-primary" />
                  Optical GPON Terminal &amp; Gateway
                </CardTitle>
                {ontData && (
                  <Badge
                    className={
                      String(ontData.ontStatus).toLowerCase().includes('online') ||
                      String(ontData.ontStatus).toLowerCase().includes('sync')
                        ? 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30 text-[10px]'
                        : 'bg-amber-500/15 text-amber-600 border-amber-500/30 text-[10px]'
                    }
                  >
                    {ontData.ontStatus}
                  </Badge>
                )}
              </div>
              <CardDescription className="text-xs">
                Live ONT optical signal level, gateway routing, and device uptime
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-xs">
              {telemetryLoading && !telemetry ? (
                <CardSkeleton rows={3} />
              ) : !ontData || telemetryOnline === false ? (
                <div className="p-4 rounded-xl border bg-muted/30 text-center text-muted-foreground">
                  Offline / ONT telemetry unreachable
                </div>
              ) : (
                <div className="space-y-2.5">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="p-2.5 rounded-lg border bg-muted/30">
                      <span className="text-[10px] text-muted-foreground uppercase block">Optical Signal (RX/TX)</span>
                      <strong className="font-mono text-foreground">
                        {ontData.signalRxDbm} dBm / {ontData.signalTxDbm} dBm
                      </strong>
                      <span className="block text-[10px] text-emerald-600 font-semibold mt-0.5">
                        {ontData.signalQuality}
                      </span>
                    </div>
                    <div className="p-2.5 rounded-lg border bg-muted/30">
                      <span className="text-[10px] text-muted-foreground uppercase block">Terminal Uptime</span>
                      <strong className="font-mono text-foreground">{ontData.uptime}</strong>
                      <span className="block text-[10px] text-muted-foreground mt-0.5">
                        Temp: {ontData.temperatureC}°C
                      </span>
                    </div>
                  </div>
                  <div className="rounded-lg border bg-muted/20 p-2.5 space-y-1 font-mono text-[11px]">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Gateway IPv4:</span>
                      <span className="text-foreground font-semibold">{ontData.gatewayIpv4}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Gateway IPv6:</span>
                      <span className="text-foreground truncate max-w-[160px]">{ontData.gatewayIpv6}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">OLT Port:</span>
                      <span className="text-foreground">{ontData.oltPort}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">ONU Model:</span>
                      <span className="text-foreground">{ontData.onuModel}</span>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Card 10: Cloud Peering Hubs */}
          <Card className="border shadow-sm" data-testid="cloud-peering-hubs-card">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <Network className="h-4 w-4 text-primary" />
                  Cloud Peering Hubs
                </CardTitle>
                <Badge variant="secondary" className="text-[10px] font-mono">
                  {hubsData.length} Nodes
                </Badge>
              </div>
              <CardDescription className="text-xs">
                Direct zero-buffering IXP &amp; cloud exchange interconnects
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2.5">
              {telemetryLoading && !telemetry ? (
                <CardSkeleton rows={3} />
              ) : telemetryOnline === false ? (
                <div className="p-4 rounded-xl border bg-muted/30 text-center text-xs text-muted-foreground">
                  Offline / Cloud peering hubs unreachable
                </div>
              ) : hubsData.length === 0 ? (
                <div className="p-4 rounded-xl border bg-muted/30 text-center text-xs text-muted-foreground">
                  No cloud peering hubs configured in backend.
                </div>
              ) : (
                hubsData.map((hub: any) => (
                  <a
                    key={hub.id || hub.name}
                    href={hub.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center justify-between p-2.5 rounded-lg border hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Server className="h-4 w-4 text-primary shrink-0" />
                      <div className="min-w-0">
                        <p className="font-semibold text-xs text-foreground truncate">{hub.name}</p>
                        <p className="text-[10px] text-muted-foreground font-mono truncate">{hub.url}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Badge variant="secondary" className="text-[10px]">
                        {hub.badge}
                      </Badge>
                      <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground" />
                    </div>
                  </a>
                ))
              )}

              {brand?.phone && (
                <div className="p-3 rounded-xl bg-muted/40 text-center mt-2">
                  <p className="text-[11px] text-muted-foreground">Worldwide NOC (24/7 Helpline)</p>
                  <p className="text-sm font-bold text-primary mt-0.5 font-mono">{brand.phone}</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

export default function DashboardPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-[60vh] flex items-center justify-center">
          <RefreshCw className="h-6 w-6 animate-spin text-primary" />
        </div>
      }
    >
      <DashboardContent />
    </Suspense>
  )
}
