'use client';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { UserRole } from '@/lib/mockData';
import { clearApiToken } from '@/lib/apiClient';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: UserRole | string;
  phone?: string;
  department?: string;
}

interface AuthState {
  user: AuthUser | null;
  isAuthenticated: boolean;
  hasHydrated: boolean;
  login: (user: AuthUser) => void;
  updateUser: (data: Partial<AuthUser>) => void;
  logout: () => void;
  setHasHydrated: (state: boolean) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      // The console starts signed out. A visitor must authenticate before any
      // admin page is reachable — the initial state used to be an
      // authenticated super admin, which left the whole panel open.
      user: null,
      isAuthenticated: false,
      hasHydrated: false,
      login: (user) => set({ user, isAuthenticated: true }),
      updateUser: (data) =>
        set((state) => ({
          user: state.user ? { ...state.user, ...data } : null,
        })),
      // The API session is closed as well. Leaving it behind would let the
      // next sign-in reuse the previous staff token.
      logout: () => {
        clearApiToken();
        set({ user: null, isAuthenticated: false });
      },
      setHasHydrated: (state) => set({ hasHydrated: state }),
    }),
    {
      name: 'nextlink-auth',
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    }
  )
);
