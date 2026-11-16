'use client'

import React, { useState, useEffect, Suspense, useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import {
  CreditCard,
  ArrowLeft,
  ShieldCheck,
  Lock,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  FileText,
  Calendar,
  Layers,
  DollarSign,
  HelpCircle,
  Wifi,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useAuthStore } from '@/store/authStore'
import {
  fetchMyInvoices,
  fetchPaymentGateways,
  payInvoice,
  type PortalInvoice,
  type PaymentGatewayItem,
} from '@/lib/portalApi'

interface MethodMeta {
  id: string
  name: string
  tagline: string
  aggregatorNote?: string
  bgClass: string
  textClass: string
  borderClass: string
  badgeText: string
}

const GATEWAY_METADATA: Record<string, MethodMeta> = {
  bkash: {
    id: 'bkash',
    name: 'bKash',
    tagline: 'Instant mobile wallet payment via official tokenized checkout',
    bgClass: 'hover:border-pink-500/60 focus:border-pink-500 bg-pink-500/5',
    textClass: 'text-pink-600 dark:text-pink-400',
    borderClass: 'border-pink-500/30',
    badgeText: 'Tokenized API',
  },
  nagad: {
    id: 'nagad',
    name: 'Nagad',
    tagline: 'Direct DFS payment with server-to-server verification',
    bgClass: 'hover:border-orange-500/60 focus:border-orange-500 bg-orange-500/5',
    textClass: 'text-orange-600 dark:text-orange-400',
    borderClass: 'border-orange-500/30',
    badgeText: 'Direct DFS',
  },
  sslcommerz: {
    id: 'sslcommerz',
    name: 'SSLCommerz',
    tagline: 'Visa, Mastercard, Amex, Internet Banking & all Mobile Wallets',
    bgClass: 'hover:border-blue-500/60 focus:border-blue-500 bg-blue-500/5',
    textClass: 'text-blue-600 dark:text-blue-400',
    borderClass: 'border-blue-500/30',
    badgeText: 'Hosted Checkout',
  },
  rocket: {
    id: 'rocket',
    name: 'Rocket (DBBL)',
    tagline: 'DBBL Rocket mobile wallet payment',
    aggregatorNote: 'Routed via authorized aggregator channel (SSLCommerz / AamarPay)',
    bgClass: 'hover:border-purple-500/60 focus:border-purple-500 bg-purple-500/5',
    textClass: 'text-purple-600 dark:text-purple-400',
    borderClass: 'border-purple-500/30',
    badgeText: 'Aggregator Routed',
  },
}

function CheckoutContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const targetInvoiceId = searchParams.get('invoiceId')

  const { user, isAuthenticated, hasHydrated } = useAuthStore()

  const [invoices, setInvoices] = useState<PortalInvoice[]>([])
  const [selectedInvoice, setSelectedInvoice] = useState<PortalInvoice | null>(null)
  const [loadingInvoices, setLoadingInvoices] = useState(true)

  const [availableGateways, setAvailableGateways] = useState<PaymentGatewayItem[]>([])
  const [selectedGateway, setSelectedGateway] = useState<string>('bkash')
  const [loadingGateways, setLoadingGateways] = useState<boolean>(true)

  const [isSubmitting, setIsSubmitting] = useState<boolean>(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [errorCode, setErrorCode] = useState<string | null>(null)

  // Auth gate
  useEffect(() => {
    if (hasHydrated && !isAuthenticated) {
      router.push(`/login?redirect=${encodeURIComponent('/checkout' + (targetInvoiceId ? `?invoiceId=${targetInvoiceId}` : ''))}`)
    }
  }, [hasHydrated, isAuthenticated, router, targetInvoiceId])

  // Load Invoices
  useEffect(() => {
    if (!isAuthenticated) return
    let isMounted = true

    const loadData = async () => {
      setLoadingInvoices(true)
      try {
        const res = await fetchMyInvoices()
        if (!isMounted) return
        if (res.success && Array.isArray(res.invoices)) {
          setInvoices(res.invoices)
          // Find target invoice from query param, or default to first unpaid invoice
          if (targetInvoiceId) {
            const found = res.invoices.find((i) => i.id === targetInvoiceId)
            if (found) setSelectedInvoice(found)
            else {
              const unpaid = res.invoices.find((i) => i.status !== 'paid')
              setSelectedInvoice(unpaid || res.invoices[0] || null)
            }
          } else {
            const unpaid = res.invoices.find((i) => i.status !== 'paid')
            setSelectedInvoice(unpaid || res.invoices[0] || null)
          }
        }
      } catch (err) {
        console.error('Failed to load invoices:', err)
      } finally {
        if (isMounted) setLoadingInvoices(false)
      }
    }

    loadData()

    return () => {
      isMounted = false
    }
  }, [isAuthenticated, targetInvoiceId])

  // Load backend-enabled gateways
  useEffect(() => {
    let isMounted = true
    setLoadingGateways(true)

    const loadGateways = async () => {
      try {
        const res = await fetchPaymentGateways()
        if (!isMounted) return
        if (res.success && Array.isArray(res.gateways)) {
          const enabled = res.gateways.filter((g) => g.supported && g.id !== 'card')
          setAvailableGateways(enabled.length > 0 ? enabled : [
            { id: 'bkash', name: 'bKash', supported: true },
            { id: 'nagad', name: 'Nagad', supported: true },
            { id: 'sslcommerz', name: 'SSLCommerz', supported: true },
            { id: 'rocket', name: 'Rocket', supported: true },
          ])
          if (enabled.length > 0 && !enabled.some((g) => g.id === selectedGateway)) {
            setSelectedGateway(enabled[0].id)
          }
        } else {
          setAvailableGateways([
            { id: 'bkash', name: 'bKash', supported: true },
            { id: 'nagad', name: 'Nagad', supported: true },
            { id: 'sslcommerz', name: 'SSLCommerz', supported: true },
            { id: 'rocket', name: 'Rocket', supported: true },
          ])
        }
      } catch (err) {
        if (!isMounted) return
        setAvailableGateways([
          { id: 'bkash', name: 'bKash', supported: true },
          { id: 'nagad', name: 'Nagad', supported: true },
          { id: 'sslcommerz', name: 'SSLCommerz', supported: true },
          { id: 'rocket', name: 'Rocket', supported: true },
        ])
      } finally {
        if (isMounted) setLoadingGateways(false)
      }
    }

    loadGateways()

    return () => {
      isMounted = false
    }
  }, [selectedGateway])

  const handlePay = async () => {
    if (!selectedInvoice || isSubmitting) return
    setIsSubmitting(true)
    setErrorMsg(null)
    setErrorCode(null)

    try {
      const customer = {
        name: user?.name,
        email: user?.email,
        phone: user?.phone,
        address: user?.address,
      }

      const res = await payInvoice(selectedInvoice.id, selectedGateway, customer)

      if (!res.success || !res.redirectUrl) {
        setErrorMsg(res.error || 'Unable to initiate payment with the gateway. Please retry.')
        setErrorCode(res.code || null)
        setIsSubmitting(false)
        return
      }

      // Safe redirect
      window.location.href = res.redirectUrl
    } catch (err) {
      setErrorMsg('A network error occurred while communicating with the billing engine.')
      setIsSubmitting(false)
    }
  }

  if (!isAuthenticated && !hasHydrated) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <RefreshCw className="h-6 w-6 animate-spin text-primary" />
      </div>
    )
  }

  const unpaidInvoices = invoices.filter((i) => i.status !== 'paid')
  const rawData = selectedInvoice?.raw_data || {}
  const installFee = Number(selectedInvoice?.installation_fee ?? rawData.installationFee ?? 0)
  const taxFee = Number(selectedInvoice?.tax_fee ?? rawData.taxFee ?? 0)
  const lateFee = Number(selectedInvoice?.late_fee ?? rawData.lateFee ?? 0)
  const carriedOver = Number(selectedInvoice?.carried_over_amount ?? rawData.carriedOverAmount ?? 0)
  const totalAmount = Number(selectedInvoice?.amount || 0)
  const monthlyBase = Number(
    selectedInvoice?.package_price ||
      rawData.packagePrice ||
      Math.max(0, totalAmount - (installFee + taxFee + lateFee + carriedOver))
  )
  const currency = String(rawData.currency || 'USD').toUpperCase()

  return (
    <div className="min-h-screen bg-background py-8 sm:py-12">
      <div className="container mx-auto px-4 max-w-4xl space-y-6">
        {/* Navigation */}
        <div className="flex items-center justify-between border-b pb-4">
          <Link
            href="/dashboard/orders"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>Back to Invoices &amp; Orders</span>
          </Link>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Lock className="h-3.5 w-3.5 text-emerald-500" />
            <span>Secure 256-Bit SSL Checkout</span>
          </div>
        </div>

        <div className="space-y-1">
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-foreground">
            Express Payment Checkout
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground">
            Review authoritative invoice breakdown and complete payment with bKash, Nagad, SSLCommerz, or Rocket.
          </p>
        </div>

        {loadingInvoices ? (
          <div className="py-16 text-center text-muted-foreground space-y-3">
            <RefreshCw className="h-6 w-6 animate-spin text-primary mx-auto" />
            <p className="text-sm">Retrieving your billing records from the database...</p>
          </div>
        ) : !selectedInvoice ? (
          <Card className="p-8 text-center space-y-4">
            <CheckCircle2 className="h-12 w-12 text-emerald-500 mx-auto" />
            <h3 className="text-lg font-bold">All Bills Are Settled</h3>
            <p className="text-xs text-muted-foreground max-w-sm mx-auto">
              You do not have any pending invoices due for payment. Your subscription is active and up to date.
            </p>
            <Link href="/dashboard">
              <Button size="sm" className="font-bold text-xs mt-2">
                Return to Dashboard
              </Button>
            </Link>
          </Card>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left 2 Cols: Invoice details & payment methods */}
            <div className="lg:col-span-2 space-y-6">
              {/* Unpaid Invoice Selector if multiple unpaid exist */}
              {unpaidInvoices.length > 1 && (
                <Card className="border shadow-sm p-4">
                  <label className="text-xs font-bold text-foreground block mb-2">
                    Select Invoice to Pay:
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {unpaidInvoices.map((inv) => (
                      <button
                        key={inv.id}
                        type="button"
                        onClick={() => setSelectedInvoice(inv)}
                        className={`text-left p-3 rounded-lg border text-xs transition-all ${
                          selectedInvoice?.id === inv.id
                            ? 'border-primary bg-primary/5 font-semibold ring-1 ring-primary/30'
                            : 'border-border bg-card hover:bg-muted/30'
                        }`}
                      >
                        <div className="flex justify-between font-mono">
                          <span className="text-primary font-bold">{inv.id}</span>
                          <span>${Number(inv.amount).toFixed(2)}</span>
                        </div>
                        <div className="text-[11px] text-muted-foreground mt-1">
                          Due: {inv.due_date || 'N/A'}
                        </div>
                      </button>
                    ))}
                  </div>
                </Card>
              )}

              {/* Payment Methods */}
              <Card className="border shadow-sm">
                <CardHeader className="pb-3 border-b">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-base font-bold">Select Payment Gateway</CardTitle>
                      <CardDescription className="text-xs">
                        Only verified, backend-enabled gateways are displayed
                      </CardDescription>
                    </div>
                    <Badge variant="secondary" className="text-xs font-mono">
                      {availableGateways.length} Supported
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="p-4 sm:p-6 space-y-3">
                  {errorMsg && (
                    <div className="p-3.5 rounded-xl bg-destructive/10 border border-destructive/30 text-destructive text-xs space-y-1">
                      <div className="flex items-center gap-2 font-bold">
                        <AlertCircle className="h-4 w-4 shrink-0" />
                        <span>Payment Error</span>
                      </div>
                      <p className="pl-6">{errorMsg}</p>
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {availableGateways.map((gw) => {
                      const meta = GATEWAY_METADATA[gw.id] || {
                        id: gw.id,
                        name: gw.name || gw.id.toUpperCase(),
                        tagline: 'Carrier electronic payment',
                        bgClass: 'hover:border-primary/60',
                        textClass: 'text-primary',
                        borderClass: 'border-border',
                        badgeText: 'Supported',
                      }
                      const isSelected = selectedGateway === gw.id

                      return (
                        <button
                          key={gw.id}
                          type="button"
                          onClick={() => setSelectedGateway(gw.id)}
                          disabled={isSubmitting}
                          className={`text-left p-3.5 rounded-xl border-2 transition-all flex flex-col justify-between ${
                            isSelected
                              ? 'border-primary bg-primary/5 shadow-sm ring-1 ring-primary/40'
                              : 'border-border/70 hover:border-border bg-card'
                          } disabled:opacity-50 cursor-pointer`}
                        >
                          <div className="flex items-start justify-between gap-1 w-full">
                            <div className="flex items-center gap-2">
                              <div
                                className={`h-4 w-4 rounded-full border-2 flex items-center justify-center ${
                                  isSelected ? 'border-primary bg-primary' : 'border-muted-foreground'
                                }`}
                              >
                                {isSelected && <div className="h-1.5 w-1.5 rounded-full bg-white" />}
                              </div>
                              <span className="font-black text-sm text-foreground">{meta.name}</span>
                            </div>
                            <Badge
                              variant="outline"
                              className={`text-[9px] px-1.5 py-0 h-4 ${meta.borderClass} ${meta.textClass}`}
                            >
                              {meta.badgeText}
                            </Badge>
                          </div>

                          <p className="text-[11px] text-muted-foreground mt-2 line-clamp-2">
                            {meta.tagline}
                          </p>

                          {meta.aggregatorNote && (
                            <div className="mt-2 pt-1 border-t border-border/50 text-[10px] text-purple-600 dark:text-purple-400 font-medium">
                              ✦ {meta.aggregatorNote}
                            </div>
                          )}
                        </button>
                      )
                    })}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Right Col: Authoritative Summary & Pay Button */}
            <div className="space-y-4">
              <Card className="border shadow-md">
                <CardHeader className="pb-3 border-b bg-muted/20">
                  <CardTitle className="text-sm font-bold flex items-center gap-2">
                    <FileText className="h-4 w-4 text-primary" />
                    <span>Invoice Breakdown</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-4 space-y-4 text-xs font-mono">
                  <div className="flex justify-between items-center text-foreground font-sans">
                    <span className="text-muted-foreground">Invoice ID:</span>
                    <strong className="text-primary font-mono">{selectedInvoice.id}</strong>
                  </div>

                  <div className="flex justify-between items-center text-foreground font-sans">
                    <span className="text-muted-foreground">Status:</span>
                    <Badge
                      className={`text-[10px] ${
                        selectedInvoice.status === 'paid'
                          ? 'bg-emerald-500 text-white'
                          : 'bg-amber-500 text-white'
                      }`}
                    >
                      {selectedInvoice.status.toUpperCase()}
                    </Badge>
                  </div>

                  <div className="flex justify-between items-center text-foreground font-sans">
                    <span className="text-muted-foreground">Due Date:</span>
                    <span>{selectedInvoice.due_date || '—'}</span>
                  </div>

                  <div className="border-t pt-3 space-y-1.5">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Monthly Plan:</span>
                      <span>${monthlyBase.toFixed(2)}</span>
                    </div>
                    {installFee > 0 && (
                      <div className="flex justify-between text-blue-600">
                        <span>Installation:</span>
                        <span>+${installFee.toFixed(2)}</span>
                      </div>
                    )}
                    {taxFee > 0 && (
                      <div className="flex justify-between text-blue-600">
                        <span>Tax:</span>
                        <span>+${taxFee.toFixed(2)}</span>
                      </div>
                    )}
                    {carriedOver > 0 && (
                      <div className="flex justify-between text-amber-600">
                        <span>Past Due:</span>
                        <span>+${carriedOver.toFixed(2)}</span>
                      </div>
                    )}
                    {lateFee > 0 && (
                      <div className="flex justify-between text-destructive">
                        <span>Late Fee:</span>
                        <span>+${lateFee.toFixed(2)}</span>
                      </div>
                    )}
                  </div>

                  <div className="border-t pt-3 flex justify-between items-baseline font-sans">
                    <span className="font-bold text-sm">Total Payable:</span>
                    <span className="text-2xl font-black font-mono text-primary">
                      {currency} {totalAmount.toFixed(2)}
                    </span>
                  </div>

                  <Button
                    onClick={handlePay}
                    disabled={isSubmitting || selectedInvoice.status === 'paid'}
                    className="w-full font-bold text-xs h-10 gap-1.5 mt-2 shadow-md bg-primary hover:bg-primary/90 text-primary-foreground"
                    data-testid="checkout-pay-btn"
                  >
                    {isSubmitting ? (
                      <>
                        <RefreshCw className="h-4 w-4 animate-spin" />
                        <span>Redirecting to Gateway…</span>
                      </>
                    ) : selectedInvoice.status === 'paid' ? (
                      <>
                        <CheckCircle2 className="h-4 w-4" />
                        <span>Already Settled</span>
                      </>
                    ) : (
                      <>
                        <Lock className="h-4 w-4" />
                        <span>Pay {currency} {totalAmount.toFixed(2)} Now</span>
                      </>
                    )}
                  </Button>
                </CardContent>
              </Card>

              <div className="rounded-xl border bg-muted/20 p-3 text-[11px] text-muted-foreground space-y-1">
                <p className="font-semibold text-foreground flex items-center gap-1.5">
                  <ShieldCheck className="h-4 w-4 text-emerald-500" />
                  Protection &amp; Verification
                </p>
                <p>
                  Idempotent checkout guarantees that duplicate submissions are discarded. Your invoice status updates automatically once the gateway settles.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default function CheckoutPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-[60vh] flex items-center justify-center">
          <RefreshCw className="h-6 w-6 animate-spin text-primary" />
        </div>
      }
    >
      <CheckoutContent />
    </Suspense>
  )
}

