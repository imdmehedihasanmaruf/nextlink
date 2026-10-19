"use client";
import { useEffect } from "react";
import Link from "next/link";
import { ArrowLeft, RotateCcw } from "lucide-react";
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) { useEffect(() => { console.error(error); }, [error]); return <main className="not-found-page"><div className="not-found-card"><span className="eyebrow">SOMETHING GOT IN THE WAY</span><h1>Let’s get you<br /><span>back on track.</span></h1><p>We couldn’t load this page. Your demo data is safe—try again or return to the homepage.</p><div><button className="button button-dark" onClick={() => reset()}><RotateCcw size={15} /> Try again</button><Link className="text-link" href="/"><ArrowLeft size={14} /> Back to home</Link></div></div></main>; }
