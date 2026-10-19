import type { ReactNode } from "react";
import { PortalShell } from "@/components/layout/portal-shell";
import { PortalAuthGuard } from "@/components/layout/portal-auth-guard";
export default function TechnicianLayout({ children }: { children: ReactNode }) { return <PortalAuthGuard kind="admin"><PortalShell role="admin">{children}</PortalShell></PortalAuthGuard>; }
