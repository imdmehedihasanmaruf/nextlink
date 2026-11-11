'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Wifi, User, Phone, Mail, Lock, AlertCircle, ArrowLeft, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { useTranslation } from '@/store/settingsStore'
import { useAuthStore } from '@/store/authStore'

export default function RegisterPage() {
  useTranslation()
  const router = useRouter()
  // We only mirror a lightweight session so the user lands on the purchase page
  const { login } = useAuthStore()

  const [form, setForm] = useState({
    fullName: '',
    username: '',
    phone: '',
    email: '',
    password: '',
    confirmPassword: '',
  })
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)

  const handleChange = (field: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [field]: e.target.value }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (form.password !== form.confirmPassword) {
      setError('Passwords do not match')
      return
    }

    setSaving(true)
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const payload = await res.json().catch(() => ({}))
      if (!res.ok || payload.success === false) {
        setError(payload.error || 'Could not create the account. Please try again.')
        return
      }

      // Light session mirror so the purchase wizard can read the user details.
      login({
        id: payload.subscriberId || form.username,
        name: form.fullName,
        username: form.username,
        phone: form.phone,
        email: form.email,
        package: '',
        packageId: '',
        address: '',
        joinDate: new Date().toISOString().slice(0, 10),
        status: 'registered',
        balance: 0,
      })

      setSuccess(true)
    } catch {
      setError('The registration service is currently unavailable. Please try again later.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen w-full flex items-center justify-center p-4 py-8 bg-gradient-to-br from-background via-muted/30 to-background">
      <div className="w-full max-w-lg space-y-6">
        <Link href="/login" className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft size={16} /> Back to Login
        </Link>

        <div className="text-center">
          <div className="inline-flex items-center justify-center h-14 w-14 rounded-2xl bg-primary text-primary-foreground mb-2 shadow-lg">
            <Wifi size={28} className="stroke-[2.5]" />
          </div>
          <h1 className="text-2xl md:text-3xl font-black tracking-tight">Create Your Account</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Register first — your service activates only after you purchase a package plan.
          </p>
        </div>

        {success ? (
          <Card className="border-2 border-emerald-500 bg-emerald-500/10 p-8 text-center space-y-4">
            <CheckCircle2 size={48} className="text-emerald-500 mx-auto" />
            <h3 className="text-xl font-bold text-emerald-700 dark:text-emerald-400">Account created</h3>
            <p className="text-sm text-muted-foreground">
              Sign in with your new credentials, then choose a package to activate your service.
            </p>
            <Button onClick={() => router.push('/login?redirect=purchase')} className="w-full h-11 font-bold">
              Continue to Login
            </Button>
          </Card>
        ) : (
          <Card className="border-2 shadow-xl bg-card">
            <CardHeader>
              <CardTitle>Portal registration</CardTitle>
              <CardDescription>A portal login account — your ISP service starts after you buy a plan.</CardDescription>
            </CardHeader>
            <CardContent>
              {error && (
                <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive flex items-start gap-2">
                  <AlertCircle size={16} className="shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}
              <form onSubmit={handleSubmit} className="space-y-3.5">
                <div className="space-y-1.5">
                  <Label htmlFor="fullName" className="text-xs font-semibold">Full Name *</Label>
                  <Input id="fullName" required value={form.fullName} onChange={handleChange('fullName')} className="h-9" placeholder="e.g. Tanvir Ahmed" />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="username" className="text-xs font-semibold">Username *</Label>
                    <Input id="username" required value={form.username} onChange={handleChange('username')} className="h-9" autoComplete="username" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="phone" className="text-xs font-semibold">Phone *</Label>
                    <Input id="phone" required value={form.phone} onChange={handleChange('phone')} className="h-9" placeholder="017XXXXXXXX" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="email" className="text-xs font-semibold">Email *</Label>
                  <Input id="email" type="email" required value={form.email} onChange={handleChange('email')} className="h-9" placeholder="you@example.com" />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="password" className="text-xs font-semibold">Password *</Label>
                    <Input id="password" type="password" required value={form.password} onChange={handleChange('password')} className="h-9" autoComplete="new-password" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="confirmPassword" className="text-xs font-semibold">Confirm Password *</Label>
                    <Input id="confirmPassword" type="password" required value={form.confirmPassword} onChange={handleChange('confirmPassword')} className="h-9" autoComplete="new-password" />
                  </div>
                </div>
                <Button type="submit" disabled={saving} className="w-full h-11 font-bold text-base shadow-md">
                  {saving ? 'Creating…' : 'Create Account'}
                </Button>
              </form>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
