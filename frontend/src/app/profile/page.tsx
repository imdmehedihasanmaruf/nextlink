'use client'

import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { 
  User, 
  Mail, 
  Phone, 
  MapPin, 
  Package, 
  Calendar, 
  Save, 
  Trash2, 
  Check, 
  AlertTriangle, 
  Wifi, 
  ShieldAlert,
  ArrowLeft
} from 'lucide-react'
import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { useAuthStore } from '@/store/authStore'
import { useTranslation } from '@/store/settingsStore'
import { subscriberAuthHeader, fetchMySubscription, cancelSubscription } from '@/lib/portalApi'
import { useModalA11y } from '@/lib/useModalA11y'

export default function ProfilePage() {
  const router = useRouter()
  const { user, isAuthenticated, hasHydrated, updateUser, logout } = useAuthStore()
  const { t } = useTranslation()

  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')
  const [savedSuccess, setSavedSuccess] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [deactivating, setDeactivating] = useState(false)
  const [deactivateError, setDeactivateError] = useState<string | null>(null)

  // Subscription lifecycle — the plan the customer is on, when it started and
  // when it was cancelled. Cancelling keeps both dates on the profile.
  const [subscription, setSubscription] = useState<{
    status: string
    isSubscriber: boolean
    packageName: string
    subscriptionStartedAt: string | null
    subscriptionCancelledAt: string | null
    canCancel: boolean
    lastPurchase: { packageName: string; amount: number; createdAt: string } | null
  } | null>(null)
  const [cancelModalOpen, setCancelModalOpen] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [cancelError, setCancelError] = useState<string | null>(null)
  const [cancelNotice, setCancelNotice] = useState<string | null>(null)

  // Escape closes the confirmation and the page does not scroll behind it.
  useModalA11y(deleteModalOpen, () => setDeleteModalOpen(false))
  useModalA11y(cancelModalOpen, () => setCancelModalOpen(false))

  useEffect(() => {
    if (hasHydrated && !isAuthenticated) {
      router.push('/login')
    }
  }, [hasHydrated, isAuthenticated, router])

  useEffect(() => {
    if (user) {
      const parts = String(user.name || '').trim().split(/\s+/)
      setFirstName(user.firstName || parts[0] || '')
      setLastName(user.lastName || parts.slice(1).join(' ') || '')
      setName(user.name || '')
      setEmail(user.email || '')
      setPhone(user.phone || '')
      setAddress(user.address || '')
    }
  }, [user])

  const loadSubscription = React.useCallback(async () => {
    const result = await fetchMySubscription()
    if (result.success && result.subscription) {
      setSubscription(result.subscription)
    }
  }, [])

  useEffect(() => {
    if (isAuthenticated) {
      loadSubscription()
    }
  }, [isAuthenticated, loadSubscription])

  const handleConfirmCancel = async () => {
    setCancelError(null)
    setCancelling(true)
    const result = await cancelSubscription('Cancelled from the customer portal')
    setCancelling(false)
    if (!result.success) {
      setCancelError(result.error || 'The subscription could not be cancelled.')
      return
    }
    setCancelModalOpen(false)
    setCancelNotice('Your subscription has been cancelled. The purchase and cancellation dates stay on your profile.')
    await loadSubscription()
  }

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaveError(null)
    const fName = firstName.trim()
    const lName = lastName.trim()
    if (!fName || !lName) {
      setSaveError('First Name and Last Name are required.')
      return
    }
    const fullName = `${fName} ${lName}`.trim()
    setSaving(true)
    try {
      // The server verifies the session and writes the account — one customer
      // can never edit another customer's record.
      const response = await fetch('/api/customer/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...subscriberAuthHeader() },
        body: JSON.stringify({ firstName: fName, lastName: lName, name: fullName, email, phone, address }),
      })
      const payload = await response.json()

      if (!response.ok || !payload.success) {
        setSaveError(payload.error || 'The profile could not be saved.')
        return
      }

      // Immediately update the local auth store so the header greeting ("Hi, <FirstName>") updates immediately!
      setName(fullName)
      updateUser({ firstName: fName, lastName: lName, name: fullName, email, phone, address })
      setSavedSuccess(true)
      setTimeout(() => setSavedSuccess(false), 3000)
    } catch {
      setSaveError('The profile could not be saved. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const handleConfirmDelete = async () => {
    setDeactivateError(null)
    setDeactivating(true)
    try {
      const response = await fetch('/api/customer/deactivate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...subscriberAuthHeader() },
        body: JSON.stringify({ confirm: true }),
      })
      const payload = await response.json()

      if (!response.ok || !payload.success) {
        setDeactivateError(payload.error || 'The account could not be deactivated.')
        return
      }

      // Signed out only after the server confirmed the deactivation.
      logout()
      router.push('/')
    } catch {
      setDeactivateError('The account could not be deactivated. Please try again.')
    } finally {
      setDeactivating(false)
    }
  }

  if (!isAuthenticated || !user) {
    return null
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/dashboard" className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1 mb-2">
            <ArrowLeft size={14} /> Back to Dashboard
          </Link>
          <h1 className="text-3xl font-extrabold tracking-tight">Subscriber Account Profile</h1>
          <p className="text-muted-foreground mt-1">
            Manage your personal contact details, installation address, and subscription circuit.
          </p>
        </div>
        {(() => {
          const s = String(user.status || '').toLowerCase()
          const variants: Record<string, { label: string; cls: string }> = {
            active:      { label: 'Active Subscription', cls: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30' },
            suspended:   { label: 'Line Suspended', cls: 'bg-amber-500/10 text-amber-600 border-amber-500/30' },
            blocked:     { label: 'Line Blocked', cls: 'bg-rose-500/10 text-rose-600 border-rose-500/30' },
            pending:     { label: 'Pending Activation', cls: 'bg-blue-500/10 text-blue-600 border-blue-500/30' },
            deactivated: { label: 'Deactivated', cls: 'bg-muted text-muted-foreground' },
          }
          const v = variants[s] || { label: s ? s.replace(/_/g, ' ') : 'Account On File', cls: 'bg-muted text-muted-foreground' }
          return (
            <Badge className={`${v.cls} px-3 py-1 text-xs font-bold capitalize`}>
              {v.label}
            </Badge>
          )
        })()}
      </div>

      {savedSuccess && (
        <div className="rounded-xl border border-emerald-500/50 bg-emerald-500/10 p-4 text-emerald-600 dark:text-emerald-400 flex items-center gap-2 animate-in fade-in">
          <Check className="h-5 w-5" />
          <span>{t('savedSuccess')}</span>
        </div>
      )}

      {saveError && (
        <div className="rounded-xl border border-destructive/50 bg-destructive/10 p-4 text-destructive flex items-center gap-2 animate-in fade-in">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <span>{saveError}</span>
        </div>
      )}

      {cancelNotice && (
        <div className="rounded-xl border border-emerald-500/50 bg-emerald-500/10 p-4 text-emerald-600 flex items-center gap-2 animate-in fade-in">
          <Check className="h-5 w-5 shrink-0" />
          <span>{cancelNotice}</span>
        </div>
      )}

      {/* Account Overview Card */}
      <Card className="border shadow-sm">
        <CardContent className="p-6">
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="h-16 w-16 rounded-2xl bg-primary text-primary-foreground flex items-center justify-center font-black text-2xl shadow-md">
              {name.charAt(0) || 'A'}
            </div>
            <div className="space-y-1">
              <h2 className="text-2xl font-bold">{name}</h2>
              <p className="text-xs text-muted-foreground font-mono">
                Account ID: <span className="text-foreground font-semibold">{user.id}</span> • Username: <span className="text-foreground font-semibold">{user.username}</span>
              </p>
              <div className="flex flex-wrap gap-2 pt-1">
                <Badge variant="secondary" className="gap-1 text-xs">
                  <Package size={12} /> {user.package}
                </Badge>
                <Badge variant="outline" className="gap-1 text-xs">
                  <Calendar size={12} /> Member Since {user.joinDate}
                </Badge>
                <Badge variant="outline" className="gap-1 text-xs">
                  <Wifi size={12} /> Fiber GPON
                </Badge>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Subscription lifecycle — the plan, the purchase date and the
          cancellation date stay on the profile either way. */}
      {subscription && (
        <Card className="border shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Calendar size={18} className="text-primary" /> Subscription
            </CardTitle>
            <CardDescription>
              {subscription.isSubscriber
                ? 'Your plan and the dates it covers.'
                : subscription.status === 'registered'
                  ? 'Your account is registered. Buy a package plan to activate your service.'
                  : 'Your subscription history — the dates stay on your profile.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Current plan</span>
              <span className="font-medium">{subscription.packageName || 'No active plan'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Purchased on</span>
              <span className="font-medium">
                {subscription.subscriptionStartedAt
                  ? new Date(subscription.subscriptionStartedAt).toLocaleDateString()
                  : subscription.lastPurchase
                    ? new Date(subscription.lastPurchase.createdAt).toLocaleDateString()
                    : 'Not yet'}
              </span>
            </div>
            {subscription.subscriptionCancelledAt && (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Cancelled on</span>
                <span className="font-medium">{new Date(subscription.subscriptionCancelledAt).toLocaleDateString()}</span>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Edit Form */}
      <form onSubmit={handleSaveProfile} className="space-y-6">
        <Card className="border shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <User size={18} className="text-primary" /> Edit Personal Information
            </CardTitle>
            <CardDescription>Update your contact info and service records</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="firstName">First Name *</Label>
                <Input
                  id="firstName"
                  value={firstName}
                  onChange={(e) => {
                    setFirstName(e.target.value)
                    setName(`${e.target.value.trim()} ${lastName.trim()}`.trim())
                  }}
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="lastName">Last Name *</Label>
                <Input
                  id="lastName"
                  value={lastName}
                  onChange={(e) => {
                    setLastName(e.target.value)
                    setName(`${firstName.trim()} ${e.target.value.trim()}`.trim())
                  }}
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="email">{t('email')}</Label>
                <Input 
                  id="email" 
                  type="email" 
                  value={email} 
                  onChange={(e) => setEmail(e.target.value)} 
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="phone">{t('phone')}</Label>
                <Input 
                  id="phone" 
                  value={phone} 
                  onChange={(e) => setPhone(e.target.value)} 
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="circuit">Circuit / PPPoE Identifier</Label>
                <Input 
                  id="circuit" 
                  value={user.username} 
                  disabled 
                  className="bg-muted font-mono text-xs"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="address">{t('address')}</Label>
              <Textarea 
                id="address" 
                value={address} 
                onChange={(e) => setAddress(e.target.value)} 
                rows={3}
                required
              />
            </div>

            <div className="flex justify-end pt-2">
              <Button type="submit" disabled={saving} className="gap-2 font-bold shadow">
                <Save size={16} />
                <span>{saving ? 'Saving…' : t('saveChanges')}</span>
              </Button>
            </div>
          </CardContent>
        </Card>
      </form>

      {/* Cancel the plan — the account leaves the subscriber list, the dates
          stay on the profile. */}
      {subscription?.canCancel && (
        <Card className="border border-amber-500/30 bg-amber-500/5 shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg text-amber-700 dark:text-amber-400 flex items-center gap-2">
              <ShieldAlert size={18} />
              Cancel Subscription
            </CardTitle>
            <CardDescription>
              Stops the plan, closes the billing profile and takes the line down. Your purchase and cancellation dates stay on this profile.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-2">
            <p className="text-xs text-muted-foreground">
              You are on <span className="text-foreground font-medium">{subscription.packageName}</span>. After cancelling you can buy a plan again at any time.
            </p>
            <Button
              variant="outline"
              onClick={() => setCancelModalOpen(true)}
              className="gap-2 font-bold flex-shrink-0 border-amber-500/40 text-amber-700 hover:bg-amber-500/10"
            >
              <ShieldAlert size={16} />
              <span>Cancel Subscription</span>
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Danger Zone: Delete / Deactivate Account */}
      <Card className="border border-destructive/30 bg-destructive/5 shadow-sm">
        <CardHeader>
          <CardTitle className="text-lg text-destructive flex items-center gap-2">
            <ShieldAlert size={18} />
            {t('deleteAccount')}
          </CardTitle>
          <CardDescription>
            {t('deleteAccountDesc')}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-2">
          <p className="text-xs text-muted-foreground">
            Once confirmed, your account is deactivated and auto-debit billing stops. The deactivation is recorded; your billing history is kept.
          </p>
          <Button 
            variant="destructive" 
            onClick={() => setDeleteModalOpen(true)}
            className="gap-2 font-bold flex-shrink-0"
          >
            <Trash2 size={16} />
            <span>{t('deactivateBtn')}</span>
          </Button>
        </CardContent>
      </Card>

      {/* Confirmation Dialog */}
      {deleteModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-label="Deactivate account"
        >
          <Card className="w-full max-w-md shadow-2xl border-2 border-destructive animate-in zoom-in-95">
            <CardHeader className="text-center pb-2">
              <div className="h-14 w-14 rounded-full bg-destructive/10 text-destructive flex items-center justify-center mx-auto mb-2">
                <AlertTriangle size={30} />
              </div>
              <CardTitle className="text-xl font-bold">Terminate Subscription?</CardTitle>
              <CardDescription className="text-xs">
                {t('confirmDeactivate')}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 pt-4">
              <p className="text-xs text-muted-foreground text-center">
                Your account is marked deactivated and kept for the billing history. You are signed out immediately and the service stops. Your connectivity is not automatically removed from the router until the helpdesk confirms it.
              </p>
              {deactivateError && (
                <p className="text-[11px] text-destructive text-center">{deactivateError}</p>
              )}
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setDeleteModalOpen(false)
                    setDeactivateError(null)
                  }}
                  className="flex-1 font-semibold"
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  onClick={handleConfirmDelete}
                  disabled={deactivating}
                  className="flex-1 font-bold"
                >
                  {deactivating ? 'Deactivating…' : 'Yes, Deactivate Account'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
      {/* Cancel-subscription confirmation */}
      {cancelModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-label="Cancel subscription"
        >
          <Card className="w-full max-w-md shadow-2xl border-2 border-amber-500 animate-in zoom-in-95">
            <CardHeader className="text-center pb-2">
              <div className="h-14 w-14 rounded-full bg-amber-500/10 text-amber-600 flex items-center justify-center mx-auto mb-2">
                <ShieldAlert size={30} />
              </div>
              <CardTitle className="text-xl font-bold">Cancel your subscription?</CardTitle>
              <CardDescription className="text-xs">
                Your plan {subscription?.packageName ? `(${subscription.packageName})` : ''} will be cancelled.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 pt-4">
              <p className="text-xs text-muted-foreground text-center">
                Billing stops, the router line is taken down and you leave the subscriber list. The date you bought the
                plan and the date you cancelled it stay on your profile.
              </p>
              {cancelError && (
                <p className="text-[11px] text-destructive text-center">{cancelError}</p>
              )}
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setCancelModalOpen(false)
                    setCancelError(null)
                  }}
                  className="flex-1 font-semibold"
                >
                  Keep my plan
                </Button>
                <Button
                  variant="destructive"
                  onClick={handleConfirmCancel}
                  disabled={cancelling}
                  className="flex-1 font-bold"
                >
                  {cancelling ? 'Cancelling…' : 'Yes, Cancel'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
