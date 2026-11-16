'use client'

import React, { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  CheckCircle2,
  Clock,
  AlertTriangle,
  XCircle,
  RefreshCw,
  ArrowRight,
  Download,
  FileText,
  CreditCard,
  ShieldCheck,
  Home,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  downloadInvoicePdf,
  fetchMyInvoices,
  verifyPaymentTransaction,
  type PortalInvoice,
} from '@/lib/portalApi'

export type PaymentStatusType = 'success' | 'pending' | 'failed' | 'cancelled' | 'verifying'

interface PaymentResultScreenProps {
  initialStatus?: PaymentStatusType
  invoiceId?: string | null
  transactionId?: string | null
  gateway?: string | null
  amount?: string | number | null
  errorMessage?: string | null
}

export function PaymentResultScreen({
  initialStatus = 'success',
  invoiceId,
  transactionId,
  gateway,
  amount,
  errorMessage,
}: PaymentResultScreenProps) {
  const router = useRouter()
  const [status, setStatus] = useState<PaymentStatusType>(initialStatus)
  const [isVerifying, setIsVerifying] = useState(false)
  const [verificationNote, setVerificationNote] = useState<string | null>(null)
  const [downloadingPdf, setDownloadingPdf] = useState(false)
  const [invoice, setInvoice] = useState<PortalInvoice | null>(null)

  // Load invoice if invoiceId provided
  useEffect(() => {
    if (!invoiceId) return
    let isMounted = true

    const loadInvoice = async () => {
      try {
        const res = await fetchMyInvoices()
        if (!isMounted) return
        if (res.success && Array.isArray(res.invoices)) {
          const match = res.invoices.find((i) => i.id === invoiceId)
          if (match) {
            setInvoice(match)
            if (match.status === 'paid' && status !== 'success') {
              setStatus('success')
            }
          }
        }
      } catch (e) {
        // quiet error
      }
    }

    loadInvoice()
    return () => {
      isMounted = false
    }
  }, [invoiceId, status])

  const handleManualVerification = async () => {
    if (!transactionId && !invoiceId) return
    setIsVerifying(true)
    setVerificationNote(null)

    try {
      if (gateway && transactionId) {
        const verifyRes = await verifyPaymentTransaction(gateway, transactionId)
        if (verifyRes.success && verifyRes.status === 'success') {
          setStatus('success')
          setVerificationNote('Transaction successfully confirmed and settled by the payment gateway!')
          setIsVerifying(false)
          return
        }
      }

      // Check current invoice status from backend
      const res = await fetchMyInvoices()
      if (res.success && Array.isArray(res.invoices)) {
        const match = res.invoices.find((i) => i.id === invoiceId)
        if (match && match.status === 'paid') {
          setStatus('success')
          setVerificationNote('Invoice has been confirmed as paid in full!')
        } else {
          setVerificationNote('Gateway settlement is still processing. Please allow up to 60 seconds.')
        }
      } else {
        setVerificationNote('Unable to verify transaction state right now. Please check back shortly.')
      }
    } catch {
      setVerificationNote('Network error checking verification status. Please try again.')
    } finally {
      setIsVerifying(false)
    }
  }

  const handleDownloadPdf = async () => {
    if (!invoiceId) return
    setDownloadingPdf(true)
    await downloadInvoicePdf(invoiceId)
    setDownloadingPdf(false)
  }

  const displayAmount = amount || invoice?.amount || '—'
  const displayGateway = (gateway || invoice?.raw_data?.gateway || 'Carrier MFS / Card Gateway').toUpperCase()

  return (
    <div className="min-h-screen bg-background py-12 sm:py-20 flex items-center justify-center">
      <div className="container mx-auto px-4 max-w-lg">
        <Card className="border shadow-2xl overflow-hidden animate-in zoom-in-95">
          {/* Top Decorative Header */}
          <div
            className={`p-6 text-center ${
              status === 'success'
                ? 'bg-emerald-500/10 border-b border-emerald-500/20'
                : status === 'pending' || status === 'verifying'
                  ? 'bg-amber-500/10 border-b border-amber-500/20'
                  : status === 'cancelled'
                    ? 'bg-muted/60 border-b border-border'
                    : 'bg-destructive/10 border-b border-destructive/20'
            }`}
          >
            <div className="mx-auto mb-3 flex items-center justify-center">
              {status === 'success' && (
                <div className="h-16 w-16 rounded-full bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 flex items-center justify-center animate-in zoom-in">
                  <CheckCircle2 size={36} className="stroke-[2.5]" />
                </div>
              )}
              {(status === 'pending' || status === 'verifying') && (
                <div className="h-16 w-16 rounded-full bg-amber-500/20 text-amber-600 dark:text-amber-400 flex items-center justify-center animate-in zoom-in">
                  <Clock size={36} className="stroke-[2.5]" />
                </div>
              )}
              {status === 'failed' && (
                <div className="h-16 w-16 rounded-full bg-destructive/20 text-destructive flex items-center justify-center animate-in zoom-in">
                  <AlertTriangle size={36} className="stroke-[2.5]" />
                </div>
              )}
              {status === 'cancelled' && (
                <div className="h-16 w-16 rounded-full bg-muted text-muted-foreground flex items-center justify-center animate-in zoom-in">
                  <XCircle size={36} className="stroke-[2.5]" />
                </div>
              )}
            </div>

            <h1 className="text-xl sm:text-2xl font-black tracking-tight text-foreground">
              {status === 'success' && 'Payment Completed Successfully'}
              {status === 'pending' && 'Payment Under Verification'}
              {status === 'verifying' && 'Verification In Progress'}
              {status === 'failed' && 'Payment Transaction Failed'}
              {status === 'cancelled' && 'Payment Cancelled by User'}
            </h1>

            <p className="text-xs sm:text-sm text-muted-foreground mt-1 max-w-sm mx-auto">
              {status === 'success' &&
                'Your payment has been settled, and your optical fiber account balance is updated.'}
              {(status === 'pending' || status === 'verifying') &&
                'We are waiting for the payment gateway to send final settlement confirmation.'}
              {status === 'failed' &&
                (errorMessage ||
                  'The transaction could not be processed by the gateway or the authorization timed out.')}
              {status === 'cancelled' &&
                'You chose to cancel this checkout session. No charges were made to your account.'}
            </p>
          </div>

          <CardContent className="p-6 space-y-5 text-xs sm:text-sm">
            {/* Transaction Details Box */}
            <div className="rounded-xl border bg-muted/30 p-4 space-y-2.5 font-mono text-xs">
              {invoiceId && (
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground font-sans">Invoice ID:</span>
                  <span className="font-bold text-primary">{invoiceId}</span>
                </div>
              )}

              {transactionId && (
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground font-sans">Transaction Ref:</span>
                  <span className="text-foreground">{transactionId}</span>
                </div>
              )}

              <div className="flex justify-between items-center">
                <span className="text-muted-foreground font-sans">Payment Gateway:</span>
                <Badge variant="outline" className="text-[10px] font-sans">
                  {displayGateway}
                </Badge>
              </div>

              {displayAmount !== '—' && (
                <div className="flex justify-between items-center pt-1 border-t">
                  <span className="text-muted-foreground font-sans font-semibold">Settled Amount:</span>
                  <span className="text-base font-black text-foreground">
                    ${Number(displayAmount).toFixed(2)} USD
                  </span>
                </div>
              )}

              <div className="flex justify-between items-center">
                <span className="text-muted-foreground font-sans">Status:</span>
                <Badge
                  className={`text-[10px] font-sans uppercase font-bold ${
                    status === 'success'
                      ? 'bg-emerald-500 text-white'
                      : status === 'pending' || status === 'verifying'
                        ? 'bg-amber-500 text-white'
                        : status === 'cancelled'
                          ? 'bg-muted text-muted-foreground'
                          : 'bg-destructive text-destructive-foreground'
                  }`}
                >
                  {status}
                </Badge>
              </div>
            </div>

            {/* Verification Note Alert */}
            {verificationNote && (
              <div className="p-3 rounded-lg bg-muted text-xs border flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-primary shrink-0" />
                <span>{verificationNote}</span>
              </div>
            )}

            {/* Action Buttons */}
            <div className="space-y-2 pt-2">
              {(status === 'pending' || status === 'verifying') && (
                <Button
                  onClick={handleManualVerification}
                  disabled={isVerifying}
                  className="w-full font-bold text-xs h-9 gap-1.5"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${isVerifying ? 'animate-spin' : ''}`} />
                  <span>{isVerifying ? 'Checking Verification…' : 'Check Verification Status'}</span>
                </Button>
              )}

              {status === 'success' && invoiceId && (
                <Button
                  variant="outline"
                  onClick={handleDownloadPdf}
                  disabled={downloadingPdf}
                  className="w-full text-xs h-9 gap-1.5"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>{downloadingPdf ? 'Downloading…' : 'Download Invoice PDF'}</span>
                </Button>
              )}

              {(status === 'failed' || status === 'cancelled') && invoiceId && (
                <Link href={`/checkout?invoiceId=${encodeURIComponent(invoiceId)}`} className="block">
                  <Button className="w-full font-bold text-xs h-9 gap-1.5">
                    <CreditCard className="h-3.5 w-3.5" />
                    <span>Try Payment Again</span>
                  </Button>
                </Link>
              )}

              <Link href="/dashboard" className="block">
                <Button variant="default" className="w-full font-bold text-xs h-9 gap-1.5">
                  <Home className="h-3.5 w-3.5" />
                  <span>Return to Subscriber Dashboard</span>
                </Button>
              </Link>

              <Link href="/dashboard/orders" className="block text-center">
                <Button variant="ghost" className="w-full text-xs h-8 text-muted-foreground">
                  View Billing &amp; Orders Ledger
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

