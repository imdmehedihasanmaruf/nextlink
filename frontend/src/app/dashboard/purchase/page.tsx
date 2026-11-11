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
import { subscriberAuthHeader } from '@/lib/portalApi'
import { useModalA11y } from '@/lib/useModalA11y'

type PurchaseType = 'UPGRADE' | 'ADDITIONAL'
type PaymentGateway = 'card' | 'payoneer' | 'applepay' | 'bkash' | 'upi'

interface OrderCalculation {
  currentPackage: string
  newPackage: string
  currentPrice: number
  newPrice: number
  proratedAdjustment: number
  installationFee: number
  taxes: number
  discount: number
  totalPayable: number
  nextBillingDate: string
  calculation?: {
    monthlySubscriptionPrice?: number
    remainingCurrentSubscriptionValue?: number
    totalPayableToday?: number
    daysRemainingInCycle?: number
    purchaseType?: string
  }
}

interface ConfirmedOrder {
  orderId: string
  trxId: string
  packageId: string
  packageName: string
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

  // Payment Form State
  const [selectedGateway, setSelectedGateway] = useState<PaymentGateway>('card')
  const [cardNumber, setCardNumber] = useState('4242 •••• •••• 4242')
  const [cardHolder, setCardHolder] = useState('')
  const [cardExpiry, setCardExpiry] = useState('12/28')
  const [cardCvc, setCardCvc] = useState('888')
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
    city: 'Azimpur',
    postalCode: '1205',
    state: 'Dhaka Division',
    country: 'Bangladesh',
    ip: '103.88.24.167',
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
            city: data.city || 'Azimpur',
            postalCode: data.postalCode || '1205',
            state: data.state || 'Dhaka Division',
            country: data.country || 'Bangladesh',
            ip: data.ip || '103.88.24.167',
            isp: data.isp || 'NextLink Optical Fiber',
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

  // Handle pre-selected package query parameter — only once, and never
  // overwrite a plan the visitor picked manually.
  const preselectionApplied = React.useRef(false)

  useEffect(() => {
    if (preselectionApplied.current) return
    if (!packages || packages.length === 0) return
    preselectionApplied.current = true

    if (preselectedPkgId) {
      const matched = packages.find(
        (p) => p.id === preselectedPkgId || p.name.toLowerCase() === preselectedPkgId.toLowerCase(),
      )
      setSelectedPackage(matched || packages[0])
    } else if (!selectedPackage) {
      setSelectedPackage(packages[0])
    }
    // Only the catalogue arriving triggers the one-time preselection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [packages])

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

  // Recalculate order breakdown when package or purchaseType changes
  useEffect(() => {
    if (!selectedPackage || !user) return

    const calculateBreakdown = async () => {
      setCalculatingOrder(true)
      try {
        const res = await fetch('/api/customer/calculate-order', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...subscriberAuthHeader() },
          body: JSON.stringify({
            customerId: user.id,
            packageId: selectedPackage.id,
            purchaseType,
            billingCycle: 'monthly'
          })
        })
        const result = await res.json()
        if (result.success) {
          setOrderCalculation(result)
        }
      } catch (e) {
        console.error('Calculation error:', e)
      } finally {
        setCalculatingOrder(false)
      }
    }

    calculateBreakdown()
  }, [selectedPackage, purchaseType, user])

  // Submit and execute order
  const handleExecutePayment = async () => {
    if (!termsAccepted) {
      setSubmitError('You must agree to NextLink Global Terms of Service and SLA before proceeding.')
      return
    }
    if (!selectedPackage || !user) return

    setIsSubmittingOrder(true)
    setSubmitError(null)

    try {
      const formattedTimestamp = `${currentTime.date || '09/11/2026'} · ${currentTime.time || '12:00PM'}`
      const formattedLocation = `${purchaseLocation.city}, ${purchaseLocation.postalCode}, ${purchaseLocation.state}, ${purchaseLocation.country}`
      const formattedTypeLabel = purchaseType === 'UPGRADE' ? 'Package Plan Upgrade' : 'Additional Secondary Drop'

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
            cardNumber: selectedGateway === 'card' ? cardNumber : undefined,
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

      // Update local auth store user's package if upgrade
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
        purchaseType: result.order.purchase_type,
        totalPayable: Number(result.order.total_payable || 0),
        paymentMethod: result.order.payment_method,
        orderStatus: result.order.order_status,
        expectedActivationTime: result.order.expected_activation_time,
        nextBillingDate: result.order.next_billing_date,
        createdAt: result.order.created_at,
        customerName: user.name,
        customerId: user.id,
        installationAddress: user.address || 'Registered Optical Line Drop'
      })

