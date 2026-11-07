'use client'

import React, { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { Navbar } from '@/components/Navbar'
import { Footer } from '@/components/Footer'
import { SettingsPanel } from '@/components/SettingsPanel'
import { useContentStore } from '@/store/contentStore'

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const isAuthPage = pathname === '/login' || pathname === '/register'
  const fetchContent = useContentStore((s) => s.fetchContent)

  useEffect(() => {
    fetchContent()
  }, [pathname, fetchContent])

  // If on login or register page: DO NOT render Navbar, Footer, or SettingsPanel
  if (isAuthPage) {
    return (
      <main className="flex-1 min-h-screen flex flex-col justify-center">
        {children}
      </main>
    )
  }

  return (
    <>
      <Navbar />
      <main className="flex-1">
        {children}
      </main>
      <Footer />
      <SettingsPanel />
    </>
  )
}
