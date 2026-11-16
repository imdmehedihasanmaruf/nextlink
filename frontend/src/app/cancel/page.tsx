'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Ban,
  ArrowLeft,
  Calendar,
  Clock,
  MapPin,
  Globe,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  FileText,
  Download,
  Eye,
  RefreshCw,
  HelpCircle,
  RotateCcw,
  ShieldAlert,
  X,
  CreditCard,
  Wifi,
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useAuthStore } from '@/store/authStore'
import {
  fetchCancelInfo,
  submitCancelRequest,
  fetchCancelInvoices,
  downloadInvoicePdf,
  type CancelInfoResponse,
  type CancelInvoiceItem,
} from '@/lib/portalApi'

export default function CancelSubscriptionPage() {
  const router = useRouter()
  const { user, isAuthenticated, hasHydrated } = useAuthStore()

  // Data states
  const [loading, setLoading] = useState(true)
  const [cancelInfo, setCancelInfo] = useState<CancelInfoResponse | null>(null)
  const [invoices, setInvoices] = useState<CancelInvoiceItem[]>([])
  const [invoicesLoading, setInvoicesLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)

  // Form states
  const [reason, setReason] = useState<string>('Too expensive')
  const [description, setDescription] = useState<string>('')
  const [notSureBuyAgain, setNotSureBuyAgain] = useState<boolean>(false)
  const [buyAgainDate, setBuyAgainDate] = useState<string>('')
  const [confirmedTerms, setConfirmedTerms] = useState<boolean>(false)

  // Submission & Modal states
  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitSuccess, setSubmitSuccess] = useState<boolean>(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [latestCancellation, setLatestCancellation] = useState<any | null>(null)

  // Invoice Preview Modal
  const [selectedInvoice, setSelectedInvoice] = useState<CancelInvoiceItem | null>(null)
  const [pdfDownloadingId, setPdfDownloadingId] = useState<string | null>(null)

  // Pagination for Cancel Invoices
  const [currentPage, setCurrentPage] = useState(1)
  const pageSize = 5

  // Today's date for datepicker min attribute
  const todayStr = useMemo(() => {
    return new Date().toISOString().split('T')[0]
  }, [])

  // Auth gate
  useEffect(() => {
    if (hasHydrated && !isAuthenticated) {
      router.push('/login')
    }
  }, [hasHydrated, isAuthenticated, router])

  // Load initial data
  const loadData = useCallback(async () => {
    setLoading(true)
    setFetchError(null)
    try {
      const [infoRes, invRes] = await Promise.all([
        fetchCancelInfo(),
        fetchCancelInvoices(),
      ])

      const infoData = infoRes?.data || (infoRes?.subscriber ? infoRes : null)
      if (infoRes?.success && infoData) {
        setCancelInfo(infoData as CancelInfoResponse)
        if (infoData.cancellation) {
          setLatestCancellation(infoData.cancellation)
        }
        if (infoData.cancelReasons && infoData.cancelReasons.length > 0) {
          setReason(infoData.cancelReasons[0])
        }
      } else {
        setFetchError(infoRes?.error || 'Failed to load subscription cancellation information.')
      }

      const invList = invRes?.invoices || invRes?.data?.invoices
      if (invRes?.success && Array.isArray(invList)) {
        setInvoices(invList)
      } else if (Array.isArray(invRes?.data)) {
        setInvoices(invRes.data)
      }
    } catch (err: any) {
      setFetchError(err?.message || 'Network error while loading cancellation data.')
    } finally {
      setLoading(false)
      setInvoicesLoading(false)
    }
  }, [])

  useEffect(() => {
    if (isAuthenticated) {
      loadData()
    }
  }, [isAuthenticated, loadData])

  // Quick geo capture for submission
  const [detectedGeo, setDetectedGeo] = useState<{
    city?: string
    postalCode?: string
    state?: string
    country?: string
  }>({})

  useEffect(() => {
    // Attempt client-side approximate geo lookup as fallback hint
    fetch('/api/customer/location')
      .then((r) => r.json())
      .then((data) => {
        if (data.success) {
          setDetectedGeo({
            city: data.city,
            postalCode: data.postalCode,
            state: data.state,
            country: data.country,
          })
        }
      })
      .catch(() => {})
  }, [])

  // Validate form
  const isDescriptionValid = description.trim().length >= 10 && description.length <= 1000
  const isBuyAgainValid = notSureBuyAgain || (buyAgainDate !== '' && buyAgainDate >= todayStr)
  const hasActivePackage = Boolean(cancelInfo?.subscriber?.hasActivePackage ?? cancelInfo?.has_active_subscription)
  const isAlreadyCancelled = Boolean(
    latestCancellation ||
    cancelInfo?.subscriber?.status === 'cancelled'
  )

  const canSubmit =
    hasActivePackage &&
    !isAlreadyCancelled &&
    isDescriptionValid &&
    isBuyAgainValid &&
    confirmedTerms &&
    !submitting

  // Handle Form Submit
  const handleProceedClick = () => {
    setSubmitError(null)
    if (!canSubmit) return
    setIsConfirmModalOpen(true)
  }

  const handleConfirmSubmit = async () => {
    setSubmitting(true)
    setSubmitError(null)

    try {
      const res = await submitCancelRequest({
        packageId: cancelInfo?.subscriber?.packageId,
        packageName: cancelInfo?.subscriber?.packageName,
        reason,
        description: description.trim(),
        buyAgainDate: notSureBuyAgain ? null : buyAgainDate,
        notSureBuyAgain,
        effectiveDate: new Date().toISOString(),
        cancelSession: {
          city: detectedGeo.city || cancelInfo?.lastPurchase?.city,
          postalCode: detectedGeo.postalCode || cancelInfo?.lastPurchase?.postalCode,
          state: detectedGeo.state || cancelInfo?.lastPurchase?.state,
          country: detectedGeo.country || cancelInfo?.lastPurchase?.country,
        },
      })

      if (res.success && res.data) {
        setIsConfirmModalOpen(false)
        setSubmitSuccess(true)
        setLatestCancellation(res.data.cancellation)

        // Refresh invoices list without full reload
        const invRes = await fetchCancelInvoices()
        const invList = invRes?.invoices || invRes?.data?.invoices
        if (invRes?.success && Array.isArray(invList)) {
          setInvoices(invList)
        } else if (Array.isArray(invRes?.data)) {
          setInvoices(invRes.data)
        }

        // Refresh subscriber cancel info state
        const updatedInfo = await fetchCancelInfo()
        const updatedData = updatedInfo?.data || (updatedInfo?.subscriber ? updatedInfo : null)
        if (updatedInfo?.success && updatedData) {
          setCancelInfo(updatedData as CancelInfoResponse)
        }
      } else {
        setSubmitError(res.error || 'Failed to submit cancellation request.')
        setIsConfirmModalOpen(false)
      }
    } catch (err: any) {
      setSubmitError(err?.message || 'Server connection error.')
      setIsConfirmModalOpen(false)
    } finally {
      setSubmitting(false)
    }
  }

  // Handle PDF Download
  const handleDownloadPdf = async (invId: string) => {
    setPdfDownloadingId(invId)
    try {
      const success = await downloadInvoicePdf(invId)
      if (!success) {
        alert('Could not download PDF invoice. Please try again.')
      }
    } catch {
      alert('Error downloading PDF.')
    } finally {
      setPdfDownloadingId(null)
    }
  }

  // Pagination slice
  const totalPages = Math.max(1, Math.ceil(invoices.length / pageSize))
  const paginatedInvoices = useMemo(() => {
    const start = (currentPage - 1) * pageSize
    return invoices.slice(start, start + pageSize)
  }, [invoices, currentPage])

  if (!isAuthenticated) return null

  return (
    <div className="container mx-auto px-4 py-8 max-w-5xl space-y-8">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b pb-4">
        <div>
          <div className="flex items-center gap-2">
            <Link
              href="/dashboard"
              className="inline-flex items-center text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="mr-1 h-3.5 w-3.5" />
              Back to Dashboard
            </Link>
          </div>
          <h1 className="text-3xl font-black tracking-tight text-foreground mt-2 flex items-center gap-2.5">
            <Ban className="h-7 w-7 text-rose-600" />
            Package Plan Cancellation
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage your service termination, view cancellation invoices, and track equipment return.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={loadData}
            disabled={loading}
            className="text-xs font-medium"
          >
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Link href="/dashboard/orders">
            <Button variant="ghost" size="sm" className="text-xs font-semibold">
              <FileText className="mr-1.5 h-3.5 w-3.5" />
              My Orders &amp; Regular Invoices
            </Button>
          </Link>
        </div>
      </div>

      {fetchError && (
        <div className="p-4 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">Unable to retrieve cancellation profile</p>
              <p className="text-xs mt-0.5 opacity-90">{fetchError}</p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={loadData}
            disabled={loading}
            className="shrink-0 text-xs border-destructive/30 hover:bg-destructive/10 text-destructive font-semibold"
          >
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Retry
          </Button>
        </div>
      )}

      {/* SECTION A: CANCEL REQUEST FORM */}
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-black">
              1
            </span>
            Section A: Cancel Request Form
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Review your current subscribed package and original purchase session info before submitting.
          </p>
        </div>

        {/* 1. Read-only Current Package Card */}
        <Card className="border shadow-sm">
          <CardHeader className="pb-3 border-b bg-muted/20">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base font-bold flex items-center gap-2">
                  <Wifi className="h-4 w-4 text-primary" />
                  Current Subscribed Package (Read-Only)
                </CardTitle>
                <CardDescription className="text-xs">
                  Authoritative line and plan status from your subscriber profile
                </CardDescription>
              </div>
              <Badge
                className={
                  cancelInfo?.subscriber?.status === 'active'
                    ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30'
                    : cancelInfo?.subscriber?.status === 'cancelled'
                      ? 'bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/30'
                      : 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30'
                }
              >
                {cancelInfo?.subscriber?.status
                  ? cancelInfo.subscriber.status.toUpperCase()
                  : loading
                    ? 'LOADING...'
                    : 'UNKNOWN'}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="p-5 grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="p-3 rounded-lg bg-muted/40 border">
              <span className="text-[11px] font-semibold uppercase text-muted-foreground">Package &amp; Speed</span>
              <p className="text-lg font-black text-foreground mt-0.5">
                {cancelInfo?.subscriber?.packageLabel ||
                  cancelInfo?.subscriber?.packageName ||
                  (loading ? 'Loading plan…' : 'No active package')}
              </p>
            </div>
            <div className="p-3 rounded-lg bg-muted/40 border">
              <span className="text-[11px] font-semibold uppercase text-muted-foreground">Monthly Fee</span>
              <p className="text-lg font-black text-foreground mt-0.5 font-mono">
                ${Number(cancelInfo?.subscriber?.monthlyFee || 0).toFixed(2)}
                <span className="text-xs font-normal text-muted-foreground"> / month</span>
              </p>
            </div>
            <div className="p-3 rounded-lg bg-muted/40 border">
              <span className="text-[11px] font-semibold uppercase text-muted-foreground">Outstanding Dues</span>
              <p
                className={`text-lg font-black mt-0.5 font-mono ${
                  Number(cancelInfo?.subscriber?.balance || 0) > 0 ? 'text-rose-600' : 'text-emerald-600'
                }`}
              >
                ${Number(cancelInfo?.subscriber?.balance || 0).toFixed(2)}
              </p>
            </div>
          </CardContent>
        </Card>

        {/* 2. Read-only Package Purchase Info (Real Data 4-box block) */}
        <Card className="border shadow-sm">
          <CardHeader className="pb-3 border-b bg-muted/20">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <CardTitle className="text-base font-bold flex items-center gap-2">
                  <Clock className="h-4 w-4 text-blue-600" />
                  Package Purchase Session Info (Read-Only)
                </CardTitle>
                <CardDescription className="text-xs">
                  Captured from real order timestamp and geolocation session at time of confirmation
                </CardDescription>
              </div>
              <div className="text-xs font-mono text-muted-foreground">
                Subscriber ID: <strong className="text-foreground">{cancelInfo?.subscriber?.id || user?.id || '—'}</strong>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-5 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Box 1: Purchase Date */}
              <div className="p-3 rounded-lg border bg-card shadow-xs">
                <span className="text-[11px] font-bold text-muted-foreground uppercase flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5 text-blue-500" />
                  Purchase Date
                </span>
                <p className="text-sm font-bold text-foreground mt-1 font-mono">
                  {cancelInfo?.lastPurchase?.purchaseDate || 'Unknown'}
                </p>
                <span className="text-[10px] text-muted-foreground">Format: (DD/MM/YYYY)</span>
              </div>

              {/* Box 2: Purchase Time */}
              <div className="p-3 rounded-lg border bg-card shadow-xs">
                <span className="text-[11px] font-bold text-muted-foreground uppercase flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5 text-blue-500" />
                  Purchase Time
                </span>
                <p className="text-sm font-bold text-foreground mt-1 font-mono">
                  {cancelInfo?.lastPurchase?.purchaseTime || 'Unknown'}
                </p>
                <span className="text-[10px] text-muted-foreground">Format: (00:00AM/PM)</span>
              </div>

              {/* Box 3: City & Postal Code */}
              <div className="p-3 rounded-lg border bg-card shadow-xs">
                <span className="text-[11px] font-bold text-muted-foreground uppercase flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5 text-blue-500" />
                  City &amp; Postal Code
                </span>
                <p className="text-sm font-bold text-foreground mt-1 truncate" title={cancelInfo?.lastPurchase?.formattedCityPostal}>
                  {cancelInfo?.lastPurchase?.formattedCityPostal || 'Unknown'}
                </p>
                <span className="text-[10px] text-muted-foreground">
                  Postal: {cancelInfo?.lastPurchase?.postalCode || 'Unknown'}
                </span>
              </div>

              {/* Box 4: State & Country */}
              <div className="p-3 rounded-lg border bg-card shadow-xs">
                <span className="text-[11px] font-bold text-muted-foreground uppercase flex items-center gap-1.5">
                  <Globe className="h-3.5 w-3.5 text-blue-500" />
                  State &amp; Country
                </span>
                <p className="text-sm font-bold text-foreground mt-1 truncate" title={cancelInfo?.lastPurchase?.formattedStateCountry}>
                  {cancelInfo?.lastPurchase?.formattedStateCountry || 'Unknown'}
                </p>
                <span className="text-[10px] text-muted-foreground">
                  Country: {cancelInfo?.lastPurchase?.country || 'Unknown'}
                </span>
              </div>
            </div>

            <div className="text-xs text-muted-foreground bg-muted/40 p-2.5 rounded-lg flex flex-wrap items-center justify-between gap-2 border">
              <span>
                Original Purchase Invoice:{' '}
                <strong className="font-mono text-foreground">
                  {cancelInfo?.lastPurchase?.invoiceNumber || 'N/A'}
                </strong>
              </span>
              <span>
                Subscriber Account ID:{' '}
                <strong className="font-mono text-foreground">
                  {cancelInfo?.subscriber?.id || user?.id || 'N/A'}
                </strong>
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Existing Cancellation Banner if duplicate/already cancelled */}
        {isAlreadyCancelled && (
          <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-900 dark:text-amber-200 text-sm flex items-start gap-3">
            <ShieldAlert className="h-5 w-5 shrink-0 text-amber-600 mt-0.5" />
            <div>
              <p className="font-bold">Active Cancellation on File</p>
              <p className="text-xs mt-0.5">
                This account already has a processed cancellation request. Duplicate cancellation requests are blocked.
                See Section B below for your effective date, dues, and equipment return steps.
              </p>
            </div>
          </div>
        )}

        {/* Not Active Warning */}
        {!hasActivePackage && !isAlreadyCancelled && (
          <div className="p-5 rounded-xl bg-blue-500/10 border border-blue-500/30 text-blue-900 dark:text-blue-200 text-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 shrink-0 text-blue-600 mt-0.5" />
              <div>
                <p className="font-bold text-base">You have no active package to cancel</p>
                <p className="text-xs mt-0.5 text-muted-foreground">
                  Your account does not currently hold an active subscription line. You can choose and subscribe to high-speed fiber anytime on our packages page.
                </p>
              </div>
            </div>
            <Link href="/dashboard/purchase">
              <Button size="sm" className="shrink-0 bg-blue-600 hover:bg-blue-700 text-white font-semibold">
                Explore Packages
              </Button>
            </Link>
          </div>
        )}

        {/* Cancel Interactive Fields */}
        <Card className={`border shadow-sm ${!hasActivePackage || isAlreadyCancelled ? 'opacity-60 pointer-events-none' : ''}`}>
          <CardHeader className="pb-3 border-b">
            <CardTitle className="text-base font-bold">Cancellation Details</CardTitle>
            <CardDescription className="text-xs">
              Please tell us why you are leaving and provide your expected reconnection timeline.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-5 space-y-5">
            {/* 3. Cancel Issue Dropdown */}
            <div className="space-y-1.5">
              <label htmlFor="cancel-issue" className="text-xs font-bold text-foreground flex items-center gap-1">
                Cancel Issue <span className="text-rose-500">*</span>
              </label>
              <select
                id="cancel-issue"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                disabled={!hasActivePackage || isAlreadyCancelled || submitting}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-xs focus:outline-hidden focus:ring-2 focus:ring-ring"
              >
                {(cancelInfo?.cancelReasons || [
                  'Too expensive',
                  'Slow speed',
                  'Frequent disconnections',
                  'Moving to another location',
                  'Switching provider',
                  'Poor support',
                  'Temporary pause',
                  'Other',
                ]).map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>

            {/* 4. Cancel Description Textarea */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label htmlFor="cancel-description" className="text-xs font-bold text-foreground flex items-center gap-1">
                  Cancel Description <span className="text-rose-500">*</span>
                </label>
                <span
                  className={`text-[11px] font-mono ${
                    description.length > 0 && description.length < 10
                      ? 'text-rose-600 font-bold'
                      : description.length > 1000
                        ? 'text-rose-600 font-bold'
                        : 'text-muted-foreground'
                  }`}
                >
                  {description.length} / 1000 characters (min 10)
                </span>
              </div>
              <Textarea
                id="cancel-description"
                rows={4}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={!hasActivePackage || isAlreadyCancelled || submitting}
                placeholder="Please describe why you wish to cancel this plan in detail (minimum 10 characters)..."
                className="resize-y text-sm"
              />
              {description.length > 0 && description.length < 10 && (
                <p className="text-[11px] text-rose-600 font-medium">
                  Please enter at least {10 - description.length} more characters.
                </p>
              )}
            </div>

            {/* 5. Buy-Again Date Picker */}
            <div className="space-y-2">
              <label htmlFor="buy-again-date" className="text-xs font-bold text-foreground flex items-center gap-1">
                When might you buy again? <span className="text-rose-500">*</span>
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
                <Input
                  id="buy-again-date"
                  type="date"
                  min={todayStr}
                  value={buyAgainDate}
                  onChange={(e) => setBuyAgainDate(e.target.value)}
                  disabled={notSureBuyAgain || !hasActivePackage || isAlreadyCancelled || submitting}
                  className={`text-sm ${notSureBuyAgain ? 'opacity-40 cursor-not-allowed bg-muted' : ''}`}
                />
                <label className="flex items-center gap-2 text-xs font-semibold text-foreground cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={notSureBuyAgain}
                    onChange={(e) => {
                      setNotSureBuyAgain(e.target.checked)
                      if (e.target.checked) setBuyAgainDate('')
                    }}
                    disabled={!hasActivePackage || isAlreadyCancelled || submitting}
                    className="h-4 w-4 rounded-sm border-gray-300 text-primary focus:ring-primary"
                  />
                  <span>Not sure yet</span>
                </label>
              </div>
              {!notSureBuyAgain && buyAgainDate === '' && (
                <p className="text-[11px] text-muted-foreground">
                  Select an estimated return date or check &quot;Not sure yet&quot;.
                </p>
              )}
            </div>

            {/* 6. Terms Checkbox */}
            <div className="pt-2 border-t">
              <label className="flex items-start gap-2.5 text-xs text-foreground cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={confirmedTerms}
                  onChange={(e) => setConfirmedTerms(e.target.checked)}
                  disabled={!hasActivePackage || isAlreadyCancelled || submitting}
                  className="h-4 w-4 rounded-sm border-gray-300 text-rose-600 focus:ring-rose-500 mt-0.5 shrink-0"
                />
                <span className="leading-relaxed font-medium">
                  I understand that cancelling my subscription will deactivate my optical internet service line. Any
                  unpaid past-due invoices remain payable and late fees apply to unpaid cycles. Equipment must be
                  returned per policy.
                </span>
              </label>
            </div>

            {/* Error banner if submission failed */}
            {submitError && (
              <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-700 dark:text-rose-400 text-xs font-semibold flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>{submitError}</span>
              </div>
            )}

            {/* 7. Submit Button */}
            <div className="pt-2 flex justify-end">
              <Button
                type="button"
                variant="destructive"
                disabled={!canSubmit}
                onClick={handleProceedClick}
                className="font-bold text-xs gap-2 px-6 h-10 shadow-sm"
              >
                <Ban className="h-4 w-4" />
                Submit Cancellation Request
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* SECTION B: CANCEL INFO SUMMARY (Directly below Submit Button) */}
      {(latestCancellation || isAlreadyCancelled || submitSuccess) && (
        <div className="space-y-4 pt-2">
          <div>
            <h2 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 text-xs font-black">
                2
              </span>
              Section B: Cancel Info Summary
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Live snapshot of your cancellation record, equipment cutoff, and return instructions.
            </p>
          </div>

          <Card className="border-2 border-emerald-500/30 bg-emerald-50/30 dark:bg-emerald-950/10 shadow-sm">
            <CardHeader className="pb-3 border-b bg-emerald-500/10">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-bold text-foreground flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                  Cancellation Confirmed &amp; Service Profile Updated
                </CardTitle>
                <Badge className="bg-emerald-600 text-white font-mono text-[11px]">
                  {latestCancellation?.status ? String(latestCancellation.status).toUpperCase() : 'CANCELLED'}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="p-5 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="p-3 rounded-lg bg-card border">
                  <span className="text-[11px] font-bold text-muted-foreground uppercase">Effective Cancel Date</span>
                  <p className="text-sm font-bold text-foreground mt-1 font-mono">
                    {latestCancellation?.effective_date
                      ? new Date(latestCancellation.effective_date).toLocaleDateString()
                      : cancelInfo?.settings?.effectiveDateRule === 'immediate'
                        ? 'Immediate (Effective Today)'
                        : 'End of Billing Month'}
                  </p>
                </div>

                <div className="p-3 rounded-lg bg-card border">
                  <span className="text-[11px] font-bold text-muted-foreground uppercase">Final Dues / Settlement</span>
                  <p
                    className={`text-sm font-bold mt-1 font-mono ${
                      Number(latestCancellation?.outstanding_balance || cancelInfo?.subscriber?.balance || 0) > 0
                        ? 'text-rose-600'
                        : 'text-emerald-600'
                    }`}
                  >
                    ${Number(latestCancellation?.outstanding_balance || cancelInfo?.subscriber?.balance || 0).toFixed(2)}
                  </p>
                  <span className="text-[10px] text-muted-foreground">
                    {Number(latestCancellation?.outstanding_balance || cancelInfo?.subscriber?.balance || 0) > 0
                      ? 'Payable via Current Bills'
                      : 'All dues settled'}
                  </span>
                </div>

                <div className="p-3 rounded-lg bg-card border">
                  <span className="text-[11px] font-bold text-muted-foreground uppercase">Expected Return Date</span>
                  <p className="text-sm font-bold text-foreground mt-1 font-mono">
                    {latestCancellation?.not_sure_buy_again
                      ? 'Not sure yet'
                      : latestCancellation?.buy_again_date || 'Not specified'}
                  </p>
                </div>
              </div>

              {/* Equipment Return & Cutoff instructions */}
              <div className="p-4 rounded-xl border bg-muted/30 space-y-2">
                <h4 className="text-xs font-bold text-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <AlertCircle className="h-4 w-4 text-amber-500" />
                  Equipment Return &amp; Service Cutoff Instructions
                </h4>
                <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside">
                  <li>
                    <strong>Optical Terminal (GPON ONT) &amp; Wi-Fi Gateway:</strong> Please return devices along with
                    power adapters within <strong>7 business days</strong> to avoid equipment replacement charges.
                  </li>
                  <li>
                    <strong>Service Cutoff Time:</strong> Line deactivation signal is scheduled for midnight (UTC).
                    Active downloads and sessions will be cleanly closed.
                  </li>
                  <li>
                    <strong>Drop-off Location:</strong> Any official NextLink service hub, or schedule a free technician
                    pickup through support.
                  </li>
                </ul>
              </div>

              {/* Reactivate or Contact Support */}
              <div className="flex flex-wrap items-center gap-3 pt-2">
                <Link href="/dashboard/purchase">
                  <Button size="sm" className="bg-primary text-primary-foreground font-bold text-xs gap-1.5">
                    <RotateCcw className="h-3.5 w-3.5" />
                    Reactivate / Buy New Package
                  </Button>
                </Link>
                <Link href="/dashboard/orders">
                  <Button size="sm" variant="outline" className="font-semibold text-xs gap-1.5">
                    <CreditCard className="h-3.5 w-3.5" />
                    View &amp; Pay Outstanding Dues
                  </Button>
                </Link>
                <Link href="/dashboard/tickets">
                  <Button size="sm" variant="ghost" className="font-semibold text-xs gap-1.5">
                    <HelpCircle className="h-3.5 w-3.5" />
                    Contact Support
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* SECTION C: UNSUBSCRIBER CANCEL INVOICE LIST */}
      <div className="space-y-4 pt-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-500/20 text-blue-700 dark:text-blue-400 text-xs font-black">
                3
              </span>
              Section C: Unsubscriber Cancel Invoice List
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Authoritative records of cancelled subscriptions, cancellation timestamps, and settlement amounts.
            </p>
          </div>
          <Badge variant="outline" className="font-mono text-xs w-fit">
            {invoices.length} {invoices.length === 1 ? 'Invoice' : 'Invoices'}
          </Badge>
        </div>

        <Card className="border shadow-sm">
          <CardContent className="p-0">
            {invoicesLoading ? (
              <div className="p-8 text-center text-xs text-muted-foreground flex flex-col items-center justify-center gap-2">
                <RefreshCw className="h-6 w-6 animate-spin text-primary" />
                <span>Loading cancellation invoices…</span>
              </div>
            ) : invoices.length === 0 ? (
              <div className="p-8 text-center text-xs text-muted-foreground space-y-2">
                <FileText className="h-8 w-8 text-muted-foreground/50 mx-auto" />
                <p className="font-semibold text-foreground text-sm">No cancellation invoices on file</p>
                <p>When a package is cancelled, its Unsubscriber Cancel Invoice will be listed here permanently.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-muted/40 text-muted-foreground uppercase text-[10px] tracking-wider border-b">
                    <tr>
                      <th className="py-3 px-4">Invoice No</th>
                      <th className="py-3 px-4">Package</th>
                      <th className="py-3 px-4">Cancel Date</th>
                      <th className="py-3 px-4">Cancel Time</th>
                      <th className="py-3 px-4">Reason</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {paginatedInvoices.map((inv) => (
                      <tr key={inv.id} className="hover:bg-muted/20 transition-colors">
                        <td className="py-3 px-4 font-mono font-bold text-foreground">
                          {inv.invoice_number || inv.id}
                        </td>
                        <td className="py-3 px-4 font-semibold text-foreground">
                          {inv.package_name || 'Standard Fiber'}
                        </td>
                        <td className="py-3 px-4 font-mono">
                          {inv.cancel_date || '—'}
                        </td>
                        <td className="py-3 px-4 font-mono">
                          {inv.cancel_time || '—'}
                        </td>
                        <td className="py-3 px-4">
                          <span className="px-2 py-0.5 rounded-sm bg-muted text-[11px] font-medium">
                            {inv.reason || 'General Cancellation'}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <Badge
                            className={
                              inv.status === 'paid'
                                ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30'
                                : 'bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/30'
                            }
                          >
                            {inv.status ? inv.status.toUpperCase() : 'CANCELLED'}
                          </Badge>
                        </td>
                        <td className="py-3 px-4 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setSelectedInvoice(inv)}
                              className="h-7 px-2.5 text-xs font-semibold gap-1"
                            >
                              <Eye className="h-3.5 w-3.5 text-primary" />
                              View
                            </Button>
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => handleDownloadPdf(inv.id)}
                              disabled={pdfDownloadingId === inv.id}
                              className="h-7 px-2.5 text-xs font-semibold gap-1"
                            >
                              <Download className={`h-3.5 w-3.5 ${pdfDownloadingId === inv.id ? 'animate-spin' : ''}`} />
                              PDF
                            </Button>
                            {/* NOTE: Absolutely NO delete button per strict requirement */}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="p-3 border-t flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  Showing page <strong>{currentPage}</strong> of <strong>{totalPages}</strong>
                </span>
                <div className="flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={currentPage <= 1}
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    className="h-7 px-2 text-xs"
                  >
                    Previous
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={currentPage >= totalPages}
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                    className="h-7 px-2 text-xs"
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* CONFIRMATION MODAL */}
      {isConfirmModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-background border rounded-2xl max-w-md w-full shadow-2xl p-6 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-rose-500/10 text-rose-600 flex items-center justify-center shrink-0">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-foreground">Confirm Subscription Cancellation</h3>
                <p className="text-xs text-muted-foreground">This action cannot be undone.</p>
              </div>
            </div>

            <p className="text-xs text-muted-foreground leading-relaxed">
              Are you sure you want to cancel your{' '}
              <strong className="text-foreground">
                {cancelInfo?.subscriber?.packageName || 'active'}
              </strong>{' '}
              package plan? Your internet connection will be deactivated, and an Unsubscriber Cancel Invoice will be
              permanently recorded.
            </p>

            <div className="p-3 rounded-lg bg-muted/40 text-xs space-y-1 border font-mono">
              <div>Reason: <span className="font-semibold">{reason}</span></div>
              <div>
                Return Timeline:{' '}
                <span className="font-semibold">
                  {notSureBuyAgain ? 'Not sure yet' : buyAgainDate}
                </span>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsConfirmModalOpen(false)}
                disabled={submitting}
                className="text-xs"
              >
                Go Back
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleConfirmSubmit}
                disabled={submitting}
                className="text-xs font-bold gap-1.5"
              >
                {submitting ? (
                  <>
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    Processing Cancellation…
                  </>
                ) : (
                  <>
                    <Ban className="h-3.5 w-3.5" />
                    Yes, Cancel Now
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* INVOICE VIEW PREVIEW MODAL */}
      {selectedInvoice && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-background border rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl p-6 space-y-5 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b pb-3">
              <div>
                <Badge variant="outline" className="text-[10px] uppercase font-bold text-rose-600 border-rose-300">
                  Unsubscriber Cancel Invoice
                </Badge>
                <h3 className="text-lg font-black text-foreground mt-1">
                  Invoice {selectedInvoice.invoice_number || selectedInvoice.id}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedInvoice(null)}
                className="text-muted-foreground hover:text-foreground p-1 rounded-md"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Session Info 4-box block on Cancel Invoice */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="p-2.5 rounded-lg border bg-muted/20">
                <span className="text-[10px] font-bold text-muted-foreground uppercase">Cancel Date</span>
                <p className="text-xs font-bold text-foreground mt-0.5 font-mono">
                  {selectedInvoice.cancel_date || '—'}
                </p>
                <span className="text-[9px] text-muted-foreground">Format: (DD/MM/YYYY)</span>
              </div>
              <div className="p-2.5 rounded-lg border bg-muted/20">
                <span className="text-[10px] font-bold text-muted-foreground uppercase">Cancel Time</span>
                <p className="text-xs font-bold text-foreground mt-0.5 font-mono">
                  {selectedInvoice.cancel_time || '—'}
                </p>
                <span className="text-[9px] text-muted-foreground">Format: (00:00AM/PM)</span>
              </div>
              <div className="p-2.5 rounded-lg border bg-muted/20">
                <span className="text-[10px] font-bold text-muted-foreground uppercase">City &amp; Postal</span>
                <p className="text-xs font-bold text-foreground mt-0.5 truncate">
                  {selectedInvoice.city || 'Azimpur'}, {selectedInvoice.postal_code || '1205'}
                </p>
                <span className="text-[9px] text-muted-foreground">
                  Postal: {selectedInvoice.postal_code || '1205'}
                </span>
              </div>
              <div className="p-2.5 rounded-lg border bg-muted/20">
                <span className="text-[10px] font-bold text-muted-foreground uppercase">State &amp; Country</span>
                <p className="text-xs font-bold text-foreground mt-0.5 truncate">
                  {selectedInvoice.state || 'Dhaka Division'}, {selectedInvoice.country || 'Bangladesh'}
                </p>
                <span className="text-[9px] text-muted-foreground">
                  Country: {selectedInvoice.country || 'Bangladesh'}
                </span>
              </div>
            </div>

            {/* Cancel Details */}
            <div className="space-y-2 p-3 rounded-lg border bg-card text-xs">
              <div className="flex justify-between py-1 border-b">
                <span className="text-muted-foreground">Subscribed Package:</span>
                <span className="font-bold text-foreground">{selectedInvoice.package_name || 'Standard Fiber'}</span>
              </div>
              <div className="flex justify-between py-1 border-b">
                <span className="text-muted-foreground">Cancellation Reason:</span>
                <span className="font-bold text-foreground">{selectedInvoice.reason || 'General'}</span>
              </div>
              {selectedInvoice.description && (
                <div className="py-1 border-b">
                  <span className="text-muted-foreground block mb-0.5">Subscriber Notes:</span>
                  <p className="text-foreground italic bg-muted/30 p-2 rounded-sm">{selectedInvoice.description}</p>
                </div>
              )}
              <div className="flex justify-between py-1 border-b">
                <span className="text-muted-foreground">Expected Return Timeline:</span>
                <span className="font-bold text-foreground">
                  {selectedInvoice.buy_again_date || 'Not sure yet'}
                </span>
              </div>
              <div className="flex justify-between py-1 text-sm font-bold pt-2">
                <span>Final Settlement Total:</span>
                <span className="font-mono text-primary">
                  ${Number(selectedInvoice.total_amount || 0).toFixed(2)}
                </span>
              </div>
            </div>

            <div className="flex items-center justify-between pt-2">
              <span className="text-[11px] text-muted-foreground">
                NextLink Global ISP • Official Cancel Settlement Record
              </span>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setSelectedInvoice(null)}
                  className="text-xs"
                >
                  Close
                </Button>
                <Button
                  size="sm"
                  variant="default"
                  onClick={() => handleDownloadPdf(selectedInvoice.id)}
                  disabled={pdfDownloadingId === selectedInvoice.id}
                  className="text-xs font-bold gap-1.5"
                >
                  <Download className={`h-3.5 w-3.5 ${pdfDownloadingId === selectedInvoice.id ? 'animate-spin' : ''}`} />
                  Download PDF
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