      setCurrentStep(6) // Step 6: Confirmation
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
                    Current Active: {user?.packageName || user?.package || 'Ultra Gigabit 500'}
                  </Badge>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  {packages.map((pkg) => {
                    const isSelected = selectedPackage?.id === pkg.id
                    return (
                      <div
                        key={pkg.id}
                        onClick={() => setSelectedPackage(pkg)}
                        className={`cursor-pointer rounded-2xl border-2 p-4 transition-all duration-200 flex flex-col justify-between ${
                          isSelected
                            ? 'border-primary ring-2 ring-primary/20 bg-primary/5 shadow-md -translate-y-1'
                            : 'border-border hover:border-border/80 hover:bg-muted/40'
                        }`}
                      >
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="font-mono text-[11px] font-semibold text-muted-foreground">{pkg.id}</span>
                            {isSelected && (
                              <Badge className="bg-primary text-primary-foreground text-[10px] py-0 px-2">
                                SELECTED
                              </Badge>
                            )}
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
                          <Button
                            size="sm"
                            variant={isSelected ? 'default' : 'outline'}
                            className="w-full text-xs font-bold"
                          >
                            {isSelected ? 'Selected' : 'Select Plan'}
                          </Button>
                        </div>
                      </div>
                    )
                  })}
                </div>

