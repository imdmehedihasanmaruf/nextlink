'use client'

import React from 'react'
import Link from 'next/link'
import { Wifi, Phone, Mail, MapPin, Facebook, Youtube, Globe } from 'lucide-react'
import { useTranslation } from '@/store/settingsStore'
import { useContentStore } from '@/store/contentStore'

export function Footer() {
  const { t } = useTranslation()
  const { brand, packages, footer } = useContentStore()

  return (
    <footer className="bg-muted/70 border-t border-border mt-auto">
      <div className="container mx-auto px-4 py-10 max-w-6xl">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
          {/* Brand */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="flex items-center justify-center h-9 w-9 rounded-xl bg-primary text-primary-foreground shadow-sm">
                <Wifi size={18} />
              </div>
              <span className="text-foreground font-extrabold text-xl tracking-tight">
                {brand?.name || 'NextLink Global'}
              </span>
            </div>
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

          {/* Quick Links */}
          <div>
            <h3 className="font-bold mb-4 text-foreground text-sm uppercase tracking-wider">Navigation</h3>
            <ul className="space-y-2">
              {[
                { href: '/', label: t('home') },
                { href: '/coverage', label: t('coverage') },
                { href: '/apply', label: t('apply') },
                { href: '/dashboard', label: t('dashboard') },
                { href: '/profile', label: t('profile') },
                { href: '/settings', label: t('settings') },
              ].map(({ href, label }) => (
                <li key={href}>
                  <Link href={href} className="text-sm text-muted-foreground hover:text-primary transition-colors">
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Live Packages */}
          <div>
            <h3 className="font-bold mb-4 text-foreground text-sm uppercase tracking-wider">Worldwide Plans</h3>
            <ul className="space-y-2 text-sm text-muted-foreground">
              {packages?.slice(0, 5).map((p) => (
                <li key={p.id} className="flex items-center justify-between">
                  <span>{p.name}</span>
                  <span className="font-bold text-foreground">${p.price}/mo</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Contact */}
          <div>
            <h3 className="font-bold mb-4 text-foreground text-sm uppercase tracking-wider">
              Global NOC & Support
            </h3>
            <ul className="space-y-3">
              <li className="flex items-start gap-2 text-sm text-muted-foreground">
                <MapPin size={16} className="mt-0.5 text-primary shrink-0" />
                <span>{brand?.address || 'One World Trade Center, Suite 8500, New York, NY 10007, USA'}</span>
              </li>
              <li className="flex items-center gap-2 text-sm text-muted-foreground">
                <Phone size={16} className="text-primary shrink-0" />
                <a href={`tel:${brand?.phone || '+18005505465'}`} className="hover:text-primary font-medium transition-colors">
                  {brand?.phone || '+1 (800) 550-LINK'}
                </a>
              </li>
              <li className="flex items-center gap-2 text-sm text-muted-foreground">
                <Mail size={16} className="text-primary shrink-0" />
                <a href={`mailto:${brand?.email || 'support@nextlink.global'}`} className="hover:text-primary transition-colors">
                  {brand?.email || 'support@nextlink.global'}
                </a>
              </li>
            </ul>
            <div className="mt-4 p-3 bg-primary/10 border border-primary/20 rounded-xl">
              <p className="text-xs font-semibold text-primary">{brand?.officeHours || '24/7 Global NOC & Support'}</p>
              <p className="text-base font-bold text-foreground mt-0.5">{brand?.phone || '+1 (800) 550-LINK'}</p>
            </div>
          </div>
        </div>

        <div className="mt-10 pt-6 border-t border-border flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-muted-foreground">
          <p>© {new Date().getFullYear()} NextLink Global Fiber Technologies Inc. {footer?.copyrightEn || 'All rights reserved.'}</p>
          <div className="flex gap-4">
            <span className="hover:text-foreground cursor-pointer">Global Privacy Policy</span>
            <span className="hover:text-foreground cursor-pointer">Terms of Service</span>
            <span className="hover:text-foreground cursor-pointer">SLA Agreement</span>
          </div>
        </div>
      </div>
    </footer>
  )
}
