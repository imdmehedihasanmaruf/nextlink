'use client'

import React, { useState, useEffect, useCallback } from 'react'
import {
  CreditCard,
  ShieldCheck,
  AlertCircle,
  AlertTriangle,
  RefreshCw,
  X,
  ExternalLink,
  Lock,
  ArrowRight,
  CheckCircle2,
  Clock,
  Layers,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useAuthStore } from '@/store/authStore'
import {
  fetchPaymentGateways,
  payInvoice,
  type PortalInvoice,
  type PaymentGatewayItem,
} from '@/lib/portalApi'
import { useModalA11y } from '@/lib/useModalA11y'

interface PaymentModalProps {
  invoice: PortalInvoice | null
  open: boolean
  onClose: () => void
  onSuccess?: () => void
}

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

export function PaymentModal({ invoice, open, onClose, onSuccess }: PaymentModalProps) {
  const { user } = useAuthStore()

  const [availableGateways, setAvailableGateways] = useState<PaymentGatewayItem[]>([])
  const [selectedGateway, setSelectedGateway] = useState<string>('bkash')
  const [loadingGateways, setLoadingGateways] = useState<boolean>(true)
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [errorCode, setErrorCode] = useState<string | null>(null)

  useModalA11y(open, onClose)

  // Load backend-enabled gateways dynamically from GET /api/payments/gateways
  useEffect(() => {
    if (!open) return
    let isMounted = true
    setLoadingGateways(true)
    setErrorMsg(null)
    setErrorCode(null)

    const loadGateways = async () => {
      try {
        const res = await fetchPaymentGateways()
        if (!isMounted) return
        if (res.success && Array.isArray(res.gateways)) {
          // Filter to only backend-enabled and supported payment methods
          const enabled = res.gateways.filter((g) => g.supported && g.id !== 'card')
          setAvailableGateways(enabled.length > 0 ? enabled : [
            { id: 'bkash', name: 'bKash', supported: true, method: 'tokenized-checkout' },
            { id: 'nagad', name: 'Nagad', supported: true, method: 'redirect' },
            { id: 'sslcommerz', name: 'SSLCommerz', supported: true, method: 'hosted-checkout' },
            { id: 'rocket', name: 'Rocket', supported: true, method: 'tokenized-checkout' },
          ])
          if (enabled.length > 0 && !enabled.some((g) => g.id === selectedGateway)) {
            setSelectedGateway(enabled[0].id)
          }
        } else {
          // Fallback to supported standard list if backend responds without gateway list
          setAvailableGateways([
            { id: 'bkash', name: 'bKash', supported: true },
            { id: 'nagad', name: 'Nagad', supported: true },
            { id: 'sslcommerz', name: 'SSLCommerz', supported: true },
            { id: 'rocket', name: 'Rocket', supported: true },
          ])
        }
      } catch (err) {
        if (!isMounted) return
        // Network fallback
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
  }, [open, selectedGateway])

  // Idempotent checkout initiation
  const handleInitiatePayment = async () => {
    if (!invoice || isSubmitting) return
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

      const res = await payInvoice(invoice.id, selectedGateway, customer)

      if (!res.success || !res.redirectUrl) {
        const errorText = res.error || 'Failed to initiate secure checkout session. Please try again.'
        setErrorMsg(errorText)
        setErrorCode(res.code || null)
        setIsSubmitting(false)
        return
      }

      // Safe redirect to external or hosted gateway checkout
      window.location.href = res.redirectUrl
    } catch (err: any) {
      console.error('Payment checkout initiation failed:', err)
      setErrorMsg('A network error occurred while contacting the billing gateway. Please check your connection and retry.')
      setIsSubmitting(false)
    }
  }

  if (!open || !invoice) return null

  // Authoritative invoice breakdown
  const rawData = invoice.raw_data || {}
  const installFee = Number(invoice.installation_fee ?? rawData.installationFee ?? 0)
  const taxFee = Number(invoice.tax_fee ?? rawData.taxFee ?? 0)
  const lateFee = Number(invoice.late_fee ?? rawData.lateFee ?? 0)
  const carriedOver = Number(invoice.carried_over_amount ?? rawData.carriedOverAmount ?? 0)
  const totalAmount = Number(invoice.amount || 0)
  const monthlyBase = Number(
    invoice.package_price ||
      rawData.packagePrice ||
      Math.max(0, totalAmount - (installFee + taxFee + lateFee + carriedOver))
  )
  const currency = String(rawData.currency || 'USD').toUpperCase()
  const packageName = invoice.package_name || rawData.packageName || 'Optical Fiber Plan'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-label="Secure invoice checkout"
    >
      <Card className="w-full max-w-xl bg-card border shadow-2xl animate-in zoom-in-95 my-8">
        <CardHeader className="border-b pb-4 flex flex-row items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-primary text-primary-foreground flex items-center justify-center shadow-md">
              <CreditCard className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="text-base sm:text-lg font-black text-foreground">
                Secure Invoice Checkout
              </CardTitle>
              <CardDescription className="text-xs">
                NextLink Authorized Billing Gateway · 256-Bit SSL Encrypted
              </CardDescription>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="p-1.5 rounded-full hover:bg-muted text-muted-foreground transition-colors disabled:opacity-50"
            aria-label="Close checkout modal"
          >
            <X size={18} />
          </button>
        </CardHeader>

        <CardContent className="p-5 sm:p-6 space-y-5 text-xs sm:text-sm">
          {/* Authoritative Invoice Summary Card */}
          <div className="rounded-xl border bg-muted/30 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-2">
              <div>
                <span className="text-[10px] uppercase font-bold text-muted-foreground block">
                  Invoice Number
                </span>
                <span className="font-mono font-black text-sm text-primary">{invoice.id}</span>
              </div>
              <div className="text-right">
                <span className="text-[10px] uppercase font-bold text-muted-foreground block">
                  Due Date
                </span>
                <span className="font-mono text-xs text-foreground">
                  {invoice.due_date || 'Standard Billing Period'}
                </span>
              </div>
            </div>

            {/* Itemized Line Items */}
            <div className="space-y-1.5 pt-1 text-xs font-mono">
              <div className="flex justify-between items-center text-foreground">
                <span>Monthly Fiber Plan ({packageName}):</span>
                <span className="font-bold">${monthlyBase.toFixed(2)}</span>
              </div>
              {installFee > 0 && (
                <div className="flex justify-between items-center text-blue-600 dark:text-blue-400">
                  <span>One-Time Installation Fee:</span>
                  <span>+${installFee.toFixed(2)}</span>
                </div>
              )}
              {taxFee > 0 && (
                <div className="flex justify-between items-center text-blue-600 dark:text-blue-400">
                  <span>Telecommunications Regulatory Tax:</span>
                  <span>+${taxFee.toFixed(2)}</span>
                </div>
              )}
              {carriedOver > 0 && (
                <div className="flex justify-between items-center text-amber-600 dark:text-amber-400">
                  <span>Carried Over Previous Due:</span>
                  <span>+${carriedOver.toFixed(2)}</span>
                </div>
              )}
              {lateFee > 0 && (
                <div className="flex justify-between items-center text-destructive">
                  <span>Late Assessment Fee:</span>
                  <span>+${lateFee.toFixed(2)}</span>
                </div>
              )}
            </div>

            <div className="border-t pt-2.5 flex items-baseline justify-between">
              <div>
                <span className="text-xs font-bold text-foreground">Total Authoritative Amount</span>
                <span className="text-[10px] text-muted-foreground block">Verified by Express Billing Engine</span>
              </div>
              <div className="text-right">
                <span className="text-xl sm:text-2xl font-black font-mono text-primary">
                  {currency} {totalAmount.toFixed(2)}
                </span>
              </div>
            </div>
          </div>

          {/* Error / Closed Window Alert */}
          {errorMsg && (
            <div className="p-3.5 rounded-xl bg-destructive/10 border border-destructive/30 text-destructive text-xs space-y-1 animate-in fade-in">
              <div className="flex items-center gap-2 font-bold">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>Payment Request Failed</span>
              </div>
              <p className="pl-6 leading-relaxed">{errorMsg}</p>
              {errorCode === 'PAYMENT_WINDOW_CLOSED' && (
                <p className="pl-6 text-[11px] opacity-80">
                  Monthly bill payments are accepted during the active billing window. Please contact support if you require an extension.
                </p>
              )}
            </div>
          )}

          {/* Payment Method Selector */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-foreground uppercase tracking-wider">
                Select Payment Method
              </label>
              <span className="text-[10px] text-muted-foreground">
                Showing backend-verified gateways
              </span>
            </div>

            {loadingGateways ? (
              <div className="py-6 text-center text-muted-foreground space-y-2">
                <RefreshCw className="h-4 w-4 animate-spin text-primary mx-auto" />
                <p className="text-xs">Querying available payment gateways...</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {availableGateways.map((gw) => {
                  const meta = GATEWAY_METADATA[gw.id] || {
                    id: gw.id,
                    name: gw.name || gw.id.toUpperCase(),
                    tagline: 'Secure carrier electronic payment',
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
                      className={`text-left p-3 rounded-xl border-2 transition-all relative flex flex-col justify-between ${
                        isSelected
                          ? `border-primary bg-primary/5 shadow-sm ring-1 ring-primary/40`
                          : `border-border/70 hover:border-border bg-card hover:bg-muted/30`
                      } disabled:opacity-50 cursor-pointer`}
                      data-testid={`gateway-option-${gw.id}`}
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
            )}
          </div>

          {/* Trust & Idempotency Guarantee Footer */}
          <div className="rounded-lg bg-muted/40 p-3 flex items-center gap-2.5 text-[11px] text-muted-foreground border">
            <Lock className="h-4 w-4 text-emerald-500 shrink-0" />
            <span>
              Transactions are protected with double-click idempotency and server-side verification. You will be redirected to complete payment securely.
            </span>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-col-reverse sm:flex-row items-center justify-end gap-2.5 pt-2 border-t">
            <Button
              variant="outline"
              onClick={onClose}
              disabled={isSubmitting}
              className="w-full sm:w-auto text-xs h-9"
            >
              Cancel
            </Button>

            <Button
              onClick={handleInitiatePayment}
              disabled={isSubmitting || loadingGateways || availableGateways.length === 0}
              className="w-full sm:w-auto font-bold text-xs h-9 gap-1.5 shadow-md bg-primary hover:bg-primary/90 text-primary-foreground"
              data-testid="confirm-payment-btn"
            >
              {isSubmitting ? (
                <>
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  <span>Connecting to Gateway…</span>
                </>
              ) : (
                <>
                  <Lock className="h-3.5 w-3.5" />
                  <span>Proceed to Pay {currency} {totalAmount.toFixed(2)}</span>
                  <ArrowRight className="h-3.5 w-3.5 ml-1" />
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