                <div className="flex justify-end pt-4 border-t">
                  <Button
                    onClick={() => setCurrentStep(2)}
                    disabled={!selectedPackage}
                    className="font-bold text-xs gap-1.5 px-6 h-10 shadow-sm"
                  >
                    <span>Proceed to Purchase Type</span>
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}

            {/* ─────────────────────────────────────────────────────────────
                STEP 2: PURCHASE TYPE SELECTION
            ───────────────────────────────────────────────────────────── */}
            {currentStep === 2 && (
              <div className="space-y-6 max-w-3xl mx-auto animate-in fade-in">
                <div>
                  <h2 className="text-xl font-bold text-foreground">Select Purchase Type</h2>
                  <p className="text-xs text-muted-foreground">
                    Choose whether to upgrade your existing primary optical connection or deploy a secondary high-speed drop.
                  </p>
                </div>

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
                        <span>Prorated billing adjustment calculated</span>
                      </li>
                      <li className="flex items-center gap-2">
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                        <span><strong>$0.00</strong> Zero optical installation fee</span>
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
                        <span>Fixed installation fee: <strong>$18.00</strong></span>
                      </li>
                      <li className="flex items-center gap-2">
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                        <span>Technician line dispatch scheduled within 24–48 hours</span>
                      </li>
                    </ul>
                  </div>
                </div>

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

                {/* Package Order Invoice Preview */}
                <Card className="border shadow-sm">
                  <CardHeader className="pb-3 border-b">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base font-bold">Package Order Invoice Preview</CardTitle>
                      <Badge variant="outline" className="font-mono text-xs">
                        {purchaseType === 'UPGRADE' ? 'Package Plan Upgrade' : 'Additional Secondary Connection'}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-5 pt-4">
                    {/* Itemized lines */}
                    {calculatingOrder && (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Verifying the order with the billing engine…
                      </div>
                    )}
                    {!calculatingOrder && !orderCalculation && (
                      <div className="p-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-900 dark:text-amber-300">
                        The order has not been verified with the billing engine yet.
                        The totals below are the plan prices — the exact amount will be confirmed before payment.
                      </div>
                    )}
                    <div className="space-y-3 text-xs">
                      {/* Selected plan — the recurring monthly price */}
                      <div className="flex justify-between items-center py-1">
                        <div>
                          <p className="font-bold text-foreground text-sm">{selectedPackage?.name} ({selectedPackage?.speed} Mbps)</p>
                          <p className="text-muted-foreground text-[11px]">Monthly Package Recurring Subscription Fee</p>
                        </div>
                        <span className="font-mono font-black text-base text-foreground">
                          {(orderCalculation ? orderCalculation.newPrice : Number(selectedPackage?.price ?? 0)).toFixed(2)}
                        </span>
                      </div>

                      {/* Remaining days of the old plan are credited (upgrades only) */}
                      {purchaseType === 'UPGRADE' && (
                        <div className="flex justify-between items-center py-1 border-t border-border/50">
                          <div>
                            <p className="font-medium text-foreground">Unused Days of Current Plan (credited)</p>
                            <p className="text-muted-foreground text-[11px]">
                              {orderCalculation?.calculation?.daysRemainingInCycle !== undefined
                                ? `${orderCalculation.calculation.daysRemainingInCycle} of 30 days remaining in the current cycle`
                                : 'Credit for the unused days of the plan you are leaving'}
                            </p>
                          </div>
                          <span className="font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                            −{Number(
                              orderCalculation?.calculation?.remainingCurrentSubscriptionValue ??
                              Math.abs(orderCalculation?.proratedAdjustment ?? 0),
                            ).toFixed(2)}
                          </span>
                        </div>
                      )}

                      {/* Optical Provisioning Fee */}
                      <div className="flex justify-between items-center py-1 border-t border-border/50">
                        <div>
                          <p className="font-medium text-foreground">Carrier Optical Provisioning &amp; Installation Fee</p>
                          <p className="text-muted-foreground text-[11px]">
                            {purchaseType === 'UPGRADE' ? 'Waived for existing customer upgrade' : 'Secondary optical line drop setup'}
                          </p>
                        </div>
                        <span className="font-mono font-semibold text-foreground">
                          {Number(orderCalculation?.installationFee ?? 0).toFixed(2)}
                        </span>
                      </div>

                      {/* Telecom Tax / Regulatory */}
                      <div className="flex justify-between items-center py-1 border-t border-border/50">
                        <div>
                          <p className="font-medium text-foreground">Applicable Telecommunications Tax &amp; Regulatory Surcharge</p>
                          <p className="text-muted-foreground text-[11px]">100% Symmetrical Fiber Regulatory Clearance</p>
                        </div>
                        <span className="font-mono font-semibold text-foreground">
                          {Number(orderCalculation?.taxes ?? 0).toFixed(2)}
                        </span>
                      </div>

                      {/* Total Payable — the server-verified amount */}
                      <div className="flex justify-between items-center py-3 border-t-2 border-border text-sm">
                        <div>
                          <p className="font-black text-foreground text-base">Total Payable Amount Now</p>
                          <p className="text-muted-foreground text-xs">
                            {orderCalculation ? 'Verified by the billing engine · due on the next cycle' : 'Plan price — verification pending'}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-2xl font-black text-primary font-mono">
                            {orderCalculation
                              ? Number(
                                  orderCalculation.calculation?.totalPayableToday ??
                                  orderCalculation.totalPayable,
                                ).toFixed(2)
                              : Number(selectedPackage?.price ?? 0).toFixed(2)}
                          </p>
                          <p className="text-[10px] text-muted-foreground uppercase font-semibold">
                            {orderCalculation ? 'Billing Engine Verified' : 'Plan Price'}
                          </p>
                        </div>
                      </div>
                    </div>

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
                    disabled={!termsAccepted}
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

                {/* Gateway Options */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                  {[
                    { id: 'card', label: 'Credit / Debit Card', icon: CreditCard },
                    { id: 'payoneer', label: 'Payoneer Wallet', icon: Globe2 },
                    { id: 'applepay', label: 'Apple / Google Pay', icon: Smartphone },
                    { id: 'bkash', label: 'bKash Merchant', icon: Smartphone },
                    { id: 'upi', label: 'UPI / Regional', icon: RefreshCw },
                  ].map((gw) => {
                    const Icon = gw.icon
                    const isSelected = selectedGateway === gw.id
                    return (
                      <button
                        key={gw.id}
                        type="button"
                        onClick={() => setSelectedGateway(gw.id as PaymentGateway)}
                        className={`p-3 rounded-xl border-2 text-left transition-all flex flex-col justify-between gap-2 ${
                          isSelected
                            ? 'border-primary bg-primary/10 text-primary font-bold shadow-sm'
                            : 'border-border hover:bg-muted/40 text-foreground'
                        }`}
                      >
                        <Icon className="h-5 w-5" />
                        <span className="text-xs">{gw.label}</span>
                      </button>
                    )
                  })}
                </div>

                {/* Payment Form Fields */}
                <Card className="border shadow-sm">
                  <CardContent className="p-5 space-y-4">
                    {selectedGateway === 'card' && (
                      <div className="space-y-3">
                        <div>
                          <Label className="text-xs">Cardholder Full Name</Label>
                          <Input
                            placeholder="e.g. Alexander Wright"
                            value={cardHolder}
                            onChange={(e) => setCardHolder(e.target.value)}
                            className="mt-1 text-xs"
                          />
                        </div>
                        <div>
                          <Label className="text-xs">Card Number</Label>
                          <Input
                            placeholder="4242 •••• •••• 4242"
                            value={cardNumber}
                            onChange={(e) => setCardNumber(e.target.value)}
                            className="mt-1 text-xs font-mono"
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <Label className="text-xs">Expiration Date</Label>
                            <Input
                              placeholder="MM/YY"
                              value={cardExpiry}
                              onChange={(e) => setCardExpiry(e.target.value)}
                              className="mt-1 text-xs font-mono"
                            />
                          </div>
                          <div>
                            <Label className="text-xs">Security CVV</Label>
                            <Input
                              placeholder="•••"
                              type="password"
                              value={cardCvc}
                              onChange={(e) => setCardCvc(e.target.value)}
                              className="mt-1 text-xs font-mono"
                            />
                          </div>
                        </div>
                      </div>
                    )}

                    {(selectedGateway === 'bkash' || selectedGateway === 'upi' || selectedGateway === 'payoneer') && (
                      <div className="space-y-3">
                        <Label className="text-xs">
                          {selectedGateway === 'bkash' ? 'bKash Mobile Account Number' : selectedGateway === 'upi' ? 'UPI Virtual Payment Address (VPA)' : 'Payoneer Linked Email / ID'}
                        </Label>
                        <Input
                          placeholder={selectedGateway === 'bkash' ? '+880 1700 000000' : selectedGateway === 'upi' ? 'subscriber@okaxis' : 'billing@company.com'}
                          value={mobileWalletNumber}
                          onChange={(e) => setMobileWalletNumber(e.target.value)}
                          className="text-xs font-mono"
                        />
                        <p className="text-[11px] text-muted-foreground">
                          Secure instant authorization will trigger an automated verification challenge on your registered terminal.
                        </p>
                      </div>
                    )}

                    {selectedGateway === 'applepay' && (
                      <div className="text-center py-6 space-y-2">
                        <Smartphone className="h-10 w-10 text-primary mx-auto" />
                        <p className="font-bold text-sm">One-Touch Device Authentication</p>
                        <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                          Clicking confirm will open your device biometric Apple Pay / Google Wallet confirmation sheet.
                        </p>
                      </div>
                    )}

                    {/* Payable summary line */}
                    <div className="pt-3 border-t flex justify-between items-center text-xs">
                      <span className="font-semibold text-muted-foreground">Final Charged Amount:</span>
                      <span className="font-mono font-black text-lg text-primary">
                        {orderCalculation
                          ? Number(
                              orderCalculation.calculation?.totalPayableToday ??
                              orderCalculation.totalPayable,
                            ).toFixed(2)
                          : Number(selectedPackage?.price ?? 0).toFixed(2)}
                      </span>
                    </div>
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
                    disabled={isSubmittingOrder}
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
                            ? Number(
                                orderCalculation.calculation?.totalPayableToday ??
                                orderCalculation.totalPayable,
                              ).toFixed(2)
                            : Number(selectedPackage?.price ?? 0).toFixed(2)}
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
                          USD {confirmedOrder.totalPayable.toFixed(2)}
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

            <CardContent className="p-6 space-y-6 text-xs">
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
                  <p className="text-muted-foreground font-mono">Date: {currentTime.date || '09/11/2026'} ({currentTime.time || '12:00AM'})</p>
                  <p className="text-[10px] text-muted-foreground font-mono">{purchaseLocation.city}, {purchaseLocation.postalCode}, {purchaseLocation.state}, {purchaseLocation.country}</p>
                  <Badge className="bg-emerald-500 text-white text-[10px] mt-1">PAID IN FULL</Badge>
                </div>
              </div>

              {/* Table */}
              <div className="border rounded-xl overflow-hidden">
                <table className="w-full text-left">
                  <thead className="bg-muted/50 border-b text-[11px] font-semibold text-muted-foreground">
                    <tr>
                      <th className="p-3">Description</th>
                      <th className="p-3">Type</th>
                      <th className="p-3 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y font-mono">
                    <tr>
                      <td className="p-3 font-semibold text-foreground">
                        NextLink {confirmedOrder.packageName} Optical Subscription
                      </td>
                      <td className="p-3 text-muted-foreground">
                        {confirmedOrder.purchaseType}
                      </td>
                      <td className="p-3 text-right font-bold text-foreground">
                        USD {confirmedOrder.totalPayable.toFixed(2)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="flex justify-between items-center pt-2 border-t">
                <div>
                  <p className="text-[11px] text-muted-foreground">Payment Gateway: <strong className="text-foreground capitalize">{confirmedOrder.paymentMethod}</strong></p>
                  <p className="text-[11px] font-mono text-muted-foreground">Trx Ref: {confirmedOrder.trxId}</p>
                </div>
                <div className="text-right">
                  <span className="text-[11px] text-muted-foreground">Grand Total:</span>
                  <p className="text-xl font-black text-foreground font-mono">USD {confirmedOrder.totalPayable.toFixed(2)}</p>
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

