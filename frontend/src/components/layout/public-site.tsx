"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { ArrowRight, Menu, X } from "lucide-react";

const links = [{ label: "Home", href: "/" }, { label: "Packages", href: "/packages" }, { label: "Coverage", href: "/coverage" }, { label: "About", href: "/about" }, { label: "News", href: "/news" }, { label: "Contact", href: "/contact" }];

export function PublicHeader() {
    const [open, setOpen] = useState(false);
    const pathname = usePathname();
    return <header className="public-header"><div className="container header-inner"><Link className="brand" href="/" onClick={() => setOpen(false)}><span className="brand-mark">n</span><span>nex<span className="brand-light">link</span><small>FIBRE, FORWARD.</small></span></Link><nav className={open ? "public-nav open" : "public-nav"} aria-label="Main navigation">{links.map((item) => <Link className={pathname === item.href ? "nav-link active" : "nav-link"} href={item.href} key={item.href} onClick={() => setOpen(false)}>{item.label}</Link>)}<Link className="mobile-login" href="/admin/login">Sign in <ArrowRight size={15} /></Link></nav><div className="header-actions"><Link className="login-link" href="/admin/login">Sign in</Link><Link className="button button-dark button-small" href="/apply">Get connected <ArrowRight size={15} /></Link></div><button className="menu-toggle" aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open} onClick={() => setOpen(!open)}>{open ? <X /> : <Menu />}</button></div></header>;
}

export function PublicFooter() {
    return <footer className="public-footer"><div className="container footer-main"><div className="footer-brand"><Link className="brand brand-footer" href="/"><span className="brand-mark">n</span><span>nex<span className="brand-light">link</span><small>FIBRE, FORWARD.</small></span></Link><p>Fast, dependable fibre internet. Made for the way you live, work and play.</p><a href="tel:+8809612345678">+880 9612-345678</a><a href="mailto:hello@nexlink.example">hello@nexlink.example</a></div><div className="footer-column"><h3>Explore</h3><Link href="/packages">Internet packages</Link><Link href="/coverage">Check coverage</Link><Link href="/about">About Nexlink</Link><Link href="/news">News & updates</Link></div><div className="footer-column"><h3>Here to help</h3><Link href="/contact">Contact us</Link><Link href="/faq">Frequently asked questions</Link><Link href="/apply">New connection</Link><Link href="/client/login">Customer portal</Link></div><div className="footer-card"><span className="eyebrow">READY WHEN YOU ARE</span><h3>Your better internet starts here.</h3><Link className="button button-lime" href="/coverage">Check your area <ArrowRight size={15} /></Link></div></div><div className="container footer-bottom"><span>© 2026 Nexlink Internet. Demo website with sample information.</span><span><Link href="/faq">FAQs</Link><Link href="/admin/login">Staff portal</Link></span></div></footer>;
}

export function PublicShell({ children }: { children: React.ReactNode }) { return <><PublicHeader /><main>{children}</main><PublicFooter /></>; }
