'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { clearSubscriberToken } from '@/lib/portalApi'

export interface SubscriberUser {
  id: string
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
      login: (userData) => set({ user: userData, isAuthenticated: true }),
      updateUser: (data) =>
        set((state) => ({
          user: state.user ? { ...state.user, ...data } : null,
        })),
      // The billing service token is cleared as well. Without that, signing
      // in as another subscriber could still send the previous subscriber's
      // token and show their invoices.
      logout: () => {
        clearSubscriberToken()
        set({ user: null, isAuthenticated: false })
      },
      setHasHydrated: (state) => set({ hasHydrated: state }),
    }),
    {
      name: 'nextlink-subscriber-auth',
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true)
      },
    }
  )
)
