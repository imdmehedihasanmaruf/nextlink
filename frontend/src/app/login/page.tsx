'use client'

import React, { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Wifi, Eye, EyeOff, AlertCircle, ArrowLeft, UserPlus, LogIn, ShieldAlert, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { useTranslation } from '@/store/settingsStore'
import { useAuthStore } from '@/store/authStore'
import { subscriberLogin } from '@/lib/portalApi'

const schema = z.object({
  username: z.string().min(2, 'Username or Customer ID is required'),
  password: z.string().min(3, 'Password must be at least 3 characters'),
  rememberMe: z.boolean().optional(),
})

type FormData = z.infer<typeof schema>

function LoginForm() {
  const { language } = useTranslation()
  const router = useRouter()
  const searchParams = useSearchParams()
  const { login } = useAuthStore()
  const [showPassword, setShowPassword] = useState(false)
  const [loginError, setLoginError] = useState('')
  const [infoMessage, setInfoMessage] = useState('')

  const redirectParam = searchParams.get('redirect')

  useEffect(() => {
    if (redirectParam && redirectParam.includes('purchase')) {
      setInfoMessage(
        'Existing Customer Authentication Required: Internet package purchases, bandwidth upgrades, and plan changes are strictly restricted to authenticated NextLink customers. Please log in with your customer account.'
      )
    }
  }, [redirectParam])

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
  })

  const onSubmit = async (data: FormData) => {
    setLoginError('')
    try {
      const res = await fetch('/api/auth/customer-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: data.username.trim(),
          password: data.password.trim(),
        }),
      })

      const result = await res.json()

      if (!res.ok || !result.success) {
        setLoginError(result.error || 'Invalid customer username or password.')
        return
      }

      // Successful login
      login(result.user)

      // Obtain a token for the billing service so real invoice payment and
      // auto-reconnection work. The billing service may be offline during
      // local development — that must never block the portal sign-in.
      subscriberLogin(data.username.trim(), data.password.trim()).catch(() => undefined)

      const target = redirectParam || '/dashboard'
      router.push(target)
    } catch (err: any) {
      console.error('Login error:', err)
      setLoginError('Could not connect to authentication service. Please try again.')
    }
  }

  // Quick fill helper for existing customers
  const quickFill = (username: string, pass: string) => {
    setValue('username', username)
    setValue('password', pass)
    setLoginError('')
  }

  return (
    <div className="min-h-screen w-full flex items-center justify-center p-4 bg-gradient-to-br from-background via-muted/30 to-background">
      <div className="w-full max-w-md space-y-6">
        {/* Back to Home Button */}
        <div className="flex items-center justify-between">
          <Link href="/" className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft size={16} />
            <span>{language === 'bn' ? 'হোমে ফিরে যান' : 'Back to Home'}</span>
          </Link>
          <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-primary/10 text-primary">
            NextLink Portal
          </span>
        </div>

        {/* Brand Header */}
        <div className="text-center">
          <div className="inline-flex items-center justify-center h-16 w-16 rounded-2xl bg-primary text-primary-foreground mb-3 shadow-lg">
            <Wifi size={32} className="stroke-[2.5]" />
          </div>
          <h1 className="text-3xl font-black tracking-tight">
            {language === 'bn' ? 'গ্রাহক পোর্টাল লগইন' : 'Subscriber Login'}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {language === 'bn' 
              ? 'আপনার বিল, স্পিড ও কানেকশন ম্যানেজ করতে লগইন করুন' 
              : 'Sign in to access your bills, usage, and boost controls'}
          </p>
        </div>

        {/* Login Card */}
        <Card className="border-2 shadow-xl bg-card">
          <CardContent className="p-6 pt-6">
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              {loginError && (
                <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/30 text-destructive text-sm flex items-center gap-2">
                  <AlertCircle size={16} className="shrink-0" />
                  <span>{loginError}</span>
                </div>
              )}

              {/* Username */}
              <div className="space-y-1.5">
                <Label htmlFor="username" className="font-semibold text-sm">
                  {language === 'bn' ? 'ইউজারনেম বা মোবাইল নম্বর' : 'Username or Mobile'}
                </Label>
                <Input
                  id="username"
                  placeholder="e.g. subscriber_username"
                  autoComplete="username"
                  className="h-10"
                  {...register('username')}
                />
                {errors.username && <p className="text-xs text-destructive">{errors.username.message}</p>}
              </div>

              {/* Password */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password" className="font-semibold text-sm">
                    {language === 'bn' ? 'পাসওয়ার্ড' : 'Password'}
                  </Label>
                  <a href="#" className="text-xs text-primary font-medium hover:underline">
                    {language === 'bn' ? 'পাসওয়ার্ড ভুলে গেছেন?' : 'Forgot password?'}
                  </a>
                </div>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="••••••••"
                    autoComplete="current-password"
                    className="h-10 pr-10"
                    {...register('password')}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                {errors.password && <p className="text-xs text-destructive">{errors.password.message}</p>}
              </div>

              {/* Remember Me */}
              <div className="flex items-center justify-between text-xs">
                <label className="flex items-center gap-2 cursor-pointer font-medium text-muted-foreground">
                  <input type="checkbox" id="rememberMe" {...register('rememberMe')} className="rounded text-primary" />
                  <span>{language === 'bn' ? 'মনে রাখুন' : 'Remember me'}</span>
                </label>
              </div>

              {/* Submit Button */}
              <Button type="submit" className="w-full font-bold h-11 text-base shadow-md gap-2" disabled={isSubmitting}>
                {isSubmitting ? (
                  <span>Signing in...</span>
                ) : (
                  <>
                    <LogIn size={18} />
                    <span>{language === 'bn' ? 'লগইন করুন' : 'Sign In to Portal'}</span>
                  </>
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Register Prompt */}
        <Card className="border shadow-md bg-card/60 backdrop-blur-sm text-center p-4">
          <Link 
            href="/register" 
            className="text-primary font-bold hover:underline inline-flex items-center justify-center gap-1.5 text-sm"
          >
            <span>{language === 'bn' ? 'রেজিস্ট্রেশন করুন' : 'Register Now'}</span>
            <UserPlus size={15} />
          </Link>
        </Card>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-sm text-muted-foreground animate-pulse">Loading login portal...</div>
      </div>
    }>
      <LoginForm />
    </Suspense>
  )
}
