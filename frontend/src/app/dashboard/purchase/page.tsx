'use client'

import React, { useState, useEffect, useMemo, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { 
  Wifi, 
  CheckCircle2, 
  AlertCircle, 
  ShieldCheck, 
  ShieldAlert, 
  CreditCard, 
  ArrowRight, 
  ArrowLeft, 
  Printer, 
  Download, 
  Check, 
  Layers, 
  Cpu, 
  Network, 
  Zap, 
  Radio, 
  Lock, 
  FileText, 
  Calendar, 
  DollarSign, 
  Clock, 
  Sparkles,
  Smartphone,
  Globe2,
  Globe,
  MapPin,
  RefreshCw,
  Loader2,
  X
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuthStore } from '@/store/authStore'
import { useContentStore, PackageItem } from '@/store/contentStore'
import { subscriberAuthHeader, fetchLiveTelemetry, fetchMySummary, PortalSummary } from '@/lib/portalApi'
import { useModalA11y } from '@/lib/useModalA11y'

type PurchaseType = 'UPGRADE' | 'ADDITIONAL' | 'RENEWAL'
/**
 * The gateways the billing engine can actually charge through. The customer
 * is redirected to the gateway checkout — the portal does not collect the
 * card or wallet credentials itself.
 */
type PaymentGateway = 'bkash' | 'nagad' | 'sslcommerz' | 'rocket'

interface QuoteLineItem {
  code: string
  type?: string
  label: string
  description?: string
  amount: number
  amountCents?: number
  formattedAmount?: string
  prefix?: string
  period?: string
  monthYear?: string
  invoiceId?: string
}

interface OrderCalculation {
  scenario?: 'NEW_SUBSCRIBER' | 'EXISTING_NORMAL' | 'OVERDUE_BALANCE'
  badge?: string
  packageLabel?: string
  lines: QuoteLineItem[]
  currentPackage: string
  newPackage: string
  currentPrice: number
  newPrice: number
  proratedAdjustment: number
  installationFee: number
  lateFee?: number
  carriedOverAmount?: number
  previousDue?: number
  taxes: number
  discount: number
  totalPayable: number
  formattedTotalPayable?: string
  nextBillingDate: string
  calculation?: {
    scenario?: string
    badge?: string
    packageLabel?: string
    lines?: QuoteLineItem[]
    monthlySubscriptionPrice?: number
    remainingCurrentSubscriptionValue?: number
    totalPayableToday?: number
    daysRemainingInCycle?: number
    lateFee?: number
    carriedOverAmount?: number
    purchaseType?: string
  }
}

interface ConfirmedOrder {
  orderId: string
  trxId: string
  packageId: string
  packageName: string
  packageLabel?: string
  scenario?: string
  badge?: string
  lines?: QuoteLineItem[]
  purchaseType: string
  totalPayable: number
  paymentMethod: string
  orderStatus: string
  expectedActivationTime: string
  nextBillingDate: string
  createdAt: string
  customerName: string
  customerId: string
  installationAddress: string
}

function PurchaseContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const preselectedPkgId = searchParams.get('package')

  const { user, isAuthenticated, hasHydrated, updateUser } = useAuthStore()
  const { packages, fetchContent } = useContentStore()

  // Eligibility Verification State
  const [isVerifyingEligibility, setIsVerifyingEligibility] = useState(true)
  const [eligibilityData, setEligibilityData] = useState<{
    eligible: boolean
    status?: string
    restrictionCode?: string
    message?: string
    balance?: number
    subscriber?: any
    /** The verification service could not be reached — not a restriction. */
    verificationFailed?: boolean
  } | null>(null)
  const [telemetrySubscriber, setTelemetrySubscriber] = useState<any>(null)
  const [portalSummary, setPortalSummary] = useState<PortalSummary | null>(null)

  // Step Tracker (1: Package, 2: Type, 3: Compatibility, 4: Summary, 5: Payment, 6: Confirmed)
  const [currentStep, setCurrentStep] = useState<number>(1)

  // Order Configuration State
  const [selectedPackage, setSelectedPackage] = useState<PackageItem | null>(null)
  const [purchaseType, setPurchaseType] = useState<PurchaseType>('UPGRADE')
  const [termsAccepted, setTermsAccepted] = useState(false)

  // Network & Compatibility Validation State
  const [networkCheckLoading, setNetworkCheckLoading] = useState(false)
  const [networkValidation, setNetworkValidation] = useState<{
    compatible: boolean
    oltCapacity?: string
    symmetricalCapable?: boolean
    hardwareRequired?: string
    upgradeHardwareNeeded?: boolean
    notes?: string
    /** The verification service could not be reached — not a pass. */
    verificationFailed?: boolean
    available?: boolean
    error?: string
  } | null>(null)

  // Calculation State
  const [calculatingOrder, setCalculatingOrder] = useState(false)
  const [orderCalculation, setOrderCalculation] = useState<OrderCalculation | null>(null)
  const [quoteError, setQuoteError] = useState<string | null>(null)

  // Payment Form State
  //
  // The gateway collects the payment details itself — the portal never sees a
  // card number. The customer is sent to the gateway checkout and the
  // subscription is activated when the gateway confirms the payment.
  const [selectedGateway, setSelectedGateway] = useState<PaymentGateway>('bkash')
  const [cardHolder, setCardHolder] = useState('')
  const [mobileWalletNumber, setMobileWalletNumber] = useState('')
  const [isSubmittingOrder, setIsSubmittingOrder] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  // Confirmation State
  const [confirmedOrder, setConfirmedOrder] = useState<ConfirmedOrder | null>(null)
  const [invoiceModalOpen, setInvoiceModalOpen] = useState(false)

  // Escape closes the invoice modal and the page does not scroll behind it.
  useModalA11y(invoiceModalOpen, () => setInvoiceModalOpen(false))

  // Real-time purchase session: Date (DD/MM/YYYY), Time (00:00AM/PM), Location (city, postal code, state, country)
  const [purchaseLocation, setPurchaseLocation] = useState<{
    city: string
    postalCode: string
    state: string
    country: string
    ip?: string
    isp?: string
    loading: boolean
  }>({
    // The location is filled in from the lookup below. Nothing is invented
    // here — an unknown address stays empty.
    city: '',
    postalCode: '',
    state: '',
    country: '',
    loading: true
  })

  const [currentTime, setCurrentTime] = useState<{ date: string; time: string }>({
    date: '',
    time: ''
  })

  // Live real-time clock and location lookup
  useEffect(() => {
    // 1. Fetch real-time client location
    const fetchLocation = async () => {
      try {
        const res = await fetch('/api/customer/location')
        const data = await res.json()
        if (data && data.success) {
          setPurchaseLocation({
            city: data.city || '',
            postalCode: data.postalCode || '',
            state: data.state || '',
            country: data.country || '',
            ip: data.ip || '',
            isp: data.isp || '',
            loading: false
          })
        } else {
          setPurchaseLocation((prev) => ({ ...prev, loading: false }))
        }
      } catch (e) {
        setPurchaseLocation((prev) => ({ ...prev, loading: false }))
      }
    }
    fetchLocation()

    // 2. Real-time Date (DD/MM/YYYY) and Time (00:00AM/PM)
    const updateClock = () => {
      const now = new Date()
      const day = String(now.getDate()).padStart(2, '0')
      const month = String(now.getMonth() + 1).padStart(2, '0')
      const year = now.getFullYear()
      const dateFormatted = `${day}/${month}/${year}`

      const rawHours = now.getHours()
      const mins = String(now.getMinutes()).padStart(2, '0')
      const ampm = rawHours >= 12 ? 'PM' : 'AM'
      const h12 = rawHours % 12 || 12
      const formattedH12 = String(h12).padStart(2, '0')
      const timeFormatted = `${formattedH12}:${mins}${ampm}`

      setCurrentTime({
        date: dateFormatted,
        time: timeFormatted
      })
    }

    updateClock()
    const timer = setInterval(updateClock, 1000)
    return () => clearInterval(timer)
  }, [])

  // Ensure content is loaded
  useEffect(() => {
    fetchContent()
  }, [fetchContent])

  // Authentication Guard: Redirect non-logged-in visitors immediately
  useEffect(() => {
    if (hasHydrated && !isAuthenticated) {
      const redirectUrl = `/login?redirect=${encodeURIComponent('/dashboard/purchase' + (preselectedPkgId ? `?package=${preselectedPkgId}` : ''))}&reason=existing_customer_only`
      router.push(redirectUrl)
    }
  }, [hasHydrated, isAuthenticated, preselectedPkgId, router])

  // Initial eligibility verification against PostgreSQL subscribers
  useEffect(() => {
    if (!isAuthenticated || !user) return

    const verifyCustomer = async () => {
      setIsVerifyingEligibility(true)
      try {
        const res = await fetch(`/api/customer/validate-eligibility?customerId=${encodeURIComponent(user.id)}`, {
          headers: subscriberAuthHeader(),
        })
        const data = await res.json()
        // A server error is not an eligibility problem, so the two are kept
        // apart — otherwise a failing request shows a red restriction notice
        // to a paying customer.
        if (!res.ok) {
          setEligibilityData({
            eligible: false,
            restrictionCode: 'VERIFICATION_UNAVAILABLE',
            verificationFailed: true,
            message:
              data?.error ||
              'The subscriber verification service could not be reached. Please retry in a moment.',
          })
        } else {
          setEligibilityData(data)
        }
      } catch (err) {
        console.error('Eligibility check error:', err)
        setEligibilityData({
          eligible: false,
          restrictionCode: 'NETWORK_ERROR',
          verificationFailed: true,
          message: 'Unable to connect to NextLink optical subscriber verification database.'
        })
      } finally {
        setIsVerifyingEligibility(false)
      }
    }

    verifyCustomer()
  }, [isAuthenticated, user])

  // Real-time synchronization of authoritative subscriber active package & cancellation status
  useEffect(() => {
    if (!isAuthenticated) return

    let isMounted = true

    const syncTelemetry = async () => {
      try {
        const [res, sumRes] = await Promise.all([
          fetchLiveTelemetry(),
          fetchMySummary(),
        ])
        if (!isMounted) return
        if (sumRes.success && sumRes.summary) {
          setPortalSummary(sumRes.summary)
        }
        if (res.success && res.telemetry?.subscriber) {
          const sub = res.telemetry.subscriber
          setTelemetrySubscriber(sub)
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
        console.warn('Purchase page telemetry sync error:', err)
      }
    }

    syncTelemetry()
    const pollInterval = setInterval(syncTelemetry, 3500)

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') syncTelemetry()
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
    eligibilityData?.subscriber?.status === 'cancelled' ||
    user?.status === 'cancelled' ||
    user?.subscriptionCancelledAt
  )

  const isActiveSubscriber = Boolean(
    isAuthenticated &&
    !isCancelled &&
    (
      telemetrySubscriber?.status === 'active' ||
      telemetrySubscriber?.status === 'suspended' ||
      eligibilityData?.subscriber?.status === 'active' ||
      eligibilityData?.subscriber?.status === 'suspended' ||
      user?.status === 'active' ||
      user?.status === 'suspended'
    )
  )

  const activePackageId = isActiveSubscriber
    ? (telemetrySubscriber?.packageId || eligibilityData?.subscriber?.packageId || user?.packageId || null)
    : null

  const currentPackage = useMemo(() => {
    if (!activePackageId || !packages || packages.length === 0) return null
    return packages.find(
      (p) => (p.id || '').trim().toLowerCase() === activePackageId.trim().toLowerCase()
    ) || null
  }, [activePackageId, packages])

  const currentSpeed = currentPackage ? currentPackage.speed : (telemetrySubscriber?.speedMbps || eligibilityData?.subscriber?.speedMbps || 0)
  const currentPrice = currentPackage ? currentPackage.price : (telemetrySubscriber?.price || eligibilityData?.subscriber?.price || 0)

  // Handle pre-selected package query parameter — only once, and never
  // overwrite a plan the visitor picked manually.
  const preselectionApplied = React.useRef(false)

  useEffect(() => {
    if (preselectionApplied.current) return
    if (!packages || packages.length === 0) return

    if (preselectedPkgId) {
      const matched = packages.find(
        (p) => (p.id || '').toLowerCase() === preselectedPkgId.toLowerCase() ||
               (p.name || '').toLowerCase() === preselectedPkgId.toLowerCase(),
      )
      if (matched) {
        setSelectedPackage(matched)
        preselectionApplied.current = true
        return
      }
    }

    // Default to active plan if present, else packages[0]
    if (activePackageId) {
      const activePkg = packages.find(
        (p) => (p.id || '').toLowerCase() === activePackageId.toLowerCase()
      )
      if (activePkg) {
        setSelectedPackage(activePkg)
        preselectionApplied.current = true
        return
      }
    }

    if (!selectedPackage) {
      setSelectedPackage(packages[0])
      preselectionApplied.current = true
    }
  }, [packages, activePackageId, preselectedPkgId, selectedPackage])

  // Synchronize purchaseType: when current package is selected, automatically lock to RENEWAL (Requirement 3)
  const preselectedType = searchParams.get('type')
  useEffect(() => {
    if (selectedPackage && activePackageId && (selectedPackage.id || '').toLowerCase() === activePackageId.toLowerCase()) {
      setPurchaseType('RENEWAL')
    } else if (preselectedType === 'RENEWAL') {
      setPurchaseType('RENEWAL')
    } else if (purchaseType === 'RENEWAL') {
      setPurchaseType('UPGRADE')
    }
  }, [selectedPackage, activePackageId, preselectedType, purchaseType])

  // Network compatibility check when selectedPackage changes
  useEffect(() => {
    if (!selectedPackage || !user) return

    const checkCompatibility = async () => {
      setNetworkCheckLoading(true)
      try {
        const res = await fetch('/api/customer/validate-network', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...subscriberAuthHeader() },
          body: JSON.stringify({
            customerId: user.id,
            packageId: selectedPackage.id,
            purchaseType,
            speed: selectedPackage.speed
          })
        })
        const result = await res.json()
        if (!res.ok) {
          // A failed check is not a pass. The badge below reads the result, so
          // the verification is marked as unavailable instead of cleared.
          setNetworkValidation({
            compatible: false,
            available: false,
            verificationFailed: true,
            error: result?.error || 'The network verification service could not be reached.',
          })
        } else {
          setNetworkValidation(result)
        }
      } catch (e) {
        console.error('Network check error:', e)
        setNetworkValidation({
          compatible: false,
          available: false,
          verificationFailed: true,
          error: 'The network verification service could not be reached.',
        })
      } finally {
        setNetworkCheckLoading(false)
      }
    }

    checkCompatibility()
  }, [selectedPackage, user])

  // Recalculate order breakdown from the backend quote engine (single source of truth)
  const fetchOrderQuote = React.useCallback(async () => {
    if (!selectedPackage || !user) return
    setCalculatingOrder(true)
    setQuoteError(null)
    try {
      const simulateFailureParam = searchParams.get('simulateQuoteFailure') === '1'
      const res = await fetch('/api/customer/calculate-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...subscriberAuthHeader() },
        body: JSON.stringify({
          customerId: user.id,
          packageId: selectedPackage.id,
          purchaseType,
          billingCycle: 'monthly',
          simulateFailure: simulateFailureParam,
        }),
      })
      const result = await res.json().catch(() => null)
      if (res.ok && result?.success && Array.isArray(result?.lines)) {
        setOrderCalculation(result)
        setQuoteError(null)
      } else {
        setOrderCalculation(null)
        setQuoteError(
          result?.error || 'Unable to verify invoice preview with the Billing Engine. Please retry.'
        )
      }
    } catch (e: any) {
      console.error('Calculation error:', e)
      setOrderCalculation(null)
      setQuoteError('Network error while contacting the Billing Engine. Please retry.')
    } finally {
      setCalculatingOrder(false)
    }
  }, [selectedPackage, purchaseType, user, searchParams])

  useEffect(() => {
    fetchOrderQuote()
  }, [fetchOrderQuote])

  // Submit and execute order
  const handleExecutePayment = async () => {
    if (!termsAccepted) {
      setSubmitError('You must agree to NextLink Global Terms of Service and SLA before proceeding.')
      return
    }
    if (!selectedPackage || !user || !orderCalculation || quoteError) {
      setSubmitError('Your invoice quote must be verified by the Billing Engine before proceeding to payment.')
      return
    }

    setIsSubmittingOrder(true)
    setSubmitError(null)

    try {
      const formattedTimestamp = `${currentTime.date || '09/11/2026'} · ${currentTime.time || '12:00PM'}`
      const formattedLocation = `${purchaseLocation.city}, ${purchaseLocation.postalCode}, ${purchaseLocation.state}, ${purchaseLocation.country}`
      const formattedTypeLabel = orderCalculation.badge || (purchaseType === 'UPGRADE' ? 'Package Plan Upgrade' : 'New Subscription')

      const res = await fetch('/api/customer/orders/create-and-pay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...subscriberAuthHeader() },
        body: JSON.stringify({
          customerId: user.id,
          packageId: selectedPackage.id,
          purchaseType,
          purchaseTypeLabel: formattedTypeLabel,
          purchaseTimestamp: formattedTimestamp,
          sessionGeolocation: formattedLocation,
          paymentMethod: selectedGateway,
          paymentDetails: {
            cardHolder: selectedGateway === 'sslcommerz' ? cardHolder : undefined,
            walletNumber: mobileWalletNumber || undefined
          },
          termsAccepted: true
        })
      })

      const result = await res.json()

      if (!res.ok || !result.success) {
        setSubmitError(result.error || 'Failed to complete transaction. Please check your payment details.')
        setIsSubmittingOrder(false)
        return
      }

      if (result.payment?.redirectUrl) {
        window.location.href = result.payment.redirectUrl
        return
      }

      if (purchaseType === 'UPGRADE') {
        updateUser({
          package: selectedPackage.name,
          packageName: selectedPackage.name,
          packageId: selectedPackage.id
        })
      }

      setConfirmedOrder({
        orderId: result.order.id,
        trxId: result.order.trx_id,
        packageId: result.order.package_id,
        packageName: result.order.package_name,
        packageLabel: result.order.packageLabel || orderCalculation.packageLabel,
        scenario: result.order.scenario || orderCalculation.scenario,
        badge: result.order.badge || orderCalculation.badge,
        lines: result.order.lines || orderCalculation.lines,
        purchaseType: result.order.purchase_type,
        totalPayable: Number(result.order.total_payable || orderCalculation.totalPayable),
        paymentMethod: result.order.payment_method,
        orderStatus: result.order.order_status,
        expectedActivationTime: result.order.expected_activation_time,
        nextBillingDate: result.order.next_billing_date,
        createdAt: result.order.created_at,
        customerName: user.name,
        customerId: user.id,
        installationAddress: user.address || 'Registered Optical Line Drop'
      })

      setCurrentStep(6)
    } catch (err: any) {
      console.error('Execution error:', err)
      setSubmitError('Network failure occurred during secure transaction. Please try again.')
    } finally {
      setIsSubmittingOrder(false)
    }
  }

  if (!isAuthenticated && !hasHydrated) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="flex items-center gap-3 text-muted-foreground">
          <RefreshCw className="h-5 w-5 animate-spin text-primary" />
          <span>Verifying NextLink subscriber authentication session...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background py-8 sm:py-12">
      <div className="container mx-auto px-4 max-w-5xl space-y-8">
        
        {/* Navigation Breadcrumb */}
        <div className="flex items-center justify-between">
          <Link 
            href="/dashboard"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>Back to Subscriber Dashboard</span>
          </Link>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="border-primary/30 text-primary font-mono text-xs">
              ID: {user?.id || 'SUB-001'}
            </Badge>
            <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 text-xs">
              Subscriber Portal
            </Badge>
          </div>
        </div>

        {/* Page Header */}
        <div className="space-y-2 border-b pb-6">
          <div className="flex items-center gap-2 text-primary font-bold text-xs uppercase tracking-wider">
            <Sparkles className="h-4 w-4" />
            <span>NextLink Global Carrier Platform</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-black tracking-tight text-foreground">
            Internet Package Purchase &amp; Fiber Upgrade
          </h1>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Upgrade your optical line speed or provision a secondary dedicated connection with carrier-grade low latency and guaranteed SLA.
          </p>
        </div>

        {/* ─────────────────────────────────────────────────────────────
            ELIGIBILITY / RESTRICTION CHECK BANNER
        ───────────────────────────────────────────────────────────── */}
        {isVerifyingEligibility ? (
          <Card className="border-border">
            <CardContent className="p-6 flex items-center gap-4">
              <RefreshCw className="h-5 w-5 animate-spin text-primary shrink-0" />
              <div>
                <p className="font-semibold text-sm">Verifying Subscriber Line &amp; Account Eligibility...</p>
                <p className="text-xs text-muted-foreground">Validating Optical Distribution Point, customer status, and account ledger in real time.</p>
              </div>
            </CardContent>
          </Card>
        ) : eligibilityData && !eligibilityData.eligible ? (
          <Card className="border-destructive/40 bg-destructive/5 shadow-sm">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-3 text-destructive">
                <ShieldAlert className="h-6 w-6 shrink-0" />
                <div>
                  <CardTitle className="text-lg font-bold text-destructive">
                    {eligibilityData.restrictionCode === 'OUTSTANDING_BALANCE' 
                      ? 'Outstanding Invoice Notice' 
                      : eligibilityData.restrictionCode === 'ACCOUNT_SUSPENDED'
                      ? 'Account Suspended'
                      : 'Account Restriction Notice'}
                  </CardTitle>
                  <CardDescription className="text-destructive/80 text-xs mt-0.5">
                    {eligibilityData.message}
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4 pt-1">
              <div className="p-4 rounded-xl bg-background border border-destructive/20 text-xs space-y-2">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Subscriber ID:</span>
                  <span className="font-mono font-bold text-foreground">{user?.id}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Customer Name:</span>
                  <span className="font-semibold text-foreground">{user?.name}</span>
                </div>
                {eligibilityData.balance !== undefined && (
                  <div className="flex justify-between pt-1 border-t border-border/50">
                    <span className="font-semibold text-muted-foreground">Total Overdue Balance:</span>
                    <span className="font-mono font-black text-destructive text-sm">${Math.abs(eligibilityData.balance).toFixed(2)}</span>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap gap-3">
                {eligibilityData.restrictionCode === 'OUTSTANDING_BALANCE' && (
                  <Button 
                    onClick={() => router.push('/dashboard')}
                    className="font-bold text-xs shadow-sm bg-destructive hover:bg-destructive/90 text-destructive-foreground"
                  >
                    <CreditCard className="h-4 w-4 mr-1.5" />
                    Pay Due Invoice on Dashboard
                  </Button>
                )}
                <Link href="/tickets">
                  <Button variant="outline" size="sm" className="text-xs font-semibold">
                    Contact Billing Support (24/7 Helpline)
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        ) : null}

        {/* If subscriber is NOT eligible, halt further steps */}
        {eligibilityData && !eligibilityData.eligible ? (
          <div className="text-center py-10 space-y-3">
            <p className="text-xs text-muted-foreground">
              Please resolve account restrictions before proceeding with new plan purchases or hardware provisioning.
            </p>
            <Button variant="outline" onClick={() => router.push('/dashboard')} className="text-xs">
              Return to Subscriber Dashboard
            </Button>
          </div>
        ) : (
          <>
            {/* ─────────────────────────────────────────────────────────────
                PROGRESS STEPPER (Steps 1 to 5)
            ───────────────────────────────────────────────────────────── */}
            {currentStep < 6 && (
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 border-b pb-4">
                {[
                  { step: 1, label: '1. Package Selection' },
                  { step: 2, label: '2. Purchase Type' },
                  { step: 3, label: '3. Network Check' },
                  { step: 4, label: '4. Order Summary' },
                  { step: 5, label: '5. Payment & Finish' },
                ].map((item) => {
                  const isActive = currentStep === item.step
                  const isDone = currentStep > item.step
                  return (
                    <div 
                      key={item.step}
                      className={`p-2.5 rounded-xl border text-center transition-all ${
                        isActive 
                          ? 'border-primary bg-primary/10 text-primary font-bold shadow-sm' 
                          : isDone
                          ? 'border-emerald-500/40 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400 font-semibold'
                          : 'border-border text-muted-foreground opacity-60'
                      }`}
                    >
                      <div className="flex items-center justify-center gap-1.5 text-xs">
                        {isDone ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> : null}
                        <span>{item.label}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* ─────────────────────────────────────────────────────────────
                STEP 1: PACKAGE SELECTION
            ───────────────────────────────────────────────────────────── */}
            {currentStep === 1 && (
              <div className="space-y-6 animate-in fade-in">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-xl font-bold text-foreground">Select Your Desired Optical Speed Plan</h2>
                    <p className="text-xs text-muted-foreground">All packages feature 100% symmetrical speeds, zero bandwidth throttling, and carrier DDoS defense.</p>
                  </div>
                  <Badge variant="outline" className="text-xs">
                    Current Active: {activePackageId ? (currentPackage?.name || eligibilityData?.subscriber?.packageName || user?.packageName || activePackageId) : 'None / Unsubscribed'}
                  </Badge>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  {packages.map((pkg) => {
                    const isSelected = selectedPackage?.id === pkg.id

                    // Strict package ID matching
                    const isCurrentPlan = Boolean(
                      activePackageId &&
                      (pkg.id || '').trim().toLowerCase() === activePackageId.trim().toLowerCase()
                    )

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
                      <div
                        key={pkg.id}
                        onClick={() => setSelectedPackage(pkg)}
                        className={`relative rounded-2xl border-2 p-4 transition-all duration-200 flex flex-col justify-between cursor-pointer ${
                          isCurrentPlan
                            ? 'border-emerald-500 ring-2 ring-emerald-500/20 bg-emerald-500/[0.03] dark:bg-emerald-950/20 shadow-sm'
                            : isSelected
                            ? 'border-primary ring-2 ring-primary/20 bg-primary/5 shadow-md -translate-y-1'
                            : 'border-border hover:border-border/80 hover:bg-muted/40'
                        }`}
                      >
                        {/* 1. "Your Current Plan" Badge */}
                        {isCurrentPlan && (
                          <div className="absolute -top-3 left-1/2 -translate-x-1/2 z-20">
                            <Badge 
                              data-testid="purchase-current-plan-badge"
                              className="bg-emerald-600 hover:bg-emerald-600 text-white dark:bg-emerald-500 font-bold px-3 py-0.5 text-[11px] shadow-md flex items-center gap-1.5 border border-emerald-400"
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              <span>Your Current Plan</span>
                            </Badge>
                          </div>
                        )}

                        <div className="space-y-3 pt-1">
                          <div className="flex items-center justify-between">
                            <span className="font-mono text-[11px] font-semibold text-muted-foreground">{pkg.id}</span>
                            <div className="flex items-center gap-1">
                              {isHigherTier && (
                                <Badge variant="outline" className="text-[9px] font-bold text-emerald-600 dark:text-emerald-400 border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0">
                                  Upgrade
                                </Badge>
                              )}
                              {isLowerTier && (
                                <Badge variant="outline" className="text-[9px] font-bold text-amber-600 dark:text-amber-400 border-amber-500/30 bg-amber-500/10 px-1.5 py-0">
                                  Downgrade
                                </Badge>
                              )}
                              {isSelected && !isCurrentPlan && (
                                <Badge className="bg-primary text-primary-foreground text-[10px] py-0 px-2">
                                  SELECTED
                                </Badge>
                              )}
                            </div>
                          </div>

                          <div>
                            <h3 className="font-bold text-base text-foreground">{pkg.name}</h3>
                            <p className="text-[11px] text-primary font-medium">{pkg.targetCustomer || 'General Users'}</p>
                          </div>

                          <div className="flex items-baseline">
                            <span className="text-2xl font-black text-foreground">${pkg.price.toFixed(2)}</span>
                            <span className="text-[11px] text-muted-foreground ml-1">/ month</span>
                          </div>

                          <div className="rounded-xl bg-background/80 border p-2.5 space-y-1 text-xs font-mono">
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">Speed:</span>
                              <span className="font-bold text-foreground">{pkg.speed >= 1000 ? `${pkg.speed/1000} Gbps` : `${pkg.speed} Mbps`} Symmetrical</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">Equipment:</span>
                              <span className="font-semibold text-xs text-foreground">{pkg.hardwareReady || 'Wi-Fi 6 ONU'}</span>
                            </div>
                          </div>

                          <ul className="space-y-1.5 text-xs text-muted-foreground pt-1">
                            {pkg.features?.slice(0, 4).map((f, i) => (
                              <li key={i} className="flex items-center gap-1.5 text-[11px] leading-tight text-foreground/80">
                                <Check className="h-3 w-3 text-emerald-500 shrink-0" />
                                <span>{f}</span>
                              </li>
                            ))}
                          </ul>
                        </div>

                        <div className="pt-4 border-t mt-4">
                          {isCurrentPlan ? (
                            portalSummary?.isCurrentPeriodPaid ? (
                              <Button
                                size="sm"
                                disabled
                                aria-disabled="true"
                                data-testid="purchase-current-plan-paid-btn"
                                className="w-full text-xs font-bold bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 cursor-not-allowed hover:bg-emerald-500/10"
                              >
                                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 mr-1" />
                                <span>Paid – Next due {portalSummary.nextDueDate || 'next cycle'}</span>
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                variant={isSelected ? 'default' : 'outline'}
                                className="w-full text-xs font-bold"
                              >
                                {isSelected ? 'Selected (Monthly Bill)' : 'Select for Renewal'}
                              </Button>
                            )
                          ) : (
                            <Button
                              size="sm"
                              variant={isSelected ? 'default' : 'outline'}
                              className="w-full text-xs font-bold"
                            >
                              {isSelected
                                ? (isHigherTier ? 'Selected (Upgrade)' : isLowerTier ? 'Selected (Downgrade)' : 'Selected')
                                : (isHigherTier ? 'Select for Upgrade' : isLowerTier ? 'Select for Downgrade' : 'Select Plan')}
                            </Button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>

                {(() => {
                  const isSelectedCurrentPlan = Boolean(
                    activePackageId &&
                    selectedPackage?.id &&
                    (selectedPackage.id || '').trim().toLowerCase() === activePackageId.trim().toLowerCase()
                  )
                  const isBlockDuplicatePaid = isSelectedCurrentPlan && Boolean(portalSummary?.isCurrentPeriodPaid)

                  return (
                    <div className="flex flex-col sm:flex-row items-end sm:items-center justify-between gap-3 pt-4 border-t">
                      <div>
                        {isBlockDuplicatePaid ? (
                          <div className="flex items-center gap-2 text-xs text-emerald-700 dark:text-emerald-300 font-medium bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5 rounded-lg">
                            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                            <span>Paid for {portalSummary?.paidMonthYear || 'this month'}. Next bill due: {portalSummary?.nextDueDate || 'next cycle'}.</span>
                          </div>
                        ) : isSelectedCurrentPlan ? (
                          <div className="flex items-center gap-2 text-xs text-emerald-700 dark:text-emerald-400 font-medium bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5 rounded-lg">
                            <CreditCard className="h-4 w-4 shrink-0 text-emerald-600" />
                            <span>Monthly Bill Renewal: Proceed to pay and settle your active plan's bill without installation or tax fees.</span>
                          </div>
                        ) : null}
                      </div>

                      <Button
                        onClick={() => setCurrentStep(2)}
                        disabled={!selectedPackage || isBlockDuplicatePaid}
                        className="font-bold text-xs gap-1.5 px-6 h-10 shadow-sm shrink-0"
                      >
                        <span>{isSelectedCurrentPlan ? 'Proceed to Monthly Renewal' : 'Proceed to Purchase Type'}</span>
                        <ArrowRight className="h-4 w-4" />
                      </Button>
                    </div>
                  )
                })()}
              </div>
            )}

            {/* ─────────────────────────────────────────────────────────────
                STEP 2: PURCHASE TYPE SELECTION
            ───────────────────────────────────────────────────────────── */}
            {currentStep === 2 && (
              <div className="space-y-6 max-w-3xl mx-auto animate-in fade-in">
                {(() => {
                  const isSelectedCurrentPlan = Boolean(
                    activePackageId &&
                    selectedPackage?.id &&
                    (selectedPackage.id || '').trim().toLowerCase() === activePackageId.trim().toLowerCase()
                  )

                  return (
                    <>
                      <div>
                        <h2 className="text-xl font-bold text-foreground">
                          {isSelectedCurrentPlan ? 'Confirm Monthly Bill Renewal' : 'Select Purchase Type'}
                        </h2>
                        <p className="text-xs text-muted-foreground">
                          {isSelectedCurrentPlan
                            ? 'Renew and settle the monthly subscription bill for your active optical fiber package.'
                            : 'Choose whether to upgrade your existing primary optical connection or deploy a secondary high-speed drop.'}
                        </p>
                      </div>

                      {isSelectedCurrentPlan ? (
                        <div className="rounded-2xl border-2 border-emerald-500 ring-2 ring-emerald-500/20 bg-emerald-500/5 p-6 space-y-4 shadow-sm">
                          <div className="flex items-center justify-between">
                            <div className="h-10 w-10 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                              <CreditCard className="h-5 w-5" />
                            </div>
                            <Badge className="bg-emerald-600 hover:bg-emerald-600 text-white font-bold text-xs">
                              MONTHLY RENEWAL
                            </Badge>
                          </div>

                          <div>
                            <h3 className="font-bold text-lg text-foreground">Active Subscription Renewal</h3>
                            <p className="text-xs text-muted-foreground mt-1">
                              Settling monthly bill for <strong className="text-foreground">{selectedPackage?.name}</strong> ({selectedPackage && selectedPackage.speed >= 1000 ? `${selectedPackage.speed/1000} Gbps` : `${selectedPackage?.speed} Mbps`}).
                            </p>
                          </div>

                          <ul className="text-xs space-y-2 text-foreground/90 border-t pt-3">
                            <li className="flex items-center gap-2">
                              <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                              <span>Monthly package fee: <strong>${Number(selectedPackage?.price || 0).toFixed(2)}</strong></span>
                            </li>
                            <li className="flex items-center gap-2">
                              <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                              <span>Zero installation fee: <strong>$0.00</strong> &middot; Zero tax: <strong>$0.00</strong></span>
                            </li>
                            <li className="flex items-center gap-2">
                              <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                              <span>Attaches directly to your active subscription line (no duplicate account created)</span>
                            </li>
                            <li className="flex items-center gap-2">
                              <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                              <span>Instant continuous connectivity &middot; zero service interruption</span>
                            </li>
                          </ul>
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {/* Option A: Replace / Upgrade */}
                          <div
                            onClick={() => setPurchaseType('UPGRADE')}
                            className={`cursor-pointer rounded-2xl border-2 p-5 transition-all space-y-4 ${
                              purchaseType === 'UPGRADE'
                                ? 'border-primary ring-2 ring-primary/20 bg-primary/5 shadow-md'
                                : 'border-border hover:bg-muted/40'
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <div className="h-10 w-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                                <Zap className="h-5 w-5" />
                              </div>
                              {purchaseType === 'UPGRADE' && (
                                <Badge className="bg-primary text-primary-foreground text-xs">RECOMMENDED</Badge>
                              )}
                            </div>

                            <div>
                              <h3 className="font-bold text-base text-foreground">Option A: Upgrade Current Package</h3>
                              <p className="text-xs text-muted-foreground mt-1">
                                Replaces your active plan with <strong className="text-foreground">{selectedPackage?.name}</strong>.
                              </p>
                            </div>

                            <ul className="text-xs space-y-2 text-muted-foreground border-t pt-3">
                              <li className="flex items-center gap-2">
                                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                                <span>Full monthly package price (no proration)</span>
                              </li>
                              <li className="flex items-center gap-2">
                                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                                <span>One-time installation fee: <strong>${Number(orderCalculation?.installationFee ?? 8.99).toFixed(2)}</strong> + tax: <strong>${Number(orderCalculation?.taxes ?? 0.99).toFixed(2)}</strong></span>
                              </li>
                              <li className="flex items-center gap-2">
                                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                                <span>Immediate remote optical re-profiling (5–15 mins)</span>
                              </li>
                            </ul>
                          </div>

                          {/* Option B: Additional Connection */}
                          <div
                            onClick={() => setPurchaseType('ADDITIONAL')}
                            className={`cursor-pointer rounded-2xl border-2 p-5 transition-all space-y-4 ${
                              purchaseType === 'ADDITIONAL'
                                ? 'border-primary ring-2 ring-primary/20 bg-primary/5 shadow-md'
                                : 'border-border hover:bg-muted/40'
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <div className="h-10 w-10 rounded-xl bg-purple-500/10 text-purple-600 dark:text-purple-400 flex items-center justify-center">
                                <Network className="h-5 w-5" />
                              </div>
                              {purchaseType === 'ADDITIONAL' && (
                                <Badge className="bg-purple-600 text-white text-xs">SECONDARY LINE</Badge>
                              )}
                            </div>

                            <div>
                              <h3 className="font-bold text-base text-foreground">Option B: Additional Connection</h3>
                              <p className="text-xs text-muted-foreground mt-1">
                                Maintains existing line and deploys an independent secondary fiber connection.
                              </p>
                            </div>

                            <ul className="text-xs space-y-2 text-muted-foreground border-t pt-3">
                              <li className="flex items-center gap-2">
                                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                                <span>Separate connection identifier (e.g. {user?.username || 'user'}-L2)</span>
                              </li>
                              <li className="flex items-center gap-2">
                                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                                <span>Fixed installation fee: <strong>${Number(orderCalculation?.installationFee ?? 8.99).toFixed(2)}</strong> + tax: <strong>${Number(orderCalculation?.taxes ?? 0.99).toFixed(2)}</strong></span>
                              </li>
                              <li className="flex items-center gap-2">
                                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                                <span>Technician line dispatch scheduled within 24–48 hours</span>
                              </li>
                            </ul>
                          </div>
                        </div>
                      )}
                    </>
                  )
                })()}

                <div className="flex items-center justify-between pt-4 border-t">
                  <Button variant="outline" size="sm" onClick={() => setCurrentStep(1)} className="text-xs">
                    <ArrowLeft className="h-3.5 w-3.5 mr-1" />
                    Back to Packages
                  </Button>
                  <Button onClick={() => setCurrentStep(3)} className="font-bold text-xs gap-1.5 h-10 px-6 shadow-sm">
                    <span>Validate Optical Compatibility</span>
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}

            {/* ─────────────────────────────────────────────────────────────
                STEP 3: NETWORK & HARDWARE VALIDATION
            ───────────────────────────────────────────────────────────── */}
            {currentStep === 3 && (
              <div className="space-y-6 max-w-3xl mx-auto animate-in fade-in">
                <div>
                  <h2 className="text-xl font-bold text-foreground">Step 3: Network &amp; Hardware Compatibility</h2>
                  <p className="text-xs text-muted-foreground">
                    Verifying carrier OLT optical capacity, GPON/XGS-PON splitter load, and Customer Premises Equipment (CPE).
                  </p>
                </div>

                <Card className="border shadow-sm">
                  <CardHeader className="pb-3 border-b">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Cpu className="h-5 w-5 text-primary" />
                        <CardTitle className="text-base">Carrier Optical Line Diagnostics</CardTitle>
                      </div>
                      {networkCheckLoading ? (
                        <Badge className="bg-muted text-muted-foreground border-border text-xs">
                          <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                          CHECKING
                        </Badge>
                      ) : networkValidation?.verificationFailed ? (
                        <Badge className="bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20 text-xs">
                          UNAVAILABLE
                        </Badge>
                      ) : networkValidation?.compatible ? (
                        <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 text-xs">
                          PASSED
                        </Badge>
                      ) : (
                        <Badge className="bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20 text-xs">
                          NOT AVAILABLE
                        </Badge>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4 pt-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                      <div className="p-3 rounded-xl bg-muted/40 border">
                        <span className="text-muted-foreground block text-[11px]">OLT Distribution Point</span>
                        <span className="font-mono font-bold text-foreground">
                          {networkValidation?.oltCapacity || 'Confirmed 10G XGS-PON Ready'}
                        </span>
                      </div>

                      <div className="p-3 rounded-xl bg-muted/40 border">
                        <span className="text-muted-foreground block text-[11px]">Throughput Symmetry</span>
                        <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">
                          100% Symmetrical (Upload = Download)
                        </span>
                      </div>

                      <div className="p-3 rounded-xl bg-muted/40 border">
                        <span className="text-muted-foreground block text-[11px]">Hardware Required</span>
                        <span className="font-semibold text-foreground">
                          {selectedPackage?.hardwareReady || 'Wi-Fi 6 ONU / Esports Router'}
                        </span>
                      </div>

                      <div className="p-3 rounded-xl bg-muted/40 border">
                        <span className="text-muted-foreground block text-[11px]">CPE Upgrade Status</span>
                        <span className="font-semibold text-foreground">
                          {networkValidation?.upgradeHardwareNeeded 
                            ? 'Complimentary Next-Gen ONU Dispatch Included' 
                            : 'Existing Optical ONU Fully Compatible'}
                        </span>
                      </div>
                    </div>

                    <div className="p-3 rounded-xl bg-primary/5 border border-primary/20 text-xs flex items-start gap-2.5">
                      <ShieldCheck className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                      <p className="text-muted-foreground leading-relaxed">
                        <strong className="text-foreground">Network Verification Cleared:</strong> NextLink core optical routing guarantees 99.99% service availability, buffer-free low latency routing, and direct carrier peering to AWS, Cloudflare, and global IXPs.
                      </p>
                    </div>
                  </CardContent>
                </Card>

                <div className="flex items-center justify-between pt-4 border-t">
                  <Button variant="outline" size="sm" onClick={() => setCurrentStep(2)} className="text-xs">
                    <ArrowLeft className="h-3.5 w-3.5 mr-1" />
                    Back
                  </Button>
                  <Button onClick={() => setCurrentStep(4)} className="font-bold text-xs gap-1.5 h-10 px-6 shadow-sm">
                    <span>Review Order Summary</span>
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}

            {/* ─────────────────────────────────────────────────────────────
                STEP 4: ORDER SUMMARY & PRORATED BILLING
            ───────────────────────────────────────────────────────────── */}
            {currentStep === 4 && (
              <div className="space-y-6 max-w-3xl mx-auto animate-in fade-in">
                <div>
                  <h2 className="text-xl font-bold text-foreground">Step 4: Order Breakdown &amp; Invoice Preview</h2>
                  <p className="text-xs text-muted-foreground">
                    Review your order specifics, verified purchase session details, and confirm subscriber terms.
                  </p>
                </div>

                {/* Real-Time Order Timestamp & Geolocation Breakdown */}
                <Card className="border shadow-xs bg-card overflow-hidden">
                  <div className="bg-muted/40 px-4 py-2.5 border-b flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Globe className="h-4 w-4 text-primary" />
                      <span className="font-bold text-xs uppercase tracking-wider text-foreground">
                        Real-Time Purchase Session &amp; Geolocation
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="inline-block h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                      <span className="text-[11px] font-mono text-emerald-600 dark:text-emerald-400 font-semibold">
                        Live Verified Session
                      </span>
                    </div>
                  </div>
                  <CardContent className="p-4">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                      {/* Date */}
                      <div className="space-y-1 p-2.5 rounded-lg bg-muted/30 border">
                        <span className="text-muted-foreground text-[10px] uppercase font-bold flex items-center gap-1">
                          <Calendar className="h-3 w-3 text-primary" /> Purchase Date
                        </span>
                        <p className="font-mono font-bold text-foreground text-sm">
                          {currentTime.date || '09/11/2026'}
                        </p>
                        <span className="text-[10px] text-muted-foreground font-mono block">Format: (DD/MM/YYYY)</span>
                      </div>

                      {/* Time */}
                      <div className="space-y-1 p-2.5 rounded-lg bg-muted/30 border">
                        <span className="text-muted-foreground text-[10px] uppercase font-bold flex items-center gap-1">
                          <Clock className="h-3 w-3 text-primary" /> Purchase Time
                        </span>
                        <p className="font-mono font-bold text-foreground text-sm">
                          {currentTime.time || '12:00AM'}
                        </p>
                        <span className="text-[10px] text-muted-foreground font-mono block">Format: (00:00AM/PM)</span>
                      </div>

                      {/* City & Postal Code */}
                      <div className="space-y-1 p-2.5 rounded-lg bg-muted/30 border">
                        <span className="text-muted-foreground text-[10px] uppercase font-bold flex items-center gap-1">
                          <MapPin className="h-3 w-3 text-primary" /> City &amp; Postal Code
                        </span>
                        <p className="font-bold text-foreground text-sm truncate">
                          {purchaseLocation.city}, {purchaseLocation.postalCode}
                        </p>
                        <span className="text-[10px] text-muted-foreground font-mono block">
                          Postal: <strong className="text-foreground">{purchaseLocation.postalCode}</strong>
                        </span>
                      </div>

                      {/* State & Country */}
                      <div className="space-y-1 p-2.5 rounded-lg bg-muted/30 border">
                        <span className="text-muted-foreground text-[10px] uppercase font-bold flex items-center gap-1">
                          <Globe2 className="h-3 w-3 text-primary" /> State &amp; Country
                        </span>
                        <p className="font-bold text-foreground text-sm truncate">
                          {purchaseLocation.state}, {purchaseLocation.country}
                        </p>
                        <span className="text-[10px] text-muted-foreground font-mono block truncate">
                          Country: <strong className="text-foreground">{purchaseLocation.country}</strong>
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Subscriber Plan Invoice Preview */}
                <Card className="border shadow-sm">
                  <CardHeader className="pb-3 border-b">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base font-bold">Subscriber Plan Invoice Preview</CardTitle>
                      {orderCalculation?.badge && (
                        <Badge
                          variant="outline"
                          className={`font-mono text-xs ${
                            orderCalculation.scenario === 'OVERDUE_BALANCE'
                              ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/30'
                              : orderCalculation.scenario === 'NEW_SUBSCRIBER'
                                ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
                                : 'bg-primary/10 text-primary border-primary/30'
                          }`}
                        >
                          {orderCalculation.badge}
                        </Badge>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-5 pt-4">
                    {/* Loading state */}
                    {calculatingOrder && (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground py-4">
                        <Loader2 className="h-4 w-4 animate-spin text-primary" />
                        <span>Verifying invoice quote with the billing engine…</span>
                      </div>
                    )}

                    {/* Error state — never show a fallback total */}
                    {!calculatingOrder && (quoteError || !orderCalculation) && (
                      <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-700 dark:text-rose-300 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="flex items-start gap-2.5">
                          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-rose-600 dark:text-rose-400" />
                          <div>
                            <p className="font-bold">Invoice Quote Verification Failed</p>
                            <p className="mt-0.5 text-[11px] opacity-90">
                              {quoteError || 'Unable to retrieve the verified invoice quote from the billing engine.'}
                            </p>
                          </div>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={fetchOrderQuote}
                          className="gap-1.5 text-xs shrink-0 border-rose-500/40 hover:bg-rose-500/10"
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                          <span>Retry</span>
                        </Button>
                      </div>
                    )}

                    {/* Verified Line Items from Backend Billing Engine */}
                    {!calculatingOrder && !quoteError && orderCalculation && (
                      <div className="space-y-3 text-xs">
                        {(orderCalculation.lines || []).map((line, idx) => (
                          <div
                            key={`${line.code}-${line.invoiceId || idx}`}
                            className={`flex justify-between items-center py-1.5 ${
                              idx > 0 ? 'border-t border-border/50' : ''
                            }`}
                          >
                            <div>
                              <p className="font-semibold text-foreground text-sm">{line.label}</p>
                            </div>
                            <span
                              className={`font-mono font-bold text-sm ${
                                line.code === 'late_fee'
                                  ? 'text-rose-600 dark:text-rose-400'
                                  : line.code === 'previous_month_fee'
                                    ? 'text-amber-600 dark:text-amber-400'
                                    : 'text-foreground'
                              }`}
                            >
                              {line.formattedAmount ||
                                `${line.prefix || '$'}${Number(line.amount || 0).toFixed(2)}`}
                            </span>
                          </div>
                        ))}

                        {/* Total Payable Amount Now — server-verified amount */}
                        <div className="flex justify-between items-center py-3 border-t-2 border-border text-sm">
                          <div>
                            <p className="font-black text-foreground text-base">Total Payable Amount Now</p>
                            <p className="text-muted-foreground text-xs">
                              Verified by the billing engine
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-2xl font-black text-primary font-mono">
                              {orderCalculation.formattedTotalPayable ||
                                `$${Number(orderCalculation.totalPayable).toFixed(2)}`}
                            </p>
                            <p className="text-[10px] text-emerald-600 dark:text-emerald-400 uppercase font-semibold">
                              {orderCalculation.badge}
                            </p>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Terms & Conditions Checkbox */}
                    <div className="pt-2 border-t">
                      <label className="flex items-start gap-2.5 cursor-pointer text-xs leading-relaxed text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={termsAccepted}
                          onChange={(e) => setTermsAccepted(e.target.checked)}
                          className="mt-0.5 rounded border-border text-primary focus:ring-primary h-4 w-4"
                        />
                        <span>
                          I acknowledge that I am an authorized representative of subscriber account <strong className="text-foreground">{user?.id}</strong>. I accept the NextLink Global Master Service Agreement, Acceptable Use Policy, and 30-day billing renewal terms.
                        </span>
                      </label>
                    </div>
                  </CardContent>
                </Card>

                <div className="flex items-center justify-between pt-4 border-t">
                  <Button variant="outline" size="sm" onClick={() => setCurrentStep(3)} className="text-xs">
                    <ArrowLeft className="h-3.5 w-3.5 mr-1" />
                    Back
                  </Button>
                  <Button 
                    onClick={() => setCurrentStep(5)} 
                    disabled={!termsAccepted || calculatingOrder || !orderCalculation || Boolean(quoteError)}
                    className="font-bold text-xs gap-1.5 h-10 px-6 shadow-sm"
                  >
                    <span>Proceed to Secure Payment</span>
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}

            {/* ─────────────────────────────────────────────────────────────
                STEP 5: PAYMENT GATEWAY & SERVER EXECUTION
            ───────────────────────────────────────────────────────────── */}
            {currentStep === 5 && (
              <div className="space-y-6 max-w-2xl mx-auto animate-in fade-in">
                <div>
                  <h2 className="text-xl font-bold text-foreground">Step 5: Select Payment Method &amp; Authorize</h2>
                  <p className="text-xs text-muted-foreground">
                    All transactions are encrypted with 256-bit SSL and processed directly through verified carrier payment gateways.
                  </p>
                </div>

                {submitError && (
                  <div className="p-3.5 rounded-xl bg-destructive/10 border border-destructive/30 text-destructive text-xs flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    <span>{submitError}</span>
                  </div>
                )}

                {(!orderCalculation || quoteError) && (
                  <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-700 dark:text-rose-300 flex items-center justify-between gap-3">
                    <span>{quoteError || 'Invoice quote is unavailable. Please retry before authorizing payment.'}</span>
                    <Button type="button" size="sm" variant="outline" onClick={fetchOrderQuote} className="gap-1.5 text-xs">
                      <RefreshCw className="h-3.5 w-3.5" /> Retry
                    </Button>
                  </div>
                )}

                {/* Gateway Options */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  {[
                    { id: 'bkash', label: 'bKash', sub: 'Tokenized API', icon: Smartphone },
                    { id: 'nagad', label: 'Nagad', sub: 'Direct DFS', icon: Smartphone },
                    { id: 'sslcommerz', label: 'SSLCommerz', sub: 'Cards & Banking', icon: CreditCard },
                    { id: 'rocket', label: 'Rocket (DBBL)', sub: 'Aggregator Routed', icon: Globe2 },
                  ].map((gw) => {
                    const Icon = gw.icon
                    const isSelected = selectedGateway === gw.id
                    return (
                      <button
                        key={gw.id}
                        type="button"
                        onClick={() => setSelectedGateway(gw.id as PaymentGateway)}
                        className={`p-3 rounded-xl border-2 text-left transition-all flex flex-col justify-between gap-1.5 ${
                          isSelected
                            ? 'border-primary bg-primary/10 text-primary font-bold shadow-sm'
                            : 'border-border hover:bg-muted/40 text-foreground'
                        }`}
                        data-testid={`purchase-gateway-${gw.id}`}
                      >
                        <div className="flex items-center justify-between">
                          <Icon className="h-5 w-5" />
                          <span className="text-[9px] uppercase px-1 py-0.2 rounded bg-muted/70 text-muted-foreground font-mono">
                            {gw.sub}
                          </span>
                        </div>
                        <span className="text-xs font-bold">{gw.label}</span>
                      </button>
                    )
                  })}
                </div>

                {/* Payment details & Verified Line Items Summary */}
                <Card className="border shadow-sm">
                  <CardContent className="p-5 space-y-4">
                    <div className="space-y-3">
                      <div>
                        <Label className="text-xs">
                          {selectedGateway === 'sslcommerz' ? 'Cardholder Full Name' : `${selectedGateway.toUpperCase()} Account Number`}
                        </Label>
                        <Input
                          placeholder={selectedGateway === 'sslcommerz' ? 'e.g. Alexander Wright' : '+880 1700 000000'}
                          value={selectedGateway === 'sslcommerz' ? cardHolder : mobileWalletNumber}
                          onChange={(e) =>
                            selectedGateway === 'sslcommerz'
                              ? setCardHolder(e.target.value)
                              : setMobileWalletNumber(e.target.value)
                          }
                          className="text-xs font-mono"
                        />
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        {selectedGateway === 'rocket'
                          ? 'You will be redirected to the Rocket checkout session routed via authorized aggregator channel (SSLCommerz / AamarPay). The plan is activated as soon as payment is verified.'
                          : `You will be redirected to the ${selectedGateway === 'sslcommerz' ? 'SSLCommerz' : selectedGateway.toUpperCase()} checkout to authorise the payment. The plan is activated as soon as the gateway confirms it.`}
                      </p>
                    </div>

                    {/* Itemized breakdown on Step 5 matching Step 4 */}
                    {orderCalculation && !quoteError && (
                      <div className="pt-3 border-t space-y-2 text-xs">
                        <div className="flex items-center justify-between pb-1">
                          <span className="font-bold text-foreground">Subscriber Plan Invoice Preview</span>
                          <Badge variant="outline" className="font-mono text-[10px]">
                            {orderCalculation.badge}
                          </Badge>
                        </div>
                        {(orderCalculation.lines || []).map((line, idx) => (
                          <div key={`step5-${line.code}-${idx}`} className="flex justify-between items-center text-muted-foreground">
                            <span>{line.label}</span>
                            <span className="font-mono font-semibold text-foreground">
                              {line.formattedAmount || `${line.prefix || '$'}${Number(line.amount || 0).toFixed(2)}`}
                            </span>
                          </div>
                        ))}
                        <div className="pt-2 border-t flex justify-between items-center">
                          <span className="font-bold text-foreground">Total Payable Amount Now:</span>
                          <span className="font-mono font-black text-lg text-primary">
                            {orderCalculation.formattedTotalPayable || `$${Number(orderCalculation.totalPayable).toFixed(2)}`}
                          </span>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>

                <div className="flex items-center justify-between pt-4 border-t">
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={() => setCurrentStep(4)} 
                    disabled={isSubmittingOrder}
                    className="text-xs"
                  >
                    <ArrowLeft className="h-3.5 w-3.5 mr-1" />
                    Back
                  </Button>
                  <Button
                    onClick={handleExecutePayment}
                    disabled={isSubmittingOrder || calculatingOrder || !orderCalculation || Boolean(quoteError)}
                    className="font-bold text-xs gap-2 h-11 px-8 shadow-md"
                  >
                    {isSubmittingOrder ? (
                      <>
                        <RefreshCw className="h-4 w-4 animate-spin" />
                        <span>Processing &amp; Provisioning...</span>
                      </>
                    ) : (
                      <>
                        <Lock className="h-3.5 w-3.5" />
                        <span>
                          Confirm &amp; Authorize{' '}
                          {orderCalculation
                            ? orderCalculation.formattedTotalPayable ||
                              `$${Number(orderCalculation.totalPayable).toFixed(2)}`
                            : ''}
                        </span>
                      </>
                    )}
                  </Button>
                </div>
              </div>
            )}

            {/* ─────────────────────────────────────────────────────────────
                STEP 6: CONFIRMATION & PRINTABLE INVOICE MODAL
            ───────────────────────────────────────────────────────────── */}
            {currentStep === 6 && confirmedOrder && (
              <div className="space-y-6 max-w-2xl mx-auto animate-in zoom-in-95">
                <Card className="border-2 border-emerald-500/40 shadow-xl overflow-hidden">
                  <div className="bg-emerald-500/10 border-b border-emerald-500/20 p-6 text-center space-y-2">
                    <div className="h-12 w-12 rounded-full bg-emerald-500 text-white flex items-center justify-center mx-auto shadow-md">
                      <Check className="h-6 w-6 stroke-[3]" />
                    </div>
                    <h2 className="text-2xl font-black text-foreground">Order Successfully Authorized!</h2>
                    <p className="text-xs text-muted-foreground max-w-md mx-auto">
                      Your internet package order has been processed by NextLink carrier billing and queued for automated optical provisioning.
                    </p>
                  </div>

                  <CardContent className="p-6 space-y-5">
                    {/* Confirmation Details Grid */}
                    <div className="rounded-xl border bg-muted/30 p-4 space-y-2.5 text-xs font-mono">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Order Identifier:</span>
                        <span className="font-bold text-foreground">{confirmedOrder.orderId}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Transaction Reference:</span>
                        <span className="font-bold text-primary">{confirmedOrder.trxId}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Purchased Package:</span>
                        <span className="font-bold text-foreground">{confirmedOrder.packageName}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Order Classification:</span>
                        <span className="font-semibold text-foreground">
                          {confirmedOrder.purchaseType?.toUpperCase() === 'UPGRADE' ? 'Package Plan Upgrade' : 'Additional Secondary Drop'}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Total Paid:</span>
                        <span className="font-black text-emerald-600 dark:text-emerald-400 text-sm">
                          ${confirmedOrder.totalPayable.toFixed(2)} USD
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Provisioning Status:</span>
                        <Badge className="bg-emerald-500 text-white text-[10px]">
                          {confirmedOrder.orderStatus}
                        </Badge>
                      </div>
                      <div className="flex justify-between pt-1 border-t border-border/50">
                        <span className="text-muted-foreground">Expected Activation:</span>
                        <span className="font-semibold text-foreground">{confirmedOrder.expectedActivationTime}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Purchase Timestamp:</span>
                        <span className="font-semibold text-foreground font-mono">{currentTime.date || '09/11/2026'} · {currentTime.time || '12:00AM'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Session Geolocation:</span>
                        <span className="font-semibold text-foreground">{purchaseLocation.city}, {purchaseLocation.postalCode}, {purchaseLocation.state}, {purchaseLocation.country}</span>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex flex-col sm:flex-row items-center gap-3 pt-2">
                      <Button
                        onClick={() => setInvoiceModalOpen(true)}
                        variant="outline"
                        className="w-full sm:w-auto flex-1 font-bold text-xs gap-1.5 h-10"
                      >
                        <Printer className="h-4 w-4" />
                        <span>View / Print Official Invoice</span>
                      </Button>

                      <Button
                        onClick={() => router.push('/dashboard/orders')}
                        className="w-full sm:w-auto flex-1 font-bold text-xs gap-1.5 h-10"
                      >
                        <FileText className="h-4 w-4" />
                        <span>View My Orders History</span>
                      </Button>
                    </div>

                    <div className="text-center pt-2">
                      <Link 
                        href="/dashboard" 
                        className="text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
                      >
                        Return to Customer Dashboard
                      </Link>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}
          </>
        )}

      </div>

      {/* ─────────────────────────────────────────────────────────────
          PRINTABLE INVOICE MODAL
      ───────────────────────────────────────────────────────────── */}
      {invoiceModalOpen && confirmedOrder && (
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
                  <p className="font-bold text-sm text-foreground mt-0.5">{confirmedOrder.customerName}</p>
                  <p className="text-muted-foreground font-mono">Subscriber ID: {confirmedOrder.customerId}</p>
                  <p className="text-muted-foreground max-w-xs mt-0.5">{confirmedOrder.installationAddress}</p>
                </div>
                <div className="text-right">
                  <span className="text-[10px] uppercase font-bold text-muted-foreground">Official Receipt</span>
                  <p className="font-mono font-bold text-sm text-primary mt-0.5">{confirmedOrder.orderId}</p>
                  <p className="text-muted-foreground font-mono">Date: {currentTime.date || '09/11/2026'} · {currentTime.time || '12:00AM'}</p>
                  <Badge className="bg-emerald-500 text-white text-[10px] mt-1">PAYMENT VERIFIED</Badge>
                </div>
              </div>

              {/* Order Authorization & Provisioning Summary (Matching Step 6 1:1) */}
              <div className="rounded-xl border bg-muted/30 p-4 space-y-2 text-xs font-mono">
                <p className="text-[10px] font-sans font-bold uppercase tracking-wider text-muted-foreground pb-1 border-b border-border/60">
                  Order Authorization &amp; Provisioning Summary
                </p>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Order Identifier:</span>
                  <span className="font-bold text-foreground">{confirmedOrder.orderId}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Transaction Reference:</span>
                  <span className="font-bold text-primary">{confirmedOrder.trxId}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Purchased Package:</span>
                  <span className="font-bold text-foreground">{confirmedOrder.packageName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Order Classification:</span>
                  <span className="font-semibold text-foreground">
                    {confirmedOrder.purchaseType?.toUpperCase() === 'UPGRADE' ? 'Package Plan Upgrade' : 'Additional Secondary Drop'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Total Paid:</span>
                  <span className="font-black text-emerald-600 dark:text-emerald-400">
                    ${confirmedOrder.totalPayable.toFixed(2)} USD
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Provisioning Status:</span>
                  <Badge className="bg-emerald-500 text-white text-[10px]">
                    {confirmedOrder.orderStatus}
                  </Badge>
                </div>
                <div className="flex justify-between pt-1 border-t border-border/50">
                  <span className="text-muted-foreground">Expected Activation:</span>
                  <span className="font-semibold text-foreground">{confirmedOrder.expectedActivationTime}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Purchase Timestamp:</span>
                  <span className="font-semibold text-foreground">{currentTime.date || '09/11/2026'} · {currentTime.time || '12:00AM'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Session Geolocation:</span>
                  <span className="font-semibold text-foreground text-right">{purchaseLocation.city}, {purchaseLocation.postalCode}, {purchaseLocation.state}, {purchaseLocation.country}</span>
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
                    {Array.isArray(confirmedOrder.lines) && confirmedOrder.lines.length > 0 ? (
                      confirmedOrder.lines.map((line, idx) => (
                        <tr key={`inv-line-${idx}`}>
                          <td className="p-3 font-semibold text-foreground">{line.label}</td>
                          <td className="p-3 text-muted-foreground">
                            {confirmedOrder.badge || 'Subscription Charge'}
                          </td>
                          <td className="p-3 text-right font-bold text-foreground">
                            {line.formattedAmount || `$${Number(line.amount || 0).toFixed(2)}`}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td className="p-3 font-semibold text-foreground">
                          NextLink {confirmedOrder.packageLabel || confirmedOrder.packageName} Optical Subscription
                        </td>
                        <td className="p-3 text-muted-foreground">
                          {confirmedOrder.badge || 'New Subscription'}
                        </td>
                        <td className="p-3 text-right font-bold text-foreground">
                          ${confirmedOrder.totalPayable.toFixed(2)}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="flex justify-between items-center pt-2 border-t">
                <div>
                  <p className="text-[11px] text-muted-foreground">Payment Gateway: <strong className="text-foreground capitalize">{confirmedOrder.paymentMethod}</strong></p>
                  <p className="text-[11px] font-mono text-muted-foreground">Trx Ref: {confirmedOrder.trxId}</p>
                </div>
                <div className="text-right">
                  <span className="text-[11px] text-muted-foreground">Total Paid:</span>
                  <p className="text-xl font-black text-emerald-600 dark:text-emerald-400 font-mono">${confirmedOrder.totalPayable.toFixed(2)} USD</p>
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

export default function CustomerPurchasePage() {
  return (
    <Suspense fallback={
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="flex items-center gap-3 text-muted-foreground">
          <RefreshCw className="h-5 w-5 animate-spin text-primary" />
          <span>Loading purchase portal...</span>
        </div>
      </div>
    }>
      <PurchaseContent />
    </Suspense>
  )
}

