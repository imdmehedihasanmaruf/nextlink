'use client'

import React, { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Menu, X, Wifi, User, LogOut, Bell } from 'lucide-react'
import { useTranslation } from '@/store/settingsStore'
import { useAuthStore } from '@/store/authStore'
import { useContentStore } from '@/store/contentStore'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useMounted } from '@/lib/useMounted'
import { NotificationSidebar } from '@/components/NotificationSidebar'

function cleanNameValue(val: unknown): string {
  if (typeof val !== 'string') return ''
  const trimmed = val.trim()
  const lower = trimmed.toLowerCase()
  if (!trimmed || lower === 'null' || lower === 'undefined' || lower === 'nan') {
    return ''
  }
  return trimmed
}

export function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const [notifOpen, setNotifOpen] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)
  const pathname = usePathname()
  const router = useRouter()
  const { t } = useTranslation()
  const { user, isAuthenticated, logout } = useAuthStore()
  const { brand, nav, notice, fetchContent } = useContentStore()

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
  const mounted = useMounted()
  const authed = mounted && isAuthenticated

  // Extract user last name only for Header Greeting (e.g., "Hi, Doe")
  // Replaces first-name requirement: First name must NOT appear in header bar unless last_name is missing (fallback).
  const rawLastName = cleanNameValue(user?.lastName)
  const rawFirstName = cleanNameValue(user?.firstName)
  const rawFullName = cleanNameValue(user?.name)
  const nameParts = rawFullName ? rawFullName.split(/\s+/) : []
  const derivedLastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : ''
  const derivedFirstName = nameParts.length > 0 ? nameParts[0] : ''
  const emailUsername =
    typeof user?.email === 'string' && user.email.includes('@')
      ? cleanNameValue(user.email.split('@')[0])
      : ''
  const rawUsername = cleanNameValue(user?.username)

  // Priority order:
  // 1. Explicit user.lastName
  // 2. Derived last name from user.name (when multiple words)
  // 3. Fallback: user.firstName (for legacy users who registered before last_name was split)
  // 4. Fallback: derived first name from user.name
  // 5. Fallback: email username
  // 6. Fallback: raw username
  // 7. Generic fallback: 'User'
  const displayLastName =
    rawLastName ||
    derivedLastName ||
    rawFirstName ||
    derivedFirstName ||
    emailUsername ||
    rawUsername ||
    'User'

  // Full name for hover tooltip
  const fullNameTooltip =
    rawFullName ||
    (rawFirstName && rawLastName ? `${rawFirstName} ${rawLastName}` : '') ||
    displayLastName

  // Navigation links: Home, Packages, My Orders (if auth), Coverage, Settings, Tickets
  const navLinks = [
    { href: homeHref, label: authed ? t('dashboard') : (nav?.homeEn || t('home')), isHome: true },
    { href: '/packages', label: 'Packages' },
    ...(authed ? [{ href: '/dashboard/orders', label: 'My Orders', isHome: false }] : []),
    { href: '/coverage', label: nav?.coverageEn || t('coverage') },
    { href: '/settings', label: t('settings') },
    { href: '/tickets', label: nav?.supportEn || 'Tickets' },
  ]

  return (
    <>
      <header className="sticky top-0 z-40 w-full border-b border-border bg-background/95 backdrop-blur-md">
        {mounted && notice?.active && notice?.textEn && (
          <div className="bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground shadow-sm">
            <div className="container mx-auto max-w-6xl flex items-center justify-center gap-2 text-center">
              <span className="inline-block h-2 w-2 rounded-full bg-emerald-300 animate-pulse" />
              <span>{notice.textEn}</span>
            </div>
          </div>
        )}

        <div className="container mx-auto flex min-h-[76px] items-center justify-between px-4 max-w-6xl py-1">
          {/* Brand Logo */}
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

          {/* Right Section: Auth, Greeting, Bell & Quick Controls */}
          <div className="hidden md:flex items-center gap-2 shrink-0">
            {authed ? (
              <div className="flex items-center gap-2">
                {/* Notification Bell Icon with Unread Badge (Requirement 13) */}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setNotifOpen(true)}
                  className="relative h-9 w-9 p-0 rounded-lg text-foreground hover:bg-muted/80 transition-colors shrink-0"
                  title="Notifications"
                  aria-label="Open Notifications"
                >
                  <Bell size={18} />
                  {unreadCount > 0 && (
                    <span
                      data-testid="subscriber-notif-badge"
                      className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-600 px-1 text-[9px] font-bold text-white shadow"
                    >
                      {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                  )}
                </Button>

                {/* Header Greeting with Last Name Only */}
                <Link href="/profile">
                  <Button
                    variant={pathname === '/profile' ? 'default' : 'secondary'}
                    size="sm"
                    className="gap-1.5 font-semibold shadow-sm h-9 max-w-[140px] sm:max-w-[170px] md:max-w-[200px]"
                    title={fullNameTooltip}
                    data-testid="header-greeting"
                  >
                    <User size={14} className="shrink-0" />
                    <span className="truncate">Hi, {displayLastName}</span>
                  </Button>
                </Link>

                <Button
                  onClick={handleLogout}
                  variant="destructive"
                  size="sm"
                  className="gap-1.5 font-semibold shadow-sm h-9 shrink-0"
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

          {/* Mobile Controls */}
          <div className="flex md:hidden items-center gap-1.5">
            {authed && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setNotifOpen(true)}
                className="relative h-9 w-9 p-0 rounded-lg text-foreground"
                aria-label="Open Notifications"
              >
                <Bell size={18} />
                {unreadCount > 0 && (
                  <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-600 px-1 text-[9px] font-bold text-white">
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
              </Button>
            )}
            <button
              onClick={() => setMobileOpen(!mobileOpen)}
              className="p-2 rounded-lg text-foreground hover:bg-muted transition-colors"
              aria-label="Toggle Navigation"
            >
              {mobileOpen ? <X size={22} /> : <Menu size={22} />}
            </button>
          </div>
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
                      setMobileOpen(false)
                      if (isHome) handleHomeClick(e)
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
                {authed ? (
                  <div className="flex flex-col gap-2">
                    <Link href="/profile" onClick={() => setMobileOpen(false)}>
                      <Button variant="secondary" className="w-full justify-start gap-2" title={fullNameTooltip}>
                        <User size={16} className="shrink-0" />
                        <span className="truncate">Hi, {displayLastName} ({t('profile')})</span>
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

      <NotificationSidebar
        open={notifOpen}
        onClose={() => setNotifOpen(false)}
        onUnreadCountChange={setUnreadCount}
      />
    </>
  )
}
