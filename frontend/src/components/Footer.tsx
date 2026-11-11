'use client'

import React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Wifi, Phone, Mail, MapPin, Facebook, Youtube } from 'lucide-react'
import { useTranslation } from '@/store/settingsStore'
import { useContentStore } from '@/store/contentStore'
import { useAuthStore } from '@/store/authStore'
import { useMounted } from '@/lib/useMounted'

export function Footer() {
  const router = useRouter()
  const { t } = useTranslation()
  const { brand } = useContentStore()
  const { isAuthenticated } = useAuthStore()
  const mounted = useMounted()
  const authed = mounted && isAuthenticated

  const handleProtectedAction = (e: React.MouseEvent, targetHref: string = '/dashboard') => {
    e.preventDefault()
    if (!authed) {
      router.push('/login')
    } else {
      router.push(targetHref)
    }
  }

  const subscriberServices = [
    { label: 'Online Bill Payment', href: '/dashboard' },
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
    { label: 'Invoice & Billing Receipts', href: '/dashboard' },
  ]

  return (
    <footer className="bg-muted/70 border-t border-border mt-auto">
      <div className="container mx-auto px-4 py-10 max-w-6xl">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
          {/* Brand (Supports 260x70 size web logo) */}
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

          {/* Useful Section 1: Subscriber Services (Redirects to Login before login) */}
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

          {/* Useful Section 2: Helpdesk & Tools (Redirects to Login before login) */}
          <div>
            <h3 className="font-bold mb-4 text-foreground text-sm uppercase tracking-wider">Helpdesk & Tools</h3>
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
              Global NOC & Support
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

        <div className="border-t border-border mt-10 pt-6 text-center text-xs text-muted-foreground">
          <p>© {new Date().getFullYear()} {brand?.name || 'NextLink Global'}. All rights reserved. Tier-1 Optical Infrastructure.</p>
        </div>
      </div>
    </footer>
  )
}
