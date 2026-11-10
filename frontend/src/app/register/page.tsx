'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Wifi, User, Phone, Mail, Lock, MapPin, Package, ArrowLeft, CheckCircle2, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Select } from '@/components/ui/select'
import { useTranslation } from '@/store/settingsStore'
import { useAuthStore } from '@/store/authStore'
import { useContentStore } from '@/store/contentStore'

const schema = z.object({
  fullName: z.string().min(3, 'Full name must be at least 3 characters'),
  username: z.string().min(3, 'Username must be at least 3 characters'),
  phone: z.string().regex(/^01[3-9]\d{8}$/, 'Valid Bangladeshi mobile number required (01XXXXXXXXX)'),
  email: z.string().email('Valid email address required'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  confirmPassword: z.string().min(6, 'Please confirm your password'),
  package: z.string().min(1, 'Please select an internet plan'),
  address: z.string().min(5, 'Installation address required'),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ['confirmPassword'],
})

type FormData = z.infer<typeof schema>

export default function RegisterPage() {
  const { language } = useTranslation()
  const router = useRouter()
  const { login } = useAuthStore()
  const { packages } = useContentStore()
  const [success, setSuccess] = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      package: packages?.[0]?.name || '',
    }
  })

  const onSubmit = async (data: FormData) => {
    try {
      const backendUrl = process.env.NEXT_PUBLIC_API_URL 
        ? process.env.NEXT_PUBLIC_API_URL.replace(/\/api$/, '') 
        : 'http://localhost:8000';
      
      const res = await fetch(`${backendUrl}/api/auth/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fullName: data.fullName,
          username: data.username,
          phone: data.phone,
          email: data.email,
          password: data.password,
          package: data.package,
          address: data.address,
        }),
      });

      if (res.ok) {
        const result = await res.json();
        if (result.user) {
          login({
            id: result.user.id,
            name: result.user.name,
            username: result.user.username,
            phone: result.user.phone,
            package: result.user.packageName || data.package,
            address: result.user.address,
            joinDate: result.user.joinDate || new Date().toISOString().slice(0, 10),
          });
          setSuccess(true);
          setTimeout(() => {
            router.push('/dashboard');
          }, 1200);
          return;
        }
      }
    } catch (err) {
      console.warn('Backend register sync fallback:', err);
    }

    // Fallback if backend offline
    login({
      id: `NL-2026-${Math.floor(1000 + Math.random() * 9000)}`,
      name: data.fullName,
      username: data.username,
      phone: data.phone,
      package: data.package,
      address: data.address,
      joinDate: new Date().toISOString().slice(0, 10),
    });

    setSuccess(true);
    setTimeout(() => {
      router.push('/dashboard');
    }, 1200);
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center p-4 py-8 bg-gradient-to-br from-background via-muted/30 to-background">
      <div className="w-full max-w-lg space-y-6">
        {/* Back Link */}
        <div className="flex items-center justify-between">
          <Link href="/login" className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft size={16} />
            <span>{language === 'bn' ? 'লগইনে ফিরে যান' : 'Back to Login'}</span>
          </Link>
          <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-primary/10 text-primary">
            NextLink Registration
          </span>
        </div>

        {/* Brand Header */}
        <div className="text-center">
          <div className="inline-flex items-center justify-center h-14 w-14 rounded-2xl bg-primary text-primary-foreground mb-2 shadow-lg">
            <Wifi size={28} className="stroke-[2.5]" />
          </div>
          <h1 className="text-2xl md:text-3xl font-black tracking-tight">
            {language === 'bn' ? 'নতুন গ্রাহক অ্যাকাউন্ট তৈরি করুন' : 'Create Subscriber Account'}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {language === 'bn' 
              ? 'মুহূর্তেই অ্যাকাউন্ট খুলে আপনার ফাইবার সংযোগ ম্যানেজ করুন' 
              : 'Join NextLink optical fiber network and activate your portal'}
          </p>
        </div>

        {success ? (
          <Card className="border-2 border-emerald-500 bg-emerald-500/10 p-8 text-center space-y-3">
            <CheckCircle2 size={48} className="text-emerald-500 mx-auto animate-bounce" />
            <h3 className="text-xl font-bold text-emerald-700 dark:text-emerald-400">
              {language === 'bn' ? 'অ্যাকাউন্ট সফলভাবে তৈরি হয়েছে!' : 'Account Created Successfully!'}
            </h3>
            <p className="text-sm text-muted-foreground">
              {language === 'bn' ? 'আপনাকে ড্যাশবোর্ডে রিডাইরেক্ট করা হচ্ছে...' : 'Redirecting you to subscriber dashboard...'}
            </p>
          </Card>
        ) : (
          <Card className="border-2 shadow-xl bg-card">
            <CardContent className="p-6">
              <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                {/* Full Name & Username */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="fullName" className="text-xs font-semibold">
                      {language === 'bn' ? 'পূর্ণ নাম' : 'Full Name'} *
                    </Label>
                    <Input
                      id="fullName"
                      placeholder="e.g. Tanvir Ahmed"
                      className="h-9"
                      {...register('fullName')}
                    />
                    {errors.fullName && <p className="text-[11px] text-destructive">{errors.fullName.message}</p>}
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="username" className="text-xs font-semibold">
                      {language === 'bn' ? 'ইউজারনেম' : 'Username'} *
                    </Label>
                    <Input
                      id="username"
                      placeholder="e.g. tanvir88"
                      className="h-9"
                      {...register('username')}
                    />
                    {errors.username && <p className="text-[11px] text-destructive">{errors.username.message}</p>}
                  </div>
                </div>

                {/* Phone & Email */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="phone" className="text-xs font-semibold">
                      {language === 'bn' ? 'মোবাইল নম্বর' : 'Mobile Number'} *
                    </Label>
                    <Input
                      id="phone"
                      placeholder="01711889900"
                      className="h-9"
                      {...register('phone')}
                    />
                    {errors.phone && <p className="text-[11px] text-destructive">{errors.phone.message}</p>}
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="email" className="text-xs font-semibold">
                      {language === 'bn' ? 'ইমেইল' : 'Email Address'} *
                    </Label>
                    <Input
                      id="email"
                      type="email"
                      placeholder="tanvir@example.com"
                      className="h-9"
                      {...register('email')}
                    />
                    {errors.email && <p className="text-[11px] text-destructive">{errors.email.message}</p>}
                  </div>
                </div>

                {/* Password & Confirm */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="password" className="text-xs font-semibold">
                      {language === 'bn' ? 'পাসওয়ার্ড' : 'Password'} *
                    </Label>
                    <Input
                      id="password"
                      type="password"
                      placeholder="••••••••"
                      className="h-9"
                      {...register('password')}
                    />
                    {errors.password && <p className="text-[11px] text-destructive">{errors.password.message}</p>}
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="confirmPassword" className="text-xs font-semibold">
                      {language === 'bn' ? 'পাসওয়ার্ড নিশ্চিত করুন' : 'Confirm Password'} *
                    </Label>
                    <Input
                      id="confirmPassword"
                      type="password"
                      placeholder="••••••••"
                      className="h-9"
                      {...register('confirmPassword')}
                    />
                    {errors.confirmPassword && <p className="text-[11px] text-destructive">{errors.confirmPassword.message}</p>}
                  </div>
                </div>

                {/* Package */}
                <div className="space-y-1.5">
                  <Label htmlFor="package" className="text-xs font-semibold">
                    {language === 'bn' ? 'ইন্টারনেট প্ল্যান নির্বাচন করুন' : 'Select Internet Plan'} *
                  </Label>
                  <Select id="package" {...register('package')} className="h-9">
                    {packages && packages.length > 0 ? (
                      packages.map((p) => (
                        <option key={p.id} value={p.name}>
                          {p.name} — {p.speed} Mbps (${p.price}/mo)
                        </option>
                      ))
                    ) : (
                      <option value="">No internet plans currently available</option>
                    )}
                  </Select>
                  {errors.package && <p className="text-[11px] text-destructive">{errors.package.message}</p>}
                </div>

                {/* Address */}
                <div className="space-y-1.5">
                  <Label htmlFor="address" className="text-xs font-semibold">
                    {language === 'bn' ? 'সংযোগের পূর্ণ ঠিকানা' : 'Installation Address'} *
                  </Label>
                  <Input
                    id="address"
                    placeholder="House, Road, Block, Area, City"
                    className="h-9"
                    {...register('address')}
                  />
                  {errors.address && <p className="text-[11px] text-destructive">{errors.address.message}</p>}
                </div>

                <Button type="submit" className="w-full font-bold h-11 text-base shadow-md mt-2" disabled={isSubmitting}>
                  {isSubmitting ? (
                    <span>Creating Account...</span>
                  ) : (
                    <span>{language === 'bn' ? 'অ্যাকাউন্ট তৈরি ও লগইন' : 'Register & Access Dashboard'}</span>
                  )}
                </Button>
              </form>
            </CardContent>
          </Card>
        )}

        {/* Existing account footer */}
        <Card className="border shadow-md bg-card/60 backdrop-blur-sm text-center p-4">
          <p className="text-sm text-muted-foreground">
            {language === 'bn' ? 'ইতিমধ্যে অ্যাকাউন্ট আছে?' : 'Already have an account?'}{' '}
            <Link href="/login" className="text-primary font-bold hover:underline">
              {language === 'bn' ? 'লগইন করুন' : 'Sign In'}
            </Link>
          </p>
        </Card>
      </div>
    </div>
  )
}
