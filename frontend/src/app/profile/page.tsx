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

export default function ProfilePage() {
  const router = useRouter()
  const { user, isAuthenticated, hasHydrated, updateUser, logout } = useAuthStore()
  const { t } = useTranslation()

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')
  const [savedSuccess, setSavedSuccess] = useState(false)
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)

  useEffect(() => {
    if (hasHydrated && !isAuthenticated) {
      router.push('/login')
    }
  }, [hasHydrated, isAuthenticated, router])

  useEffect(() => {
    if (user) {
      setName(user.name || '')
      setEmail(user.email || '')
      setPhone(user.phone || '')
      setAddress(user.address || '')
    }
  }, [user])

  const handleSaveProfile = (e: React.FormEvent) => {
    e.preventDefault()
    updateUser({
      name,
      email,
      phone,
      address,
    })
    setSavedSuccess(true)
    setTimeout(() => setSavedSuccess(false), 3000)
  }

  const handleConfirmDelete = () => {
    logout()
    router.push('/')
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
        <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/30 px-3 py-1 text-xs font-bold">
          Active Subscription
        </Badge>
      </div>

      {savedSuccess && (
        <div className="rounded-xl border border-emerald-500/50 bg-emerald-500/10 p-4 text-emerald-600 dark:text-emerald-400 flex items-center gap-2 animate-in fade-in">
          <Check className="h-5 w-5" />
          <span>{t('savedSuccess')}</span>
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
                  <Wifi size={12} /> 100% Optical Gigabit
                </Badge>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

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
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="name">{t('fullName')}</Label>
                <Input 
                  id="name" 
                  value={name} 
                  onChange={(e) => setName(e.target.value)} 
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
              <Button type="submit" className="gap-2 font-bold shadow">
                <Save size={16} />
                <span>{t('saveChanges')}</span>
              </Button>
            </div>
          </CardContent>
        </Card>
      </form>

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
            Once confirmed, your PPPoE session will be disconnected from the optical switch and all auto-debits terminated.
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in">
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
                This will delete your subscriber credentials, log you out immediately, and disable your optical drop.
              </p>
              <div className="flex gap-2">
                <Button 
                  variant="outline" 
                  onClick={() => setDeleteModalOpen(false)}
                  className="flex-1 font-semibold"
                >
                  Cancel
                </Button>
                <Button 
                  variant="destructive" 
                  onClick={handleConfirmDelete}
                  className="flex-1 font-bold"
                >
                  Yes, Terminate Account
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
