"use client";

import { useState } from "react";
import { ArrowRight, CheckCircle2, CircleHelp, MapPin, ShieldCheck } from "lucide-react";
import { ispApi } from "@/services/isp-api";
import { ApiError } from "@/services/api-client";

export function LiveCoverageCheck() {
    const [district, setDistrict] = useState("");
    const [area, setArea] = useState("");
    const [result, setResult] = useState<{ available: boolean; configured: boolean } | null>(null);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);
    async function check(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault(); setLoading(true); setError(""); setResult(null);
        try { setResult(await ispApi.checkCoverage(district, area)); }
        catch (cause) { setError(cause instanceof ApiError ? cause.message : "Could not check coverage."); }
        finally { setLoading(false); }
    }
    return <div className="coverage-form-card"><div className="form-card-heading"><span className="coverage-icon"><MapPin size={20} /></span><div><h2>Check your address</h2><p>Availability from the current coverage records.</p></div></div>
        <form onSubmit={check}><label className="field-label">District<input required maxLength={100} value={district} onChange={e => setDistrict(e.target.value)} placeholder="e.g. Dhaka" /></label>
            <label className="field-label">Area<input required maxLength={100} value={area} onChange={e => setArea(e.target.value)} placeholder="e.g. Dhanmondi" /></label>
            <button className="button button-dark button-full" type="submit" disabled={loading}>{loading ? "Checking…" : "Check coverage"} <ArrowRight size={15} /></button>
            <p className="privacy-note"><ShieldCheck size={14} /> Your location is used only to check service availability.</p>
        </form>
        {error && <div role="alert"><p>{error}</p><button className="button button-outline" onClick={() => { const form = document.querySelector<HTMLFormElement>(".coverage-form-card form"); form?.requestSubmit(); }}>Retry</button></div>}
        {result && <div className={`coverage-result result-${result.available ? "available" : "unavailable"}`} role="status"><span className="result-icon">{result.available ? <CheckCircle2 size={20} /> : <CircleHelp size={20} />}</span><div><strong>{result.available ? "Coverage is available in this area" : result.configured ? "Coverage is not currently listed for this area" : "Coverage information has not been configured"}</strong><p>{result.available ? "Our team can confirm the exact service address." : "Contact the service team to confirm availability."}</p></div></div>}
    </div>;
}
