'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Sidebar } from '@/components/Sidebar';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { NotificationSidebar } from '@/components/NotificationSidebar';
import { SettingsPanel } from '@/components/SettingsPanel';
import { useAuthStore } from '@/store/authStore';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [notifSidebarOpen, setNotifSidebarOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const { isAuthenticated, hasHydrated } = useAuthStore();
  const router = useRouter();

  useEffect(() => {
    if (hasHydrated && !isAuthenticated) {
      router.push('/login');
    }
  }, [isAuthenticated, hasHydrated, router]);

  if (!hasHydrated) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar
        mobileOpen={mobileOpen}
        onMobileClose={() => setMobileOpen(false)}
        onOpenNotifications={() => setNotifSidebarOpen(true)}
        unreadCount={unreadCount}
      />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header
          onMobileMenuOpen={() => setMobileOpen(true)}
          onOpenNotifications={() => setNotifSidebarOpen(true)}
          unreadCount={unreadCount}
        />
        <div className="flex flex-1 flex-col overflow-y-auto">
          <main className="flex-1 p-4 md:p-6">{children}</main>
          <Footer />
        </div>
      </div>
      <NotificationSidebar
        open={notifSidebarOpen}
        onClose={() => setNotifSidebarOpen(false)}
        onUnreadCountChange={setUnreadCount}
      />
      <SettingsPanel />
    </div>
  );
}
