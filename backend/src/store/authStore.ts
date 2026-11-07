'use client';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { UserRole } from '@/lib/mockData';

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
      user: {
        id: 'ADM-001',
        name: 'Global NOC Director',
        email: 'admin@nextlink.global',
        role: 'super_admin',
        phone: '+1 (800) 550-0001',
        department: 'Global Operations & Routing',
      },
      isAuthenticated: true,
      hasHydrated: false,
      login: (user) => set({ user, isAuthenticated: true }),
      updateUser: (data) =>
        set((state) => ({
          user: state.user ? { ...state.user, ...data } : null,
        })),
      logout: () => set({ user: null, isAuthenticated: false }),
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
