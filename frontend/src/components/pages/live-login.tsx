"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Wifi } from "lucide-react";
import Link from "next/link";
import { ispApi } from "@/services/isp-api";
import { ApiError } from "@/services/api-client";

export function LiveLogin({ kind }: { kind: "admin" | "client" }) {
    const router = useRouter();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setBusy(true);
        setError("");
        const form = new FormData(event.currentTarget);
        try {
            const user = await ispApi.login(String(form.get("email")), String(form.get("password")));
            const subscriber = user.role === "subscriber";
            if ((kind === "client") !== subscriber) {
                await ispApi.logout();
                setError("This account is not permitted to access this portal.");
                return;
            }
            router.replace(kind === "client" ? "/client/dashboard" : "/admin/dashboard");
        } catch (cause) {
            setError(cause instanceof ApiError ? cause.message : "Sign in failed. Please try again.");
        } finally {
            setBusy(false);
        }
    }
    return <main className="auth-page"><section className="auth-brand-panel"><Link className="brand brand-auth" href="/"><span className="brand-mark">n</span><span>nex<span className="brand-light">link</span><small>FIBRE, FORWARD.</small></span></Link><div className="auth-panel-copy"><span className="eyebrow eyebrow-lime">SECURE ACCOUNT ACCESS</span><h1>{kind === "client" ? <>Your connection,<br /><span>all in one place.</span></> : <>Welcome to your<br /><span>team workspace.</span></>}</h1><p>Sign in with your account credentials. Access is verified by the service.</p></div></section><section className="auth-form-panel"><div className="auth-top-link"><Link href="/"><ArrowLeft size={14} /> Back to website</Link></div><form className="auth-form" onSubmit={submit}><span className="auth-form-icon"><Wifi size={20} /></span><span className="eyebrow">{kind === "client" ? "CUSTOMER PORTAL" : "STAFF WORKSPACE"}</span><h2>Sign in</h2><p>Enter the email and password associated with your account.</p><label className="field-label">Email address<input required name="email" type="email" autoComplete="username" /></label><label className="field-label">Password<input required name="password" type="password" autoComplete="current-password" /></label>{error && <p role="alert" className="form-error">{error}</p>}<button disabled={busy} className="button button-dark button-full">{busy ? "Signing in…" : "Sign in"} <ArrowRight size={15} /></button><Link className="text-link auth-back" href="/">Return to website <ArrowLeft size={14} /></Link></form></section></main>;
}
