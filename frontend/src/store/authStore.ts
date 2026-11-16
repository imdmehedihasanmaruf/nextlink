'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { clearSubscriberToken } from '@/lib/portalApi'

export interface SubscriberUser {
  id: string
  firstName?: string
  lastName?: string
  name: string
  username: string
  email?: string
  phone: string
  package: string
  packageName?: string
  packageId?: string
  address: string
  joinDate: string
  subscriptionStartedAt?: string | null
  subscriptionCancelledAt?: string | null
  status?: string
  balance?: number
  dueDate?: string
  ipAddress?: string
  macAddress?: string
  connectionType?: string
  zone?: string
  theme?: string
}

interface AuthState {
  user: SubscriberUser | null
  isAuthenticated: boolean
  hasHydrated: boolean
  login: (userData: SubscriberUser) => void
  updateUser: (data: Partial<SubscriberUser>) => void
  logout: () => void
  setHasHydrated: (state: boolean) => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      isAuthenticated: false,
      hasHydrated: false,
      login: (userData) => {
        if (userData?.theme && typeof window !== 'undefined') {
          try {
            localStorage.setItem('nl_user_theme', userData.theme)
            localStorage.setItem('nl_theme', userData.theme)
            if (userData.theme === 'dark') {
              document.documentElement.classList.add('dark')
            } else if (userData.theme === 'light') {
              document.documentElement.classList.remove('dark')
            } else if (userData.theme === 'system') {
              const isDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
              if (isDark) document.documentElement.classList.add('dark')
              else document.documentElement.classList.remove('dark')
            }
          } catch (e) {}
        }
        set({ user: userData, isAuthenticated: true })
      },
      updateUser: (data) =>
        set((state) => ({
          user: state.user ? { ...state.user, ...data } : null,
        })),
      // The billing service token is cleared as well. Without that, signing
      // in as another subscriber could still send the previous subscriber's
      // token and show their invoices.
      logout: () => {
        clearSubscriberToken()
        if (typeof window !== 'undefined') {
          try {
            localStorage.removeItem('nl_user_theme')
          } catch (e) {}
        }
        set({ user: null, isAuthenticated: false })
      },
      setHasHydrated: (state) => set({ hasHydrated: state }),
    }),
    {
      name: 'nextlink-subscriber-auth',
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true)
        if (state?.user?.theme && typeof window !== 'undefined') {
          try {
            localStorage.setItem('nl_user_theme', state.user.theme)
          } catch (e) {}
        }
      },
    }
  )
)
