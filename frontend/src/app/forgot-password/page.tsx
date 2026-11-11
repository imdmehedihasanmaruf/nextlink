'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { Wifi, ArrowLeft, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'

export default function ForgotPasswordPage() {
  const [username, setUsername] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim() }),
      })
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}))
        setError(payload.error || 'Could not process the request. Please try again.')
        return
      }
      setSent(true)
    } catch {
      setError('The authentication service is currently unavailable. Please try again later.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen w-full flex items-center justify-center p-4 bg-gradient-to-br from-background via-muted/30 to-background">
      <div className="w-full max-w-md space-y-6">
        <Link href="/login" className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft size={16} /> Back to Login
        </Link>

        <div className="text-center">
          <div className="inline-flex items-center justify-center h-14 w-14 rounded-2xl bg-primary text-primary-foreground mb-3 shadow-lg">
            <Wifi size={26} className="stroke-[2.5]" />
          </div>
          <h1 className="text-2xl font-black tracking-tight">Reset Your Password</h1>
          <p className="text-sm text-muted-foreground mt-1">Enter your subscriber username or phone number. We will send a temporary password to the phone number on file.</p>
        </div>

        <Card className="border-2 shadow-xl bg-card">
          <CardHeader>
            <CardTitle>Account recovery</CardTitle>
            <CardDescription>Check your registered phone for the temporary password.</CardDescription>
          </CardHeader>
          <CardContent>
            {sent ? (
              <div className="text-center space-y-4">
                <CheckCircle2 size={40} className="text-emerald-500 mx-auto" />
                <p className="font-semibold">Temporary password sent</p>
                <p className="text-sm text-muted-foreground">If the account exists, a temporary password has been sent to the registered phone number. Use it to sign in and change the password from Settings.</p>
                <Link href="/login">
                  <Button className="w-full h-11 font-bold">Go to Sign In</Button>
                </Link>
              </div>
            ) : (
              <form onSubmit={onSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="username" className="font-semibold text-sm">Username or Phone</Label>
                  <Input
                    id="username"
                    placeholder="e.g. alexwright or 017..."
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required
                    className="h-10"
                  />
                </div>
                {error && (
                  <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive flex items-start gap-2">
                    <span>{error}</span>
                  </div>
                )}
                <Button type="submit" disabled={loading} className="w-full h-11 font-bold">
                  {loading ? 'Sending…' : 'Send Temporary Password'}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
