'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Wifi, Phone, Mail, MapPin, Facebook, Youtube, Terminal, Globe, Clock, Shield, Lock } from 'lucide-react'
import { useContentStore } from '@/store/contentStore'
import { useAuthStore } from '@/store/authStore'
import { useMounted } from '@/lib/useMounted'
import { getSubscriberToken } from '@/lib/portalApi'

interface SessionMeta {
  version: string
  ip: string
  region: string
  lastLogin: string | null
  userMode: 'Enabled' | 'Disabled'
  encryption: string
  copyrightYears: string
}

export function Footer() {
  const router = useRouter()
  const { brand } = useContentStore()
  const { user, isAuthenticated } = useAuthStore()
  const mounted = useMounted()
  const authed = mounted && isAuthenticated

  const currentYear = new Date().getUTCFullYear()
  const nextYear = currentYear + 1

  const [meta, setMeta] = useState<SessionMeta>({
    version: 'To be implemented',
    ip: 'Detecting...',
    region: 'Unknown',
    lastLogin: null,
    userMode: authed ? 'Enabled' : 'Disabled',
    encryption: 'Detecting...',
    copyrightYears: `${currentYear}–${nextYear}`,
  })

  const loadSessionMeta = useCallback(async () => {
    try {
      const qs = new URLSearchParams({ context: 'frontend' })
      if (user?.id) qs.set('userId', user.id)
      if (user?.email) qs.set('email', user.email)

      const headers: Record<string, string> = {}
      const token = getSubscriberToken()
      if (token) headers.Authorization = `Bearer ${token}`

      const res = await fetch(`/api/auth/session-meta?${qs.toString()}`, {
        method: 'GET',
        headers,
      })
      const payload = await res.json().catch(() => ({}))
      if (payload?.success) {
        setMeta({
          version: payload.version || 'To be implemented',
          ip: payload.ip || '127.0.0.1',
          region: payload.region || 'Unknown',
          lastLogin: payload.lastLogin || null,
          userMode: authed ? 'Enabled' : 'Disabled',
          encryption: payload.encryption || 'HTTP/1.1 (Unencrypted Loopback)',
          copyrightYears: payload.copyrightYears || `${currentYear}–${nextYear}`,
        })
      }
    } catch {
      setMeta((prev) => ({
        ...prev,
        userMode: authed ? 'Enabled' : 'Disabled',
        copyrightYears: `${currentYear}–${nextYear}`,
      }))
    }
  }, [user?.id, user?.email, authed, currentYear, nextYear])

  useEffect(() => {
    loadSessionMeta()
    const interval = setInterval(loadSessionMeta, 15000)
    return () => clearInterval(interval)
  }, [loadSessionMeta])

  const handleProtectedAction = (e: React.MouseEvent, targetHref: string = '/dashboard') => {
    e.preventDefault()
    if (!authed) {
      router.push('/login')
    } else {
      router.push(targetHref)
    }
  }

  const subscriberServices = [
    { label: 'Online Bill Payment', href: '/dashboard/orders' },
    { label: 'Turbo Boost on Request', href: '/dashboard' },
    { label: 'Upgrade Fiber Plan', href: '/packages' },
    { label: 'Line Shifting Request', href: '/tickets' },
    { label: 'Router Configuration Help', href: '/tickets' },
  ]

  const helpdeskTools = [
    { label: 'Submit Support Ticket', href: '/tickets' },
    { label: 'Speedtest (via CDN Peering)', href: '/dashboard' },
    { label: 'Configured Bandwidth Reference', href: '/dashboard' },
    { label: 'Referral Invite', href: '/dashboard' },
    { label: 'Invoice & Billing Receipts', href: '/dashboard/orders' },
  ]

  return (
    <footer className="bg-muted/70 border-t border-border mt-auto shrink-0">
      <div className="container mx-auto px-4 py-10 max-w-6xl">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
          {/* Brand */}
          <div className="space-y-3">
            {brand?.logoUrl ? (
              <div className="flex items-center">
                <img
                  src={brand.logoUrl}
                  alt={brand?.name || 'NextLink Global'}
                  width={260}
                  height={70}
                  className="w-[260px] h-[70px] max-w-[260px] max-h-[70px] object-contain"
                />
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <div className="flex items-center justify-center h-9 w-9 rounded-xl bg-primary text-primary-foreground shadow-sm">
                  <Wifi size={18} />
                </div>
                <span className="text-foreground font-extrabold text-xl tracking-tight">
                  {brand?.name || 'NextLink Global'}
                </span>
              </div>
            )}
            <p className="text-muted-foreground text-sm leading-relaxed">
              {brand?.tagline || 'Next-Gen Ultra Fast Optical Fiber & Global Gigabit Internet.'}
            </p>
            <div className="flex gap-3 pt-2">
              <a href={brand?.facebook || '#'} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-primary transition-colors">
                <Facebook size={20} />
              </a>
              <a href={brand?.youtube || '#'} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-primary transition-colors">
                <Youtube size={20} />
              </a>
            </div>
          </div>

          {/* Subscriber Services */}
          <div>
            <h3 className="font-bold mb-4 text-foreground text-sm uppercase tracking-wider">Subscriber Services</h3>
            <ul className="space-y-2">
              {subscriberServices.map((item) => (
                <li key={item.label}>
                  <a
                    href={!authed ? '/login' : item.href}
                    onClick={(e) => handleProtectedAction(e, item.href)}
                    className="text-muted-foreground hover:text-primary text-sm transition-colors block py-0.5 cursor-pointer"
                  >
                    {item.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          {/* Helpdesk & Tools */}
          <div>
            <h3 className="font-bold mb-4 text-foreground text-sm uppercase tracking-wider">Helpdesk &amp; Tools</h3>
            <ul className="space-y-2">
              {helpdeskTools.map((item) => (
                <li key={item.label}>
                  <a
                    href={!authed ? '/login' : item.href}
                    onClick={(e) => handleProtectedAction(e, item.href)}
                    className="text-muted-foreground hover:text-primary text-sm transition-colors block py-0.5 cursor-pointer"
                  >
                    {item.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          {/* Contact Details */}
          <div className="space-y-3">
            <h3 className="font-bold mb-4 text-foreground text-sm uppercase tracking-wider">
              Global NOC &amp; Support
            </h3>
            <div className="space-y-2.5 text-sm text-muted-foreground">
              <div className="flex items-start gap-2.5">
                <MapPin size={16} className="text-primary shrink-0 mt-0.5" />
                <span>{brand?.address || 'One World Trade Center, Suite 8500, New York, NY'}</span>
              </div>
              <div className="flex items-center gap-2.5">
                <Phone size={16} className="text-primary shrink-0" />
                <a href={`tel:${brand?.phone?.replace(/\s+/g, '') || '+8801575XXXXXX'}`} className="hover:text-primary font-medium transition-colors">
                  {brand?.phone || '+880 1575 XXXXXX'}
                </a>
              </div>
              <div className="flex items-center gap-2.5">
                <Mail size={16} className="text-primary shrink-0" />
                <a href={`mailto:${brand?.email || 'support@nextlink.global'}`} className="hover:text-primary transition-colors">
                  {brand?.email || 'support@nextlink.global'}
                </a>
              </div>
            </div>
            <div className="pt-2 border-t border-border/60">
              <p className="text-xs font-semibold text-primary">{brand?.officeHours || '24/7 Global NOC & Support'}</p>
              <p className="text-base font-bold text-foreground mt-0.5">{brand?.phone || '+880 1575 XXXXXX'}</p>
            </div>
          </div>
        </div>

        {/* Requirement 15: Frontend line + Telemetry Bar (Left Top, Right Top, Center Bottom) */}
        <div className="border-t border-border mt-10 pt-6 space-y-4 text-xs text-muted-foreground">
          {/* Frontend Line */}
          <p className="text-center font-medium">
            © {currentYear} {brand?.name || 'NextLink Global'}. All rights reserved. Tier-1 Optical Infrastructure.
          </p>

          {/* Left Top & Right Top Telemetry Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 rounded-xl border border-border/80 bg-background/60 p-4">
            {/* Left Top */}
            <div className="flex flex-col gap-1.5 text-left">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <span className="inline-flex items-center gap-1.5">
                  <Terminal size={13} className="text-primary shrink-0" />
                  <strong className="text-foreground font-semibold">Version:</strong>{' '}
                  <span data-testid="footer-version" className="font-mono">
                    {meta.version}
                  </span>
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Globe size={13} className="text-primary shrink-0" />
                  <strong className="text-foreground font-semibold">IP:</strong>{' '}
                  <span data-testid="footer-ip" className="font-mono">
                    {meta.ip}
                  </span>
                </span>
              </div>
              <div className="inline-flex items-center gap-1.5">
                <strong className="text-foreground font-semibold">Region:</strong>{' '}
                <span data-testid="footer-region">{meta.region}</span>
              </div>
            </div>

            {/* Right Top */}
            <div className="flex flex-col gap-1.5 md:items-end md:text-right">
              <div className="inline-flex items-center gap-1.5">
                <Clock size={13} className="text-primary shrink-0" />
                <strong className="text-foreground font-semibold">Last Login:</strong>{' '}
                <span data-testid="footer-last-login" className="font-mono">
                  {authed && meta.lastLogin ? meta.lastLogin : 'No previous login recorded'}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 md:justify-end">
                <span className="inline-flex items-center gap-1.5">
                  <Shield size={13} className="text-primary shrink-0" />
                  <strong className="text-foreground font-semibold">User Mode:</strong>{' '}
                  <span
                    data-testid="footer-user-mode"
                    className={
                      authed
                        ? 'font-semibold text-emerald-600 dark:text-emerald-400'
                        : 'font-semibold text-amber-600 dark:text-amber-400'
                    }
                  >
                    {authed ? 'Enabled' : 'Disabled'}
                  </span>
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Lock size={13} className="text-primary shrink-0" />
                  <strong className="text-foreground font-semibold">Encryption:</strong>{' '}
                  <span data-testid="footer-encryption" className="font-mono">
                    {meta.encryption}
                  </span>
                </span>
              </div>
            </div>
          </div>

          {/* Center Bottom */}
          <div className="pt-1 text-center text-[11px] font-semibold text-muted-foreground">
            © {currentYear}–{nextYear} | NextLink | All Rights Reserved.
          </div>
        </div>
      </div>
    </footer>
  )
}
