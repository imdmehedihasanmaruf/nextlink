"use client";

import { ReactNode, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ispApi } from "@/services/isp-api";
import { ApiError } from "@/services/api-client";

export function PortalAuthGuard({ children, kind }: { children: ReactNode; kind: "admin" | "client" }) {
    const router = useRouter();
    const pathname = usePathname();
    const [allowed, setAllowed] = useState(false);

    useEffect(() => {
        let active = true;
        const token = window.sessionStorage.getItem("isp-access-token");
        if (!token) {
            router.replace(kind === "client" ? "/client/login" : "/admin/login");
            return;
        }
        ispApi.me().then((user) => {
            if (!active) return;
            if ((kind === "client") !== (user.role === "subscriber")) {
                router.replace(user.role === "subscriber" ? "/client/login" : "/admin/login");
                return;
            }
            if (kind === "admin" && user.role === "field_technician" && !pathname.startsWith("/technician")) {
                router.replace("/technician");
                return;
            }
            if (kind === "admin" && user.role !== "field_technician" && pathname.startsWith("/technician")) {
                router.replace("/admin/dashboard");
                return;
            }
            setAllowed(true);
        }).catch((error: unknown) => {
            if (!active) return;
            if (error instanceof ApiError && error.status === 401) window.sessionStorage.removeItem("isp-access-token");
            router.replace(kind === "client" ? "/client/login" : "/admin/login");
        });
        return () => { active = false; };
    }, [kind, pathname, router]);

    if (!allowed) return <main className="portal-loading" role="status">Checking your account…</main>;
    return children;
}
