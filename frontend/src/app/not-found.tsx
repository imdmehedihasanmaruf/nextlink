import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
export default function NotFound() { return <main className="not-found-page"><div className="not-found-card"><span className="eyebrow">404 · WRONG TURN</span><h1>We can’t find<br /><span>that connection.</span></h1><p>This page might have moved, or it may not be part of our demo site.</p><div><Link className="button button-dark" href="/">Back to home <ArrowLeft size={15} /></Link><Link className="text-link" href="/contact">Talk to us <ArrowRight size={14} /></Link></div></div></main>; }
