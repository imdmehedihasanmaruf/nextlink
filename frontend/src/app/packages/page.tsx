'use client'

import React, { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { 
  Download, 
  Upload, 
  CheckCircle2, 
  ArrowRight, 
  Wifi, 
  ShieldCheck, 
  Zap, 
  Headphones, 
  Layers,
  Sparkles,
  Gamepad2,
  Tv,
  Globe2,
  Server,
  Building2,
  Check,
  Minus,
  HelpCircle,
  Cpu,
  Info,
  ShieldAlert,
  Network,
  Radio,
  Lock,
  RefreshCw,
  CreditCard
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useTranslation } from '@/store/settingsStore'
import { useContentStore, PackageItem, PackageCategory } from '@/store/contentStore'
import { useAuthStore } from '@/store/authStore'
import { fetchLiveTelemetry, fetchMySummary, PortalSummary } from '@/lib/portalApi'

export default function PackagesPage() {
  const router = useRouter()
  const { t, language } = useTranslation()
  const { isAuthenticated, user, updateUser } = useAuthStore()
  const { packages, packagesSection, fetchContent } = useContentStore()

  const [activeCategory, setActiveCategory] = useState<'All' | PackageCategory>('All')
  const [telemetrySubscriber, setTelemetrySubscriber] = useState<any>(null)
  const [portalSummary, setPortalSummary] = useState<PortalSummary | null>(null)
  const [loadingSubscription, setLoadingSubscription] = useState<boolean>(true)
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null)
  const [userHasSelectedManually, setUserHasSelectedManually] = useState<boolean>(false)

  useEffect(() => {
    fetchContent()
  }, [fetchContent])

  // Real-time synchronization of authoritative subscriber active package & cancellation status
  useEffect(() => {
    if (!isAuthenticated) {
      setLoadingSubscription(false)
      return
    }

    let isMounted = true

    const syncTelemetry = async () => {
      try {
        const [res, summaryRes] = await Promise.all([
          fetchLiveTelemetry(),
          fetchMySummary(),
        ])
        if (!isMounted) return
        if (summaryRes.success && summaryRes.summary) {
          setPortalSummary(summaryRes.summary)
        }
        if (res.success && res.telemetry?.subscriber) {
          const sub = res.telemetry.subscriber
          setTelemetrySubscriber(sub)

          // Sync into authStore if different so all navbar/profile displays stay fresh
          const updates: Record<string, any> = {}
          if (sub.packageId && sub.packageId !== user?.packageId) {
            updates.packageId = sub.packageId
            updates.packageName = sub.packageName
            updates.package = sub.packageName
          }
          if (sub.status && sub.status !== user?.status) {
            updates.status = sub.status
          }
          if (Object.keys(updates).length > 0) {
            updateUser(updates)
          }
        }
      } catch (err) {
        console.warn('Real-time subscription sync error:', err)
      } finally {
        if (isMounted) {
          setLoadingSubscription(false)
        }
      }
    }

    syncTelemetry()

    // 3.5s real-time polling so admin upgrades or user cancellations reflect immediately without hard reload
    const pollInterval = setInterval(syncTelemetry, 3500)

    // Immediate sync when browser window/tab becomes active
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        syncTelemetry()
      }
    }
    window.addEventListener('focus', handleVisibility)
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      isMounted = false
      clearInterval(pollInterval)
      window.removeEventListener('focus', handleVisibility)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [isAuthenticated, user?.packageId, user?.status, updateUser])

  // Determine authoritative active plan status
  const isCancelled = Boolean(
    telemetrySubscriber?.status === 'cancelled' ||
    user?.status === 'cancelled' ||
    user?.subscriptionCancelledAt
  )

  const isActiveSubscriber = Boolean(
    isAuthenticated &&
    !isCancelled &&
    (
      telemetrySubscriber?.status === 'active' ||
      telemetrySubscriber?.status === 'suspended' ||
      user?.status === 'active' ||
      user?.status === 'suspended'
    )
  )

  const activePackageId = isActiveSubscriber
    ? (telemetrySubscriber?.packageId || user?.packageId || null)
    : null

  // Locate the subscriber's current package details by authoritative packageId (never by array index or name)
  const currentPackage = useMemo(() => {
    if (!activePackageId || !packages || packages.length === 0) return null
    return packages.find(
      (p) => (p.id || '').trim().toLowerCase() === activePackageId.trim().toLowerCase()
    ) || null
  }, [activePackageId, packages])

  const currentSpeed = currentPackage ? currentPackage.speed : (telemetrySubscriber?.speedMbps || 0)
  const currentPrice = currentPackage ? currentPackage.price : (telemetrySubscriber?.price || 0)

  // Default selection to the active package once resolved, unless the visitor already clicked another card
  useEffect(() => {
    if (!userHasSelectedManually && activePackageId) {
      setSelectedCardId(activePackageId)
    }
  }, [activePackageId, userHasSelectedManually])

  const handleSelectPackage = (pkg: PackageItem) => {
    if (!isAuthenticated) {
      router.push(`/login?redirect=${encodeURIComponent(`/dashboard/purchase?package=${pkg.id}`)}&reason=existing_customer_only`)
    } else {
      router.push(`/dashboard/purchase?package=${pkg.id}`)
    }
  }

  // Resilient category resolver to ensure categories NEVER show (0)
  const getPackageCategory = (pkg: PackageItem): PackageCategory => {
    if (pkg.category) return pkg.category
    const name = (pkg.name || '').toLowerCase()
    if (name.includes('ultra') || name.includes('multi-gig')) return 'Advanced Internet'
    if (name.includes('business') || name.includes('enterprise')) return 'Business Internet'
    return 'Home Internet'
  }

  // Filtered packages by category
  const filteredPackages = useMemo(() => {
    if (!packages || packages.length === 0) return []
    if (activeCategory === 'All') return packages
    return packages.filter(p => getPackageCategory(p) === activeCategory)
  }, [packages, activeCategory])

  // Count by category
  const categoryCounts = useMemo(() => {
    const total = packages?.length || 0
    let home = 0
    let adv = 0
    let biz = 0

    packages?.forEach(p => {
      const cat = getPackageCategory(p)
      if (cat === 'Home Internet') home++
      else if (cat === 'Advanced Internet') adv++
      else if (cat === 'Business Internet') biz++
    })

    return { total, home, adv, biz }
  }, [packages])

  // Helper for speed formatting
  const formatSpeed = (speed: number) => {
    if (speed >= 1000) {
      return `${speed / 1000} Gbps`
    }
    return `${speed} Mbps`
  }

  return (
    <div className="min-h-screen bg-background">
      {/* ─────────────────────────────────────────────────────────────
          1. Hero Section
      ───────────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden border-b border-border/60 bg-gradient-to-b from-primary/[0.04] via-background to-background py-16 md:py-24">
        <div className="container mx-auto px-4 max-w-6xl relative z-10 text-center space-y-5">
          <Badge 
            variant="outline" 
            className="px-4 py-1.5 text-xs font-semibold text-primary border-primary/30 bg-primary/5 rounded-full inline-flex items-center gap-1.5"
          >
            <Sparkles className="h-3.5 w-3.5" />
            <span>{packagesSection?.badgeEn || 'NextLink – Global Internet Plans'}</span>
          </Badge>

          <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-black tracking-tight text-foreground">
            {packagesSection?.titleEn || (
              <>Ultra-Fast Symmetrical <span className="text-primary">Optical Fiber</span></>
            )}
          </h1>

          <p className="text-muted-foreground text-sm sm:text-base md:text-lg max-w-3xl mx-auto leading-relaxed">
            {packagesSection?.subtitleEn || 'International-standard high-speed plans featuring 100% symmetrical upload/download speeds, ultra-low ping for competitive esports, bufferless 4K/8K streaming, and business-grade reliability.'}
          </p>

          <div className="inline-block p-2 rounded-xl bg-muted/60 border border-border/80 text-xs text-muted-foreground max-w-2xl mx-auto">
            <span className="font-semibold text-foreground">Proposed international-style pricing:</span> USD per month · Illustrative standard global tiers.
          </div>

          {/* Category Tabs */}
          <div className="pt-6 flex flex-wrap items-center justify-center gap-2">
            <Button
              variant={activeCategory === 'All' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setActiveCategory('All')}
              className="rounded-full px-5 font-semibold text-xs h-9 shadow-sm"
            >
              All Plans ({categoryCounts.total})
            </Button>

            <Button
              variant={activeCategory === 'Home Internet' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setActiveCategory('Home Internet')}
              className="rounded-full px-5 font-semibold text-xs h-9 shadow-sm"
            >
              1. Home Internet ({categoryCounts.home})
            </Button>

            <Button
              variant={activeCategory === 'Advanced Internet' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setActiveCategory('Advanced Internet')}
              className="rounded-full px-5 font-semibold text-xs h-9 shadow-sm"
            >
              2. Advanced Internet ({categoryCounts.adv})
            </Button>

            <Button
              variant={activeCategory === 'Business Internet' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setActiveCategory('Business Internet')}
              className="rounded-full px-5 font-semibold text-xs h-9 shadow-sm"
            >
              3. Business Internet ({categoryCounts.biz})
            </Button>
          </div>
        </div>
      </section>

      {/* ─────────────────────────────────────────────────────────────
          2. Highlights Grid
      ───────────────────────────────────────────────────────────── */}
      <section className="container mx-auto px-4 max-w-6xl -mt-8 relative z-20">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="p-4 rounded-2xl bg-card border border-border shadow-sm text-center space-y-1">
            <div className="h-9 w-9 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto mb-1.5">
              <Zap size={18} />
            </div>
            <h4 className="font-bold text-sm text-foreground">Symmetrical Speed</h4>
            <p className="text-[11px] text-muted-foreground">Equal upload & download rates</p>
          </div>

          <div className="p-4 rounded-2xl bg-card border border-border shadow-sm text-center space-y-1">
            <div className="h-9 w-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center mx-auto mb-1.5">
              <Gamepad2 size={18} />
            </div>
            <h4 className="font-bold text-sm text-foreground">Gaming Low Latency</h4>
            <p className="text-[11px] text-muted-foreground">Sub-millisecond fastpath routing</p>
          </div>

          <div className="p-4 rounded-2xl bg-card border border-border shadow-sm text-center space-y-1">
            <div className="h-9 w-9 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center mx-auto mb-1.5">
              <Tv size={18} />
            </div>
            <h4 className="font-bold text-sm text-foreground">4K / 8K Streaming</h4>
            <p className="text-[11px] text-muted-foreground">Zero buffer, multi-stream capacity</p>
          </div>

          <div className="p-4 rounded-2xl bg-card border border-border shadow-sm text-center space-y-1">
            <div className="h-9 w-9 rounded-xl bg-purple-500/10 text-purple-600 dark:text-purple-400 flex items-center justify-center mx-auto mb-1.5">
              <Server size={18} />
            </div>
            <h4 className="font-bold text-sm text-foreground">Dedicated Business SLA</h4>
            <p className="text-[11px] text-muted-foreground">Carrier-grade fiber up to 5 Gbps</p>
          </div>
        </div>
      </section>

      {/* ─────────────────────────────────────────────────────────────
          3. Packages Card Grid
      ───────────────────────────────────────────────────────────── */}
      <section className="container mx-auto px-4 max-w-6xl py-12 md:py-16 space-y-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b pb-4">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-foreground">
              {activeCategory === 'All' ? 'All Global Fiber Packages' : activeCategory}
            </h2>
            <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
              {activeCategory === 'Home Internet' && 'From Essential to Gigabit — Engineered for residential, remote workers, family streaming, and smart homes.'}
              {activeCategory === 'Advanced Internet' && 'Ultra & Multi-Gig — High-throughput symmetrical tiers for esports gaming, pro studios, and content creators.'}
              {activeCategory === 'Business Internet' && 'Business Pro — Dedicated 1:1 CIR connectivity with enterprise SLA.'}
              {activeCategory === 'All' && 'Choose your symmetrical optical speed from 100 Mbps up to 5 Gbps.'}
            </p>
          </div>
          <span className="text-xs font-mono text-muted-foreground self-start sm:self-center">
            Showing {filteredPackages.length} packages
          </span>
        </div>

        {/* Existing Customer Only Notice */}
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-primary/15 text-primary flex items-center justify-center shrink-0">
              <ShieldAlert className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-foreground">
                Existing Subscriber-Only Plans & Upgrades
              </h3>
              <p className="text-xs text-muted-foreground">
                In accordance with carrier policy, new plan selections, bandwidth upgrades, and extra connections require an active NextLink subscriber account.
              </p>
            </div>
          </div>
          {!isAuthenticated ? (
            <Button
              size="sm"
              onClick={() => router.push('/login?redirect=/packages')}
              className="font-semibold text-xs shrink-0"
            >
              <Lock className="h-3.5 w-3.5 mr-1.5" />
              Subscriber Sign In
            </Button>
          ) : (
            <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 text-xs py-1 px-3">
              <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
              Customer Verified
            </Badge>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {filteredPackages.map((pkg) => {
            const isMultiGigOrBiz = pkg.speed >= 2000
            const isPopular = !!pkg.popular
            const category = getPackageCategory(pkg)

            // Strict ID matching (never match by package name or array index)
            const isCurrentPlan = Boolean(
              activePackageId &&
              (pkg.id || '').trim().toLowerCase() === activePackageId.trim().toLowerCase()
            )

            // Selection state: defaults to current plan on load, or the card user explicitly clicked
            const isSelected = selectedCardId
              ? (pkg.id || '').trim().toLowerCase() === selectedCardId.trim().toLowerCase()
              : isCurrentPlan

            // Tier comparison relative to subscriber's current plan
            const isHigherTier = Boolean(
              activePackageId &&
              !isCurrentPlan &&
              (pkg.speed > currentSpeed || (pkg.speed === currentSpeed && pkg.price > currentPrice))
            )
            const isLowerTier = Boolean(
              activePackageId &&
              !isCurrentPlan &&
              (pkg.speed < currentSpeed || (pkg.speed === currentSpeed && pkg.price < currentPrice))
            )

            return (
              <Card 
                key={pkg.id} 
                onClick={() => {
                  setSelectedCardId(pkg.id)
                  setUserHasSelectedManually(true)
                }}
                aria-current={isCurrentPlan ? 'true' : undefined}
                className={`relative flex flex-col justify-between border-2 transition-all duration-300 hover:shadow-xl hover:-translate-y-1.5 cursor-pointer ${
                  isCurrentPlan
                    ? 'border-emerald-500 ring-2 ring-emerald-500/25 bg-emerald-500/[0.03] dark:bg-emerald-950/20 shadow-md'
                    : isSelected
                    ? 'border-primary ring-2 ring-primary/25 bg-primary/[0.02] shadow-md'
                    : isPopular 
                    ? 'border-primary ring-1 ring-primary/20 bg-primary/[0.01]' 
                    : isMultiGigOrBiz
                    ? 'border-purple-500/40 bg-purple-500/[0.01]'
                    : 'border-border hover:border-primary/50'
                }`}
              >
                {/* 1. "Your Current Plan" Badge or Popular / Feature Badge */}
                {isCurrentPlan ? (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 z-20">
                    <Badge 
                      data-testid="current-plan-badge"
                      className="bg-emerald-600 hover:bg-emerald-600 text-white dark:bg-emerald-500 font-bold px-3 py-1 text-xs shadow-md flex items-center gap-1.5 border border-emerald-400"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      <span>Your Current Plan</span>
                    </Badge>
                  </div>
                ) : isPopular ? (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 z-10">
                    <Badge className="bg-primary text-primary-foreground font-bold px-3 py-0.5 text-[11px] shadow">
                      MOST POPULAR
                    </Badge>
                  </div>
                ) : pkg.badge ? (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 z-10">
                    <Badge variant="secondary" className="font-bold px-2.5 py-0.5 text-[10px] border shadow-xs">
                      {pkg.badge}
                    </Badge>
                  </div>
                ) : null}

                <CardHeader className="pt-6 pb-3">
                  <div className="flex items-center justify-between text-xs mb-1">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono font-semibold text-muted-foreground">{pkg.id}</span>
                      {isSelected && !isCurrentPlan && (
                        <Badge variant="outline" className="text-[9px] font-bold text-primary border-primary/40 px-1.5 py-0">
                          Selected
                        </Badge>
                      )}
                    </div>
                    <Badge variant="outline" className="text-[10px] font-medium border-border">
                      {category}
                    </Badge>
                  </div>

                  <CardTitle className="text-xl font-bold text-foreground">
                    {pkg.name}
                  </CardTitle>

                  {/* Target Customer */}
                  <div className="mt-1">
                    <span className="text-[11px] font-medium text-primary bg-primary/10 px-2 py-0.5 rounded-md inline-block">
                      {pkg.targetCustomer || 'General Users'}
                    </span>
                  </div>

                  {/* Pricing */}
                  <div className="mt-3 flex items-baseline">
                    <span className="text-3xl font-black text-foreground">
                      ${pkg.price.toFixed(2)}
                    </span>
                    <span className="text-xs text-muted-foreground ml-1.5 font-medium">/ month</span>
                  </div>
                </CardHeader>

                <CardContent className="space-y-4 pt-1 flex-1 flex flex-col justify-between">
                  <div>
                    {/* Speed Box */}
                    <div className="rounded-xl bg-muted/60 p-3 border border-border/70 space-y-1 mb-3">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground flex items-center gap-1 font-medium">
                          <Download className="h-3.5 w-3.5 text-emerald-500" />
                          Download
                        </span>
                        <span className="font-bold text-foreground font-mono">
                          {formatSpeed(pkg.speed)}
                        </span>
                      </div>

                      <div className="flex items-center justify-between text-xs pt-1 border-t border-border/50">
                        <span className="text-muted-foreground flex items-center gap-1 font-medium">
                          <Upload className="h-3.5 w-3.5 text-blue-500" />
                          Upload
                        </span>
                        <span className="font-bold text-foreground font-mono">
                          {formatSpeed(pkg.uploadSpeed || pkg.speed)}
                        </span>
                      </div>
                      
                      <p className="text-[10px] text-center text-emerald-600 dark:text-emerald-400 font-semibold pt-1">
                        100% Symmetrical Optical Fiber
                      </p>
                    </div>

                    {/* Features list */}
                    <ul className="space-y-2 text-xs py-1">
                      {pkg.features?.slice(0, 8).map((feat, i) => (
                        <li key={i} className="flex items-start gap-2 text-foreground/90">
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0 mt-0.5" />
                          <span className="leading-tight">{feat}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Select / Action Button */}
                  <div className="pt-3 border-t space-y-1.5">
                    {loadingSubscription ? (
                      <Button disabled className="w-full h-10 text-xs font-semibold opacity-70">
                        <RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                        <span>Verifying plan...</span>
                      </Button>
                    ) : isCurrentPlan ? (
                      portalSummary?.isCurrentPeriodPaid ? (
                        <Button 
                          disabled
                          aria-disabled="true"
                          data-testid="current-plan-paid-btn"
                          className="w-full font-bold shadow-sm h-10 text-xs gap-1.5 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 cursor-not-allowed hover:bg-emerald-500/10"
                        >
                          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                          <span>Paid – Next due {portalSummary.nextDueDate || 'next cycle'}</span>
                        </Button>
                      ) : (
                        <Button 
                          onClick={(e) => {
                            e.stopPropagation()
                            router.push(`/dashboard/purchase?package=${encodeURIComponent(pkg.id)}&type=RENEWAL`)
                          }}
                          data-testid="pay-monthly-bill-btn"
                          className="w-full font-bold shadow-sm h-10 text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer"
                        >
                          <CreditCard size={14} />
                          <span>Pay Monthly Bill</span>
                          <ArrowRight size={14} />
                        </Button>
                      )
                    ) : isAuthenticated && activePackageId ? (
                      <Button 
                        onClick={(e) => {
                          e.stopPropagation()
                          handleSelectPackage(pkg)
                        }}
                        className="w-full font-bold shadow-sm h-10 text-xs gap-1.5" 
                        variant={isHigherTier ? 'default' : 'outline'}
                      >
                        <span>
                          {isHigherTier ? 'Upgrade' : isLowerTier ? 'Downgrade' : 'Switch Plan'}
                        </span>
                        <ArrowRight size={14} />
                      </Button>
                    ) : isAuthenticated ? (
                      <Button 
                        onClick={(e) => {
                          e.stopPropagation()
                          handleSelectPackage(pkg)
                        }}
                        className="w-full font-bold shadow-sm h-10 text-xs gap-1.5" 
                        variant={isPopular ? 'default' : 'outline'}
                      >
                        <span>Choose {pkg.name}</span>
                        <ArrowRight size={14} />
                      </Button>
                    ) : (
                      <div className="space-y-1.5">
                        <Button 
                          onClick={(e) => {
                            e.stopPropagation()
                            handleSelectPackage(pkg)
                          }}
                          className="w-full font-bold shadow-sm h-10 text-xs gap-1.5" 
                          variant={isPopular ? 'default' : 'outline'}
                        >
                          <Lock className="h-3.5 w-3.5" />
                          <span>Sign In to Purchase</span>
                        </Button>
                        <Link
                          href={`/apply?package=${pkg.id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="block text-center text-[11px] font-semibold text-primary hover:underline py-0.5"
                        >
                          New to NextLink? Apply with this plan →
                        </Link>
                      </div>
                    )}
                    {isCurrentPlan && (
                      <p className={`text-[10px] text-center font-semibold ${portalSummary?.isCurrentPeriodPaid ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
                        {portalSummary?.isCurrentPeriodPaid
                          ? `Active · Paid for ${portalSummary.paidMonthYear || 'current cycle'}`
                          : 'Active · Monthly bill renewal due'}
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      </section>

      {/* ─────────────────────────────────────────────────────────────
          4. Global Package Features Matrix Table (11 Original + 6 New Quality Features = 17 Total)
      ───────────────────────────────────────────────────────────── */}
      <section className="container mx-auto px-4 max-w-6xl py-12 border-t">
        <div className="text-center max-w-3xl mx-auto space-y-3 mb-10">
          <Badge variant="outline" className="px-3 py-1 text-xs font-semibold text-primary">
            Feature Comparison Matrix
          </Badge>
          <h2 className="text-2xl sm:text-3xl font-black tracking-tight text-foreground">
            Global Package Features Matrix
          </h2>
          <p className="text-xs sm:text-sm text-muted-foreground">
            Side-by-side comparison of technical capabilities, network priorities, IPv6, static IP, DDoS mitigation, and enterprise SLAs.
          </p>
        </div>

        <div className="overflow-x-auto rounded-2xl border bg-card shadow-sm">
          <table className="w-full text-xs text-left border-collapse min-w-[900px]">
            <thead className="bg-muted/70 text-foreground font-semibold border-b">
              <tr>
                <th className="py-3 px-4 text-sm font-bold">Features</th>
                <th className="py-3 px-2 text-center">Essential<br/><span className="text-[10px] text-muted-foreground font-normal">100M</span></th>
                <th className="py-3 px-2 text-center">Standard<br/><span className="text-[10px] text-muted-foreground font-normal">200M</span></th>
                <th className="py-3 px-2 text-center">Advanced<br/><span className="text-[10px] text-muted-foreground font-normal">300M</span></th>
                <th className="py-3 px-2 text-center bg-primary/5 text-primary">Premium<br/><span className="text-[10px] font-normal">500M</span></th>
                <th className="py-3 px-2 text-center">Ultra<br/><span className="text-[10px] text-muted-foreground font-normal">750M</span></th>
                <th className="py-3 px-2 text-center">Gigabit<br/><span className="text-[10px] text-muted-foreground font-normal">1 Gbps</span></th>
                <th className="py-3 px-2 text-center">Multi-Gig<br/><span className="text-[10px] text-muted-foreground font-normal">2 Gbps</span></th>
                <th className="py-3 px-2 text-center font-bold text-foreground">Business Pro<br/><span className="text-[10px] text-muted-foreground font-normal">5 Gbps</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {/* Category Divider: Core Features */}
              <tr className="bg-muted/30">
                <td colSpan={9} className="py-2 px-4 font-bold text-xs uppercase tracking-wider text-primary">
                  1. Core Connectivity & Architecture
                </td>
              </tr>

              {/* 1. Unlimited Data */}
              <tr className="hover:bg-muted/30">
                <td className="py-2.5 px-4 font-medium text-foreground">Unlimited Data</td>
                <td className="text-center py-2.5 px-2 text-emerald-600 font-bold">✓</td>
                <td className="text-center py-2.5 px-2 text-emerald-600 font-bold">✓</td>
                <td className="text-center py-2.5 px-2 text-emerald-600 font-bold">✓</td>
                <td className="text-center py-2.5 px-2 text-emerald-600 font-bold bg-primary/5">✓</td>
                <td className="text-center py-2.5 px-2 text-emerald-600 font-bold">✓</td>
                <td className="text-center py-2.5 px-2 text-emerald-600 font-bold">✓</td>
                <td className="text-center py-2.5 px-2 text-emerald-600 font-bold">✓</td>
                <td className="text-center py-2.5 px-2 text-emerald-600 font-bold">✓</td>
              </tr>

              {/* 2. Symmetrical Speed */}
              <tr className="hover:bg-muted/30">
                <td className="py-2.5 px-4 font-medium text-foreground">Symmetrical Speed</td>
                <td className="text-center py-2.5 px-2 text-emerald-600 font-bold">✓</td>
                <td className="text-center py-2.5 px-2 text-emerald-600 font-bold">✓</td>
                <td className="text-center py-2.5 px-2 text-emerald-600 font-bold">✓</td>
                <td className="text-center py-2.5 px-2 text-emerald-600 font-bold bg-primary/5">✓</td>
                <td className="text-center py-2.5 px-2 text-emerald-600 font-bold">✓</td>
                <td className="text-center py-2.5 px-2 text-emerald-600 font-bold">✓</td>
                <td className="text-center py-2.5 px-2 text-emerald-600 font-bold">✓</td>
                <td className="text-center py-2.5 px-2 text-emerald-600 font-bold">✓</td>
              </tr>

              {/* 3. Fiber Connection */}
              <tr className="hover:bg-muted/30">
                <td className="py-2.5 px-4 font-medium text-foreground">Fiber Connection</td>
                <td className="text-center py-2.5 px-2 text-emerald-600 font-bold">✓</td>
                <td className="text-center py-2.5 px-2 text-emerald-600 font-bold">✓</td>
                <td className="text-center py-2.5 px-2 text-emerald-600 font-bold">✓</td>
                <td className="text-center py-2.5 px-2 text-emerald-600 font-bold bg-primary/5">✓</td>
                <td className="text-center py-2.5 px-2 text-emerald-600 font-bold">✓</td>
                <td className="text-center py-2.5 px-2 text-emerald-600 font-bold">✓</td>
                <td className="text-center py-2.5 px-2 text-emerald-600 font-bold">✓</td>
                <td className="text-center py-2.5 px-2 text-emerald-600 font-bold">✓</td>
              </tr>

              {/* 4. IPv6 Support */}
              <tr className="hover:bg-muted/30">
                <td className="py-2.5 px-4 font-medium text-foreground">IPv6 Support</td>
                <td className="text-center py-2.5 px-2 text-muted-foreground">—</td>
                <td className="text-center py-2.5 px-2 text-muted-foreground">—</td>
                <td className="text-center py-2.5 px-2 text-emerald-600 font-bold">✓</td>
                <td className="text-center py-2.5 px-2 text-emerald-600 font-bold bg-primary/5">✓</td>
                <td className="text-center py-2.5 px-2 text-emerald-600 font-bold">✓</td>
                <td className="text-center py-2.5 px-2 text-emerald-600 font-bold">✓</td>
                <td className="text-center py-2.5 px-2 text-emerald-600 font-bold">✓</td>
                <td className="text-center py-2.5 px-2 text-emerald-600 font-bold">✓</td>
              </tr>

              {/* Category Divider: Performance & Media Engine */}
              <tr className="bg-muted/30">
                <td colSpan={9} className="py-2 px-4 font-bold text-xs uppercase tracking-wider text-primary">
                  2. Performance, Routing & Media Optimization
                </td>
              </tr>

              {/* 5. Gaming Optimized */}
              <tr className="hover:bg-muted/30">
                <td className="py-2.5 px-4 font-medium text-foreground">Gaming Optimized</td>
                <td className="text-center py-2.5 px-2 text-muted-foreground">—</td>
                <td className="text-center py-2.5 px-2 text-muted-foreground">—</td>
                <td className="text-center py-2.5 px-2 text-muted-foreground">—</td>
                <td className="text-center py-2.5 px-2 text-emerald-600 font-bold bg-primary/5">✓</td>
                <td className="text-center py-2.5 px-2 text-emerald-600 font-bold">✓</td>
                <td className="text-center py-2.5 px-2 text-emerald-600 font-bold">✓</td>
                <td className="text-center py-2.5 px-2 text-emerald-600 font-bold">✓</td>
                <td className="text-center py-2.5 px-2 text-emerald-600 font-bold">✓</td>
              </tr>

              {/* 6. 4K / 8K Streaming */}
              <tr className="hover:bg-muted/30">
                <td className="py-2.5 px-4 font-medium text-foreground">4K / 8K Streaming</td>
                <td className="text-center py-2.5 px-2 text-muted-foreground">—</td>
                <td className="text-center py-2.5 px-2 text-muted-foreground">—</td>
                <td className="text-center py-2.5 px-2 text-muted-foreground">—</td>
                <td className="text-center py-2.5 px-2 text-muted-foreground bg-primary/5">—</td>
                <td className="text-center py-2.5 px-2 text-emerald-600 font-bold">✓</td>
                <td className="text-center py-2.5 px-2 text-emerald-600 font-bold">✓</td>
                <td className="text-center py-2.5 px-2 text-emerald-600 font-bold">✓</td>
                <td className="text-center py-2.5 px-2 text-emerald-600 font-bold">✓</td>
              </tr>

              {/* 7. [NEW Quality Feature 1] Sub-5ms Low Latency / FastPath Routing */}
              <tr className="hover:bg-muted/30">
                <td className="py-2.5 px-4 font-medium text-foreground flex items-center gap-1.5">
                  <Radio className="h-3.5 w-3.5 text-primary" />
                  <span>Sub-5ms Low Latency / FastPath</span>
                </td>
                <td className="text-center py-2.5 px-2 text-muted-foreground">—</td>
                <td className="text-center py-2.5 px-2 text-muted-foreground">—</td>
                <td className="text-center py-2.5 px-2 text-muted-foreground">—</td>
                <td className="text-center py-2.5 px-2 text-emerald-600 font-bold bg-primary/5">✓</td>
                <td className="text-center py-2.5 px-2 text-emerald-600 font-bold">✓</td>
                <td className="text-center py-2.5 px-2 text-emerald-600 font-bold">✓</td>
                <td className="text-center py-2.5 px-2 text-emerald-600 font-bold">✓</td>
                <td className="text-center py-2.5 px-2 text-emerald-600 font-bold">✓</td>
              </tr>

              {/* 8. [NEW Quality Feature 2] Direct Tier-1 Cloud & CDN Peering */}
              <tr className="hover:bg-muted/30">
                <td className="py-2.5 px-4 font-medium text-foreground flex items-center gap-1.5">
                  <Network className="h-3.5 w-3.5 text-blue-500" />
                  <span>Direct Tier-1 CDN Peering (AWS/Google/Steam)</span>
                </td>
                <td className="text-center py-2.5 px-2 text-muted-foreground">—</td>
                <td className="text-center py-2.5 px-2 text-muted-foreground">—</td>
                <td className="text-center py-2.5 px-2 text-muted-foreground">—</td>
                <td className="text-center py-2.5 px-2 text-muted-foreground bg-primary/5">—</td>
                <td className="text-center py-2.5 px-2 text-emerald-600 font-bold">✓</td>
                <td className="text-center py-2.5 px-2 text-emerald-600 font-bold">✓</td>
                <td className="text-center py-2.5 px-2 text-emerald-600 font-bold">✓</td>
                <td className="text-center py-2.5 px-2 text-emerald-600 font-bold">✓</td>
              </tr>

              {/* Category Divider: IP Addressing & Hardware Specs */}
              <tr className="bg-muted/30">
                <td colSpan={9} className="py-2 px-4 font-bold text-xs uppercase tracking-wider text-primary">
                  3. IP Addressing, Equipment & Hardware
                </td>
              </tr>

              {/* 9. Static IP */}
              <tr className="hover:bg-muted/30">
                <td className="py-2.5 px-4 font-medium text-foreground">Static IP</td>
                <td className="text-center py-2.5 px-2 text-amber-600 dark:text-amber-400 font-medium">Add-on</td>
                <td className="text-center py-2.5 px-2 text-amber-600 dark:text-amber-400 font-medium">Add-on</td>
                <td className="text-center py-2.5 px-2 text-amber-600 dark:text-amber-400 font-medium">Add-on</td>
                <td className="text-center py-2.5 px-2 text-amber-600 dark:text-amber-400 font-medium bg-primary/5">Add-on</td>
                <td className="text-center py-2.5 px-2 text-amber-600 dark:text-amber-400 font-medium">Add-on</td>
                <td className="text-center py-2.5 px-2 text-amber-600 dark:text-amber-400 font-medium">Add-on</td>
                <td className="text-center py-2.5 px-2 text-emerald-600 font-bold">Included</td>
                <td className="text-center py-2.5 px-2 text-emerald-600 font-bold">Included</td>
              </tr>

              {/* 10. [NEW Quality Feature 3] Customer Equipment / Optical Hardware */}
              <tr className="hover:bg-muted/30">
                <td className="py-2.5 px-4 font-medium text-foreground flex items-center gap-1.5">
                  <Cpu className="h-3.5 w-3.5 text-purple-500" />
                  <span>Optical Equipment / Router Grade</span>
                </td>
                <td className="text-center py-2.5 px-1 text-[11px] text-muted-foreground">Gigabit ONU</td>
                <td className="text-center py-2.5 px-1 text-[11px] text-muted-foreground">Wi-Fi 6 ONU</td>
                <td className="text-center py-2.5 px-1 text-[11px] text-muted-foreground">Wi-Fi 6 ONU</td>
                <td className="text-center py-2.5 px-1 text-[11px] font-medium text-foreground bg-primary/5">Wi-Fi 6 Mesh</td>
                <td className="text-center py-2.5 px-1 text-[11px] font-medium text-foreground">Esports Router</td>
                <td className="text-center py-2.5 px-1 text-[11px] font-medium text-foreground">Wi-Fi 6E Tri-Band</td>
                <td className="text-center py-2.5 px-1 text-[11px] font-bold text-purple-600 dark:text-purple-400">2.5G Port ONU</td>
                <td className="text-center py-2.5 px-1 text-[11px] font-bold text-emerald-600">10G SFP+ ONU</td>
              </tr>

              {/* Category Divider: Security, SLA & Enterprise Capabilities */}
              <tr className="bg-muted/30">
                <td colSpan={9} className="py-2 px-4 font-bold text-xs uppercase tracking-wider text-primary">
                  4. Security, SLA & Enterprise Capabilities
                </td>
              </tr>

              {/* 11. Priority Support */}
              <tr className="hover:bg-muted/30">
                <td className="py-2.5 px-4 font-medium text-foreground">Priority Support</td>
                <td className="text-center py-2.5 px-2 text-muted-foreground">—</td>
                <td className="text-center py-2.5 px-2 text-muted-foreground">—</td>
                <td className="text-center py-2.5 px-2 text-muted-foreground">—</td>
                <td className="text-center py-2.5 px-2 text-muted-foreground bg-primary/5">—</td>
                <td className="text-center py-2.5 px-2 text-muted-foreground">—</td>
                <td className="text-center py-2.5 px-2 text-emerald-600 font-bold">✓</td>
                <td className="text-center py-2.5 px-2 text-emerald-600 font-bold">✓</td>
                <td className="text-center py-2.5 px-2 text-emerald-600 font-bold">✓</td>
              </tr>

              {/* 12. 24/7 Support */}
              <tr className="hover:bg-muted/30">
                <td className="py-2.5 px-4 font-medium text-foreground">24/7 Support</td>
                <td className="text-center py-2.5 px-2 text-muted-foreground">—</td>
                <td className="text-center py-2.5 px-2 text-muted-foreground">—</td>
                <td className="text-center py-2.5 px-2 text-muted-foreground">—</td>
                <td className="text-center py-2.5 px-2 text-emerald-600 font-bold bg-primary/5">✓</td>
                <td className="text-center py-2.5 px-2 text-emerald-600 font-bold">✓</td>
                <td className="text-center py-2.5 px-2 text-emerald-600 font-bold">✓</td>
                <td className="text-center py-2.5 px-2 text-emerald-600 font-bold">✓</td>
                <td className="text-center py-2.5 px-2 text-emerald-600 font-bold">✓</td>
              </tr>

              {/* 13. [NEW Quality Feature 4] Advanced Anti-DDoS Protection Shield */}
              <tr className="hover:bg-muted/30">
                <td className="py-2.5 px-4 font-medium text-foreground flex items-center gap-1.5">
                  <ShieldAlert className="h-3.5 w-3.5 text-rose-500" />
                  <span>Advanced DDoS Mitigation Shield</span>
                </td>
                <td className="text-center py-2.5 px-2 text-muted-foreground">Basic</td>
                <td className="text-center py-2.5 px-2 text-muted-foreground">Basic</td>
                <td className="text-center py-2.5 px-2 text-muted-foreground">Basic</td>
                <td className="text-center py-2.5 px-2 text-amber-600 dark:text-amber-400 font-medium bg-primary/5">Medium</td>
                <td className="text-center py-2.5 px-2 text-amber-600 dark:text-amber-400 font-medium">Medium</td>
                <td className="text-center py-2.5 px-2 text-amber-600 dark:text-amber-400 font-medium">Medium</td>
                <td className="text-center py-2.5 px-2 text-emerald-600 font-bold">✓ (Clean Pipe)</td>
                <td className="text-center py-2.5 px-2 text-emerald-600 font-bold">✓ (Multi-Tbps)</td>
              </tr>

              {/* 14. Dedicated Bandwidth Option */}
              <tr className="hover:bg-muted/30">
                <td className="py-2.5 px-4 font-medium text-foreground">Dedicated Bandwidth Option</td>
                <td className="text-center py-2.5 px-2 text-muted-foreground">—</td>
                <td className="text-center py-2.5 px-2 text-muted-foreground">—</td>
                <td className="text-center py-2.5 px-2 text-muted-foreground">—</td>
                <td className="text-center py-2.5 px-2 text-muted-foreground bg-primary/5">—</td>
                <td className="text-center py-2.5 px-2 text-muted-foreground">—</td>
                <td className="text-center py-2.5 px-2 text-muted-foreground">—</td>
                <td className="text-center py-2.5 px-2 text-amber-600 dark:text-amber-400 font-medium">Add-on</td>
                <td className="text-center py-2.5 px-2 text-emerald-600 font-bold">✓</td>
              </tr>

              {/* 15. Business SLA */}
              <tr className="hover:bg-muted/30">
                <td className="py-2.5 px-4 font-medium text-foreground">Business SLA</td>
                <td className="text-center py-2.5 px-2 text-muted-foreground">—</td>
                <td className="text-center py-2.5 px-2 text-muted-foreground">—</td>
                <td className="text-center py-2.5 px-2 text-muted-foreground">—</td>
                <td className="text-center py-2.5 px-2 text-muted-foreground bg-primary/5">—</td>
                <td className="text-center py-2.5 px-2 text-muted-foreground">—</td>
                <td className="text-center py-2.5 px-2 text-muted-foreground">—</td>
                <td className="text-center py-2.5 px-2 text-amber-600 dark:text-amber-400 font-medium">Add-on</td>
                <td className="text-center py-2.5 px-2 text-emerald-600 font-bold">✓</td>
              </tr>

              {/* 16. [NEW Quality Feature 5] BGP Redundant Multi-Carrier Failover */}
              <tr className="hover:bg-muted/30">
                <td className="py-2.5 px-4 font-medium text-foreground flex items-center gap-1.5">
                  <Globe2 className="h-3.5 w-3.5 text-blue-600" />
                  <span>BGP Multi-Carrier Failover Core</span>
                </td>
                <td className="text-center py-2.5 px-2 text-muted-foreground">—</td>
                <td className="text-center py-2.5 px-2 text-muted-foreground">—</td>
                <td className="text-center py-2.5 px-2 text-muted-foreground">—</td>
                <td className="text-center py-2.5 px-2 text-muted-foreground bg-primary/5">—</td>
                <td className="text-center py-2.5 px-2 text-muted-foreground">—</td>
                <td className="text-center py-2.5 px-2 text-muted-foreground">—</td>
                <td className="text-center py-2.5 px-2 text-amber-600 dark:text-amber-400 font-medium">Add-on</td>
                <td className="text-center py-2.5 px-2 text-emerald-600 font-bold">Included (99.99%)</td>
              </tr>

              {/* 17. [NEW Quality Feature 6] 1:1 CIR Bandwidth Guarantee */}
              <tr className="hover:bg-muted/30">
                <td className="py-2.5 px-4 font-medium text-foreground flex items-center gap-1.5">
                  <Zap className="h-3.5 w-3.5 text-amber-500" />
                  <span>1:1 Dedicated CIR Bandwidth Ratio</span>
                </td>
                <td className="text-center py-2.5 px-2 text-muted-foreground">—</td>
                <td className="text-center py-2.5 px-2 text-muted-foreground">—</td>
                <td className="text-center py-2.5 px-2 text-muted-foreground">—</td>
                <td className="text-center py-2.5 px-2 text-muted-foreground bg-primary/5">—</td>
                <td className="text-center py-2.5 px-2 text-muted-foreground">—</td>
                <td className="text-center py-2.5 px-2 text-muted-foreground">—</td>
                <td className="text-center py-2.5 px-2 text-amber-600 dark:text-amber-400 font-medium">Add-on</td>
                <td className="text-center py-2.5 px-2 text-emerald-600 font-bold">Included (100% CIR)</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* ─────────────────────────────────────────────────────────────
          5. "Which Package Is For Whom?" Guide
      ───────────────────────────────────────────────────────────── */}
      <section className="container mx-auto px-4 max-w-6xl py-12 border-t space-y-8">
        <div className="text-center max-w-2xl mx-auto space-y-2">
          <Badge variant="outline" className="px-3 py-1 text-xs font-semibold text-primary">
            Customer Segmentation Guide
          </Badge>
          <h2 className="text-2xl sm:text-3xl font-black tracking-tight text-foreground">
            Plan Selection Guide · Who Is Each Plan For?
          </h2>
          <p className="text-xs sm:text-sm text-muted-foreground">
            Find the exact plan tailored to your household size, digital workflow, gaming needs, or business operations.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="p-4 rounded-xl border bg-card hover:border-primary/40 transition-colors space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-bold text-sm text-foreground">Essential</span>
              <span className="font-mono text-xs text-primary font-bold">100M</span>
            </div>
            <p className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
              Individual / Small Household
            </p>
            <p className="text-[11px] text-muted-foreground">
              Ideal for single users or small apartments needing steady fiber for streaming, browsing, and remote work calls.
            </p>
          </div>

          <div className="p-4 rounded-xl border bg-card hover:border-primary/40 transition-colors space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-bold text-sm text-foreground">Standard</span>
              <span className="font-mono text-xs text-primary font-bold">200M</span>
            </div>
            <p className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
              Regular Home Users
            </p>
            <p className="text-[11px] text-muted-foreground">
              Great for 2-4 person households with smart TVs, smartphones, and casual online gaming.
            </p>
          </div>

          <div className="p-4 rounded-xl border bg-card hover:border-primary/40 transition-colors space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-bold text-sm text-foreground">Advanced</span>
              <span className="font-mono text-xs text-primary font-bold">300M</span>
            </div>
            <p className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
              Family / Remote Workers
            </p>
            <p className="text-[11px] text-muted-foreground">
              Heavy zoom calls, large file downloads, cloud syncing, and multi-screen HD/4K streaming without buffering.
            </p>
          </div>

          <div className="p-4 rounded-xl border bg-primary/5 border-primary/30 hover:border-primary/60 transition-colors space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-bold text-sm text-foreground">Premium</span>
              <span className="font-mono text-xs text-primary font-bold">500M</span>
            </div>
            <p className="text-xs font-semibold text-primary">
              Heavy Users / Content Creators
            </p>
            <p className="text-[11px] text-muted-foreground">
              YouTubers, Twitch streamers, software developers, and households with heavy concurrent upload demands.
            </p>
          </div>

          <div className="p-4 rounded-xl border bg-card hover:border-primary/40 transition-colors space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-bold text-sm text-foreground">Ultra</span>
              <span className="font-mono text-xs text-primary font-bold">750M</span>
            </div>
            <p className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
              Gaming / Streaming Enthusiasts
            </p>
            <p className="text-[11px] text-muted-foreground">
              Competitive esports players demanding minimum ping, dedicated routing, and instantaneous multi-gigabit game downloads.
            </p>
          </div>

          <div className="p-4 rounded-xl border bg-card hover:border-primary/40 transition-colors space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-bold text-sm text-foreground">Gigabit</span>
              <span className="font-mono text-xs text-primary font-bold">1 Gbps</span>
            </div>
            <p className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
              Power Users / Smart Homes
            </p>
            <p className="text-[11px] text-muted-foreground">
              50+ IoT connected devices, security cameras, home media servers, and zero-compromise gigabit throughput.
            </p>
          </div>

          <div className="p-4 rounded-xl border bg-purple-500/5 border-purple-500/30 hover:border-purple-500/60 transition-colors space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-bold text-sm text-foreground">Multi-Gig</span>
              <span className="font-mono text-xs text-purple-600 dark:text-purple-400 font-bold">2 Gbps</span>
            </div>
            <p className="text-xs font-semibold text-purple-600 dark:text-purple-400">
              Studios / Professional Users
            </p>
            <p className="text-[11px] text-muted-foreground">
              Audio/video production studios, 3D rendering labs, and data-intensive creative agencies with included Static IP.
            </p>
          </div>

          <div className="p-4 rounded-xl border bg-card hover:border-primary/40 transition-colors space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-bold text-sm text-foreground">Business Pro</span>
              <span className="font-mono text-xs text-primary font-bold">5 Gbps</span>
            </div>
            <p className="text-xs font-semibold text-foreground">
              Enterprise / Corporate
            </p>
            <p className="text-[11px] text-muted-foreground">
              Offices, corporate headquarters, and cloud infrastructure with guaranteed 99.99% uptime SLA and 1:1 dedicated CIR.
            </p>
          </div>
        </div>
      </section>

      {/* ─────────────────────────────────────────────────────────────
          6. Technical Hardware & Infrastructure Requirement Note
      ───────────────────────────────────────────────────────────── */}
      <section className="container mx-auto px-4 max-w-6xl py-6">
        <div className="p-6 rounded-2xl bg-muted/40 border border-border flex flex-col sm:flex-row gap-4 items-start">
          <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 shrink-0">
            <Info className="h-5 w-5" />
          </div>
          <div className="space-y-1.5 text-xs text-muted-foreground leading-relaxed">
            <h4 className="font-bold text-sm text-foreground">
              Network Capability & Customer Equipment Notice
            </h4>
            <p>
              All features and performance capabilities are delivered according to NextLink&apos;s carrier network infrastructure, optical distribution points, and binding service level agreements (SLAs). 
              <strong className="text-foreground"> Multi-Gigabit tiers (2 Gbps &amp; 5 Gbps)</strong> require compatible Customer Premises Equipment (CPE), including 2.5G/10G Optical ONUs, multi-gigabit Wi-Fi 6/6E routers, and high-bandwidth Category 6A/7 ethernet cabling.
            </p>
            <p className="pt-1 text-[11px] text-muted-foreground/80">
              * Global Positioning: Standardized international tier model designed for global deployment. Regional speeds, local loop availability, and pricing may vary depending on municipal fiber footprint and local exchange peering.
            </p>
          </div>
        </div>
      </section>

      {/* ─────────────────────────────────────────────────────────────
          7. Enterprise Banner
      ───────────────────────────────────────────────────────────── */}
      <section className="container mx-auto px-4 max-w-6xl py-10">
        <div className="rounded-2xl border border-primary/30 bg-gradient-to-r from-primary/[0.08] via-card to-background p-6 md:p-8 flex flex-col md:flex-row items-center justify-between gap-6 shadow-sm">
          <div className="space-y-1.5">
            <h3 className="text-xl md:text-2xl font-bold text-foreground">
              Need Custom 10 Gbps+ Dark Fiber or Multi-Cloud Peering?
            </h3>
            <p className="text-xs sm:text-sm text-muted-foreground max-w-2xl">
              We provide tailored 1:1 CIR optical fiber drops, static public /28 & /29 subnets, BGP Anycast routing, and dedicated Tier-1 transit for financial institutions, datacenters, and enterprise campuses.
            </p>
          </div>
          <Button 
            onClick={() => router.push('/apply?package=Enterprise%20Custom')}
            className="font-bold flex-shrink-0 shadow-md h-11 px-6 text-sm"
          >
            Contact Enterprise NOC
          </Button>
        </div>
      </section>
    </div>
  )
}
