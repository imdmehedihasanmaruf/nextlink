"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { ispApi, type Package } from "@/services/isp-api";
import { ApiError } from "@/services/api-client";

export function LivePublicPackages() {
    const [items, setItems] = useState<Package[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    async function load() {
        setLoading(true);
        setError("");
        try {
            setItems((await ispApi.packages()).items);
        } catch (cause) {
            setError(cause instanceof ApiError ? cause.message : "Could not load packages.");
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        let active = true;
        ispApi.packages().then(result => { if (active) setItems(result.items); })
            .catch(cause => { if (active) setError(cause instanceof ApiError ? cause.message : "Could not load packages."); })
            .finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, []);

    if (loading) return <p role="status">Loading current packages…</p>;
    if (error) return <div role="alert"><p>{error}</p><button className="button button-dark" onClick={() => void load()}>Retry</button></div>;
    if (items.length === 0) return <p>No active packages are currently available.</p>;

    return <div className="package-grid package-grid-four">{items.map((item, index) => <article className="package-card" key={item.id}>
        <div className="package-topline"><span>{item.name.toUpperCase()}</span><span className="package-index">{String(index + 1).padStart(2, "0")}</span></div>
        <p className="package-speed">{item.download_mbps}<span> Mbps</span></p>
        <p className="package-speed-note">{item.description ?? "Internet package"}</p>
        <div className="package-price"><strong>৳{Number(item.price_monthly).toLocaleString("en-BD")}</strong><span>/ month</span></div>
        <ul className="check-list">{(item.features ?? []).map(feature => <li key={feature}><Check size={14} />{feature}</li>)}</ul>
        <div className="package-technical"><span>BDIX speed <strong>{item.bdix_mbps ?? "—"} Mbps</strong></span><span>Installation <strong>৳{Number(item.installation_fee).toLocaleString("en-BD")}</strong></span></div>
        <Link className="button button-outline button-full" href={`/apply?package=${item.id}`}>Choose {item.name} <ArrowRight size={15} /></Link>
    </article>)}</div>;
}
