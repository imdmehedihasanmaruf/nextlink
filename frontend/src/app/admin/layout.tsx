"use client";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { AdminLayoutShell } from "@/components/layout/admin-layout";
import { PortalAuthGuard } from "@/components/layout/portal-auth-guard";
export default function AdminLayout({ children }: { children: ReactNode }) {
    const pathname = usePathname();
    const content = <AdminLayoutShell>{children}</AdminLayoutShell>;

    // Redirect /admin/* (except the login page) through auth guard.
    // But make sure /admin/ itself behaves like /admin/login.
    if (pathname === "/admin" || pathname === "/admin/") return <>{children}</>;
    return pathname === "/admin/login" ? content : <PortalAuthGuard kind="admin">{content}</PortalAuthGuard>;
}
