'use client';

import { useState, useEffect, useCallback } from 'react';
import { Shield, Globe, Lock, Terminal, Clock } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { apiFetch } from '@/lib/apiClient';

interface SessionMeta {
  version: string;
  ip: string;
  region: string;
  lastLogin: string | null;
  adminMode: 'Enabled' | 'Disabled';
  encryption: string;
  copyrightYears: string;
}

export function Footer() {
  const { user, isAuthenticated } = useAuthStore();
  const currentYear = new Date().getUTCFullYear();
  const nextYear = currentYear + 1;

  const [meta, setMeta] = useState<SessionMeta>({
    version: 'To be implemented',
    ip: 'Detecting...',
    region: 'Unknown',
    lastLogin: null,
    adminMode: isAuthenticated ? 'Enabled' : 'Disabled',
    encryption: 'Detecting...',
    copyrightYears: `${currentYear}–${nextYear}`,
  });

  const loadSessionMeta = useCallback(async () => {
    try {
      const qs = new URLSearchParams({ context: 'admin' });
      if (user?.email) qs.set('email', user.email);
      if (user?.id) qs.set('userId', user.id);

      const res = await apiFetch(`/api/auth/session-meta?${qs.toString()}`, {
        method: 'GET',
        auth: Boolean(isAuthenticated),
      });

      if (res?.success) {
        setMeta({
          version: res.version || 'To be implemented',
          ip: res.ip || '127.0.0.1',
          region: res.region || 'Unknown',
          lastLogin: res.lastLogin || null,
          adminMode: isAuthenticated ? 'Enabled' : 'Disabled',
          encryption: res.encryption || 'HTTP/1.1 (Unencrypted Loopback)',
          copyrightYears: res.copyrightYears || `${currentYear}–${nextYear}`,
        });
      }
    } catch {
      setMeta((prev) => ({
        ...prev,
        adminMode: isAuthenticated ? 'Enabled' : 'Disabled',
        copyrightYears: `${currentYear}–${nextYear}`,
      }));
    }
  }, [user?.email, user?.id, isAuthenticated, currentYear, nextYear]);

  useEffect(() => {
    loadSessionMeta();
    const interval = setInterval(loadSessionMeta, 15000);
    return () => clearInterval(interval);
  }, [loadSessionMeta]);

  return (
    <footer className="mt-auto w-full border-t bg-card/95 backdrop-blur text-xs text-muted-foreground shrink-0">
      <div className="mx-auto max-w-7xl px-4 py-3 md:px-6">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 md:items-start">
          {/* Left Top */}
          <div className="flex flex-col gap-1 text-left">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <span className="inline-flex items-center gap-1.5">
                <Terminal className="h-3.5 w-3.5 text-primary shrink-0" />
                <strong className="text-foreground font-semibold">Version:</strong>{' '}
                <span data-testid="footer-version" className="font-mono">
                  {meta.version}
                </span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Globe className="h-3.5 w-3.5 text-primary shrink-0" />
                <strong className="text-foreground font-semibold">IP:</strong>{' '}
                <span data-testid="footer-ip" className="font-mono">
                  {meta.ip}
                </span>
              </span>
            </div>
            <div className="inline-flex items-center gap-1.5">
              <strong className="text-foreground font-semibold">Region:</strong>{' '}
              <span data-testid="footer-region">{meta.region}</span>
            </div>
          </div>

          {/* Right Top */}
          <div className="flex flex-col gap-1 md:items-end md:text-right">
            <div className="inline-flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 text-primary shrink-0" />
              <strong className="text-foreground font-semibold">Last Login:</strong>{' '}
              <span data-testid="footer-last-login" className="font-mono">
                {isAuthenticated && meta.lastLogin ? meta.lastLogin : 'No previous login recorded'}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 md:justify-end">
              <span className="inline-flex items-center gap-1.5">
                <Shield className="h-3.5 w-3.5 text-primary shrink-0" />
                <strong className="text-foreground font-semibold">Admin Mode:</strong>{' '}
                <span
                  data-testid="footer-admin-mode"
                  className={
                    isAuthenticated
                      ? 'font-semibold text-emerald-600 dark:text-emerald-400'
                      : 'font-semibold text-amber-600 dark:text-amber-400'
                  }
                >
                  {isAuthenticated ? 'Enabled' : 'Disabled'}
                </span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Lock className="h-3.5 w-3.5 text-primary shrink-0" />
                <strong className="text-foreground font-semibold">Encryption:</strong>{' '}
                <span data-testid="footer-encryption" className="font-mono">
                  {meta.encryption}
                </span>
              </span>
            </div>
          </div>
        </div>

        {/* Center Bottom */}
        <div className="mt-2.5 border-t border-border/60 pt-2 text-center text-[11px] font-medium text-muted-foreground">
          © {currentYear}–{nextYear} | NextLink | All Rights Reserved.
        </div>
      </div>
    </footer>
  );
}

