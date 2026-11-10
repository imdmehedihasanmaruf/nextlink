'use client'

import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { FileText, Upload, CheckCircle, User, Phone, Mail, Globe, MapPin, Package, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { useTranslation, useSettingsStore } from '@/store/settingsStore'
import { useContentStore } from '@/store/contentStore'
import { useAuthStore } from '@/store/authStore'

const schema = z.object({
  fullName: z.string().min(3, 'Full name must be at least 3 characters'),
  phone: z.string().min(7, 'Enter a valid international phone number (e.g. +1 555-0100)'),
  email: z.string().email('Enter a valid email address').optional().or(z.literal('')),
  idNumber: z.string().min(6, 'Passport or Government ID must be at least 6 characters'),
  address: z.string().min(10, 'Please provide full installation address with city and postal code'),
  package: z.string().min(1, 'Please select a fiber package'),
  ontConfig: z.string().min(1, 'Please select ONT / Optical router setup'),
  referral: z.string().optional(),
})

type FormData = z.infer<typeof schema>

const AUTO_SAVE_KEY = 'nextlink-apply-form'

const defaultPackages: { value: string; label: string }[] = []

const ontOptions = [
  { value: 'router', label: 'Wi-Fi 6 Gateway Mode (NAT + IPv6) - Recommended' },
  { value: 'bridge', label: 'Optical Bridge Mode - For Custom Firewall / Edge Routers' },
  { value: 'pppoe', label: 'Direct PPPoE / Static Routed Subnet Mode' },
]

export default function ApplyPage() {
  const router = useRouter()
  const { isAuthenticated } = useAuthStore()
  const { t } = useTranslation()
  const { autoSave } = useSettingsStore()
  const { packages: livePackages, fetchContent } = useContentStore()
  const [submitted, setSubmitted] = useState(false)
  const [idPreview, setIdPreview] = useState<string | null>(null)

  useEffect(() => {
    fetchContent()
  }, [fetchContent])

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
  })

  const watchedValues = watch()

  // Auto-fill package from URL query params (e.g. ?package=PKG-001)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search)
      const pkgParam = params.get('package') || params.get('plan')
      if (pkgParam) {
        setValue('package', pkgParam)
      }
    }
  }, [setValue, livePackages])

  // Auto-save to localStorage
  useEffect(() => {
    if (!autoSave) return
    const saved = localStorage.getItem(AUTO_SAVE_KEY)
    if (saved) {
      try {
        const data = JSON.parse(saved) as Partial<FormData>
        Object.entries(data).forEach(([key, val]) => {
          if (val) setValue(key as keyof FormData, val as string)
        })
      } catch {}
    }
  }, [setValue, autoSave])

  useEffect(() => {
    if (!autoSave) return
    const { package: pkg, ontConfig, ...rest } = watchedValues
    localStorage.setItem(AUTO_SAVE_KEY, JSON.stringify({ ...rest, package: pkg, ontConfig }))
  }, [watchedValues, autoSave])

  const handleFormSubmit = (e: React.FormEvent) => {
    // If user is not authenticated, redirect to login page before submitting order
    if (!isAuthenticated) {
      e.preventDefault()
      router.push('/login?redirect=apply')
      return
    }
    handleSubmit(onSubmit)(e)
  }

  const onSubmit = async (data: FormData) => {
    if (!isAuthenticated) {
      router.push('/login?redirect=apply')
      return
    }
    await new Promise((r) => setTimeout(r, 1200))
    localStorage.removeItem(AUTO_SAVE_KEY)
    setSubmitted(true)
  }

  const handleIdUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      const reader = new FileReader()
      reader.onload = (ev) => setIdPreview(ev.target?.result as string)
      reader.readAsDataURL(file)
    }
  }

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <Card className="max-w-md w-full text-center shadow-xl border">
          <CardContent className="pt-10 pb-10">
            <div className="h-20 w-20 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center mx-auto mb-6">
              <CheckCircle size={40} className="text-emerald-500" />
            </div>
            <h2 className="text-2xl font-bold mb-3">Service Order Submitted!</h2>
            <p className="text-muted-foreground mb-6">
              Our global NOC provisioning team will review your optical fiber drop and schedule physical installation.
            </p>
            <div className="bg-muted rounded-lg p-4 mb-6 text-left">
              <p className="text-xs text-muted-foreground mb-1">Global Reference Order</p>
              <p className="font-mono font-bold text-lg text-primary">NLG-{Date.now().toString().slice(-8)}</p>
            </div>
            <Button onClick={() => setSubmitted(false)} className="w-full font-bold">Submit Another Order</Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const packageList = livePackages && livePackages.length > 0
    ? livePackages.map(p => ({ value: p.id, label: `${p.name} - $${p.price}/month` }))
    : defaultPackages

  return (
    <div className="min-h-screen py-10 px-4 bg-background">
      <div className="container mx-auto max-w-2xl">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center h-16 w-16 rounded-full bg-primary/10 mb-4 shadow-sm">
            <FileText size={28} className="text-primary" />
          </div>
          <h1 className="text-3xl font-extrabold mb-2 tracking-tight">Order Global Optical Fiber</h1>
          <p className="text-muted-foreground">Direct Tier-1 symmetrical gigabit connectivity delivered to your premises.</p>
          {autoSave && (
            <div className="mt-3 inline-flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 rounded-full px-3 py-1 font-semibold">
              <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Auto-save enabled
            </div>
          )}
        </div>

        <form onSubmit={handleFormSubmit}>
          {/* Personal Info */}
          <Card className="mb-6 shadow-sm border">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <User size={18} className="text-primary" /> Subscriber Information
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="fullName">{t('fullName')} *</Label>
                  <Input id="fullName" placeholder="e.g. John Miller" {...register('fullName')} />
                  {errors.fullName && <p className="text-xs text-destructive">{errors.fullName.message}</p>}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="phone">{t('phone')} *</Label>
                  <Input id="phone" placeholder="+1 (555) 012-3456" {...register('phone')} />
                  {errors.phone && <p className="text-xs text-destructive">{errors.phone.message}</p>}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="email">{t('email')} *</Label>
                <Input id="email" type="email" placeholder="john.miller@example.com" {...register('email')} />
                {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="idNumber">{t('passportOrId')} *</Label>
                <Input id="idNumber" placeholder="Passport No. or Government National ID" {...register('idNumber')} />
                {errors.idNumber && <p className="text-xs text-destructive">{errors.idNumber.message}</p>}
              </div>
            </CardContent>
          </Card>

          {/* ID Document Upload */}
          <Card className="mb-6 shadow-sm border">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Upload size={18} className="text-primary" /> Identity Verification Document
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="border-2 border-dashed border-border rounded-lg p-6 text-center hover:border-primary transition-colors">
                <input
                  type="file"
                  accept="image/*,.pdf"
                  id="idDoc"
                  className="hidden"
                  onChange={handleIdUpload}
                />
                {idPreview ? (
                  <div>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={idPreview} alt="ID preview" className="max-h-32 mx-auto rounded mb-3 object-contain" />
                    <label htmlFor="idDoc" className="cursor-pointer text-sm text-primary underline font-medium">Change document</label>
                  </div>
                ) : (
                  <label htmlFor="idDoc" className="cursor-pointer">
                    <Upload size={32} className="mx-auto mb-2 text-muted-foreground" />
                    <p className="text-sm font-semibold">Upload Passport or Government ID Copy</p>
                    <p className="text-xs text-muted-foreground mt-1">PDF, JPG, PNG accepted. Max 10MB.</p>
                  </label>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Installation Details */}
          <Card className="mb-6 shadow-sm border">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <MapPin size={18} className="text-primary" /> Installation Premises
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="address">{t('address')} *</Label>
                <Textarea
                  id="address"
                  placeholder="Street address, building, floor/suite, city, country, postal code"
                  rows={3}
                  {...register('address')}
                />
                {errors.address && <p className="text-xs text-destructive">{errors.address.message}</p>}
              </div>
            </CardContent>
          </Card>

          {/* Service Configuration */}
          <Card className="mb-6 shadow-sm border">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Package size={18} className="text-primary" /> Fiber Plan & Hardware Option
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="package">{t('ourPackages')} *</Label>
                <Select id="package" {...register('package')}>
                  <option value="">{packageList.length > 0 ? 'Select a plan...' : 'No plans currently available'}</option>
                  {packageList.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </Select>
                {errors.package && <p className="text-xs text-destructive">{errors.package.message}</p>}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="ontConfig">Optical Terminal (ONT) Mode *</Label>
                <Select id="ontConfig" {...register('ontConfig')}>
                  <option value="">Select device mode...</option>
                  {ontOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
                {errors.ontConfig && <p className="text-xs text-destructive">{errors.ontConfig.message}</p>}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="referral">Referral Code (Optional - Get $25 Bill Credit)</Label>
                <Input id="referral" placeholder="e.g. NL-GLOBAL-REF" {...register('referral')} />
              </div>
            </CardContent>
          </Card>

          <Button type="submit" size="lg" className="w-full font-bold shadow-lg" disabled={isSubmitting}>
            {isSubmitting ? 'Provisioning...' : 'Submit Optical Connection Order'}
          </Button>
        </form>
      </div>
    </div>
  )
}
