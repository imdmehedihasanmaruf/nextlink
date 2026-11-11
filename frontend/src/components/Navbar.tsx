'use client'

import React, { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Menu, X, Wifi, User, LogOut, ArrowRight, Sun, Moon } from 'lucide-react'
import { useTranslation, useSettingsStore } from '@/store/settingsStore'
import { useAuthStore } from '@/store/authStore'
import { useContentStore } from '@/store/contentStore'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useMounted } from '@/lib/useMounted'

export function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const pathname = usePathname()
  const router = useRouter()
  const { t } = useTranslation()
  const { theme, setTheme } = useSettingsStore()
  const { user, isAuthenticated, logout } = useAuthStore()
  const { brand, notice, fetchContent } = useContentStore()

  useEffect(() => {
    fetchContent()
  }, [fetchContent])

  const handleLogout = () => {
    logout()
    router.push('/login')
  }

  const handleHomeClick = (e: React.MouseEvent) => {
    if (authed) {
      if (pathname === '/dashboard') {
        e.preventDefault()
        window.location.reload()
      } else {
        e.preventDefault()
        router.push('/dashboard')
      }
    }
  }

  const homeHref = isAuthenticated ? '/dashboard' : '/'

  // The server render must match the first client render — the auth state is
  // only known on the client. Both renders show the signed-out defaults and
  // the gate switches once mounted.
  const mounted = useMounted()
  const authed = mounted && isAuthenticated

  // Navigation links: Home, Packages, My Orders (if auth), Coverage, Settings (next to Coverage), Tickets
  const navLinks = [
    { href: homeHref, label: authed ? t('dashboard') : t('home'), isHome: true },
    { href: '/packages', label: 'Packages' },
    ...(authed ? [{ href: '/dashboard/orders', label: 'My Orders', isHome: false }] : []),
    { href: '/coverage', label: t('coverage') },
    { href: '/settings', label: t('settings') },
    { href: '/tickets', label: 'Tickets' },
  ]

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border bg-background/95 backdrop-blur-md">
      {/* Optional Top Announcement Bar — rendered only after mount so the
          server and first client render agree on whether it exists */}
      {mounted && notice?.active && notice?.textEn && (
        <div className="bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground shadow-sm">
          <div className="container mx-auto max-w-6xl flex items-center justify-center gap-2 text-center">
            <span className="inline-block h-2 w-2 rounded-full bg-emerald-300 animate-pulse" />
            <span>{notice.textEn}</span>
          </div>
        </div>
      )}

      <div className="container mx-auto flex min-h-[76px] items-center justify-between px-4 max-w-6xl py-1">
        {/* Brand Logo (Supports 260x70 size web logo) */}
        <Link href={homeHref} onClick={handleHomeClick} className="flex items-center gap-2.5 font-bold group">
          {brand?.logoUrl ? (
            <div className="flex items-center justify-center">
              <img
                src={brand.logoUrl}
                alt={brand?.name || 'NextLink Global'}
                width={260}
                height={70}
                className="w-[260px] h-[70px] max-w-[260px] max-h-[70px] object-contain transition-transform group-hover:scale-[1.02]"
              />
            </div>
          ) : (
            <>
              <div className="flex items-center justify-center h-10 w-10 rounded-xl bg-primary text-primary-foreground shadow-md transition-transform group-hover:scale-105">
                <Wifi size={20} className="stroke-[2.5]" />
              </div>
              <div className="flex flex-col">
                <span className="text-foreground font-extrabold tracking-tight text-xl leading-none">
                  {brand?.name || 'NextLink Global'}
                </span>
                <span className="text-[10px] text-muted-foreground font-semibold tracking-wider uppercase mt-0.5">
                  {brand?.logoSubtitle || 'GLOBAL FIBER NETWORK'}
                </span>
              </div>
            </>
          )}
        </Link>

        {/* Desktop Navigation Links */}
        <div className="hidden md:flex items-center gap-1">
          {navLinks.map(({ href, label, isHome }) => (
            <Link
              key={href}
              href={href}
              onClick={isHome ? handleHomeClick : undefined}
              className={cn(
                'px-3.5 py-2 rounded-lg text-sm font-semibold transition-all',
                pathname === href
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-foreground hover:bg-muted/80'
              )}
            >
              {label}
            </Link>
          ))}
        </div>

        {/* Right Section: Auth & Quick Controls */}
        <div className="hidden md:flex items-center gap-2.5">
          {/* Quick Theme Toggle */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className="h-9 w-9 p-0 rounded-lg text-foreground hover:bg-muted/80 transition-colors"
            title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            aria-label="Toggle Theme"
          >
            {theme === 'dark' ? (
              <Sun size={17} className="text-amber-400" />
            ) : (
              <Moon size={17} className="text-slate-700" />
            )}
          </Button>

          {authed ? (
            <div className="flex items-center gap-2">
              <Link href="/profile">
                <Button 
                  variant={pathname === '/profile' ? 'default' : 'secondary'} 
                  size="sm" 
                  className="gap-1.5 font-semibold shadow-sm h-9"
                  title="View / Edit Profile"
                >
                  <User size={14} />
                  <span>{user?.name || t('profile')}</span>
                </Button>
              </Link>

              <Button 
                onClick={handleLogout} 
                variant="destructive" 
                size="sm" 
                className="gap-1.5 font-semibold shadow-sm h-9"
              >
                <LogOut size={14} />
                <span>{t('logout')}</span>
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Link href="/login">
                <Button size="sm" className="font-semibold gap-1.5 shadow-md h-9 hover:opacity-95 transition-all">
                  <User size={14} />
                  <span>{t('login')}</span>
                </Button>
              </Link>
            </div>
          )}
        </div>

        {/* Mobile menu button */}
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className="md:hidden p-2 rounded-lg text-foreground hover:bg-muted transition-colors"
          aria-label="Toggle Navigation"
        >
          {mobileOpen ? <X size={22} /> : <Menu size={22} />}
        </button>
      </div>

      {/* Mobile Drawer */}
      {mobileOpen && (
        <div className="md:hidden border-t border-border bg-background p-4 space-y-3 animate-in slide-in-from-top-2">
          <div className="container mx-auto max-w-6xl">
            <div className="flex flex-col gap-1">
              {navLinks.map(({ href, label, isHome }) => (
                <Link
                  key={href}
                  href={href}
                  onClick={(e) => {
                    setMobileOpen(false);
                    if (isHome) handleHomeClick(e);
                  }}
                  className={cn(
                    'px-3 py-2 rounded-lg text-sm font-semibold transition-colors',
                    pathname === href ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-muted'
                  )}
                >
                  {label}
                </Link>
              ))}
            </div>

            <div className="pt-3 border-t border-border space-y-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                className="w-full justify-center gap-2"
              >
                {theme === 'dark' ? (
                  <>
                    <Sun size={16} className="text-amber-400" />
                    <span>Light Mode</span>
                  </>
                ) : (
                  <>
                    <Moon size={16} className="text-slate-700" />
                    <span>Dark Mode</span>
                  </>
                )}
              </Button>

              {authed ? (
                <div className="flex flex-col gap-2">
                  <Link href="/profile" onClick={() => setMobileOpen(false)}>
                    <Button variant="secondary" className="w-full justify-start gap-2">
                      <User size={16} />
                      <span>{t('profile')}</span>
                    </Button>
                  </Link>
                  <Button onClick={handleLogout} variant="destructive" className="w-full justify-start gap-2">
                    <LogOut size={16} />
                    <span>{t('logout')}</span>
                  </Button>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <Link href="/login" onClick={() => setMobileOpen(false)}>
                    <Button className="w-full justify-center gap-2">
                      <User size={16} />
                      <span>{t('login')}</span>
                    </Button>
                  </Link>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </header>
  )
}
