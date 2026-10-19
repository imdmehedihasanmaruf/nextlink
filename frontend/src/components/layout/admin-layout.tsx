"use client";
import { usePathname } from "next/navigation";
import { PortalShell } from "@/components/layout/portal-shell";
export function AdminLayoutShell({ children }: { children: React.ReactNode }) { const pathname = usePathname(); return pathname === "/admin/login" ? children : <PortalShell role="admin">{children}</PortalShell>; }
