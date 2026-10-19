import type { ReactNode } from "react";
import { PortalShell } from "@/components/layout/portal-shell";
import { PortalAuthGuard } from "@/components/layout/portal-auth-guard";
export default function ClientLayout({ children }: { children: ReactNode }) { return <PortalAuthGuard kind="client"><PortalShell role="client">{children}</PortalShell></PortalAuthGuard>; }
