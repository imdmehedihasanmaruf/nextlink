'use client'

import React, { useEffect } from 'react'
import Link from 'next/link'
import { 
  Zap, 
  ShieldCheck, 
  Wifi, 
  ArrowRight, 
  Download, 
  Upload, 
  CheckCircle, 
  Globe, 
  Tv, 
  HardDrive, 
  Activity, 
  Gift, 
  Star, 
  MapPin, 
  PhoneCall,
  Clock,
  Sparkles
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useTranslation } from '@/store/settingsStore'
import { useContentStore } from '@/store/contentStore'

export default function HomePage() {
  const { t } = useTranslation()
  const { 
    brand, 
    hero,
    packagesSection,
    packages, 
    mediaHubs, 
    coverageSection,
    coverageAreas, 
    retention,
    ctaBanner,
    fetchContent 
  } = useContentStore()

  useEffect(() => {
    fetchContent()
  }, [fetchContent])

  const stats = [
    { value: '100%', label: 'Pure Optical Fiber' },
    { value: '< 4 ms', label: 'Global Cloud Latency' },
    { value: '99.99%', label: 'Network Uptime SLA' },
    { value: '24/7/365', label: 'Dedicated Global NOC' },
  ]

  return (
    <div className="space-y-16 pb-16">
      {/* ===================== HERO SECTION ===================== */}
      <section className="hero-gradient text-white py-16 md:py-20 px-4 relative overflow-hidden shadow-lg">
        <div className="absolute inset-0 bg-black/15" />
        <div className="container mx-auto relative z-10 max-w-6xl">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
            {/* Left Column: Headlines & CTA */}
            <div className="lg:col-span-7">
              {/* Dynamic Badge */}
              <div className="inline-flex items-center gap-2 bg-white/20 backdrop-blur-md rounded-full px-4 py-1.5 text-xs sm:text-sm font-semibold mb-6 border border-white/20 shadow-sm">
                <Zap size={15} className="text-yellow-300 animate-pulse" />
                <span>{hero?.badgeEn || '🚀 Ultra Low-Latency Tier-1 Global Backbone'}</span>
              </div>

              {/* Dynamic Headline */}
              <h1 className="text-3xl sm:text-4xl md:text-5xl font-black leading-tight mb-4 tracking-tight text-white drop-shadow-sm">
                {t('heroTitle')}
              </h1>

              {/* Dynamic Subtitle */}
              <p className="text-base sm:text-lg text-white/90 mb-8 leading-relaxed font-normal max-w-xl">
                {t('heroSubtitle')}
              </p>

              {/* Action Buttons */}
              <div className="flex flex-wrap gap-3.5">
                <Link href="/apply">
                  <Button size="lg" className="bg-white text-slate-900 hover:bg-slate-100 font-extrabold gap-2 shadow-xl hover:scale-105 transition-all h-11 px-6">
                    <span>{t('getStarted')}</span>
                    <ArrowRight size={18} />
                  </Button>
                </Link>
                <Link href="/coverage">
                  <Button size="lg" variant="outline" className="border-white/80 text-white bg-white/10 backdrop-blur-md hover:bg-white/20 font-bold gap-2 h-11 px-6">
                    <span>{t('checkCoverage')}</span>
                    <MapPin size={18} />
                  </Button>
                </Link>
              </div>

              {/* Quick Live Stats */}
              {hero?.stats && hero.stats.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-10 pt-6 border-t border-white/20">
                  {hero.stats.map((s, idx) => (
                    <div key={idx}>
                      <p className="text-2xl sm:text-3xl font-extrabold text-white">{s.value}</p>
                      <p className="text-[11px] sm:text-xs text-white/80 font-medium mt-0.5">{s.labelEn}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Right Column: Live Fiber Connection Monitor Card */}
            <div className="lg:col-span-5 hidden lg:block">
              <div className="rounded-3xl bg-white/10 backdrop-blur-xl border border-white/20 p-6 text-white shadow-2xl space-y-5">
                <div className="flex items-center justify-between pb-4 border-b border-white/15">
                  <div className="flex items-center gap-2.5">
                    <span className="relative flex h-3 w-3">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
                    </span>
                    <div>
                      <h4 className="font-bold text-sm tracking-wide">NextLink Optical Core</h4>
                      <p className="text-[10px] text-white/70">Connected to 10G Tier-1 Gateway</p>
                    </div>
                  </div>
                  <span className="text-[10px] font-mono font-bold bg-white/20 px-2.5 py-1 rounded-full border border-white/20">
                    SLA 99.99%
                  </span>
                </div>

                {/* Speed Gauges */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-2xl bg-black/20 p-4 border border-white/10">
                    <div className="flex items-center gap-1.5 text-xs text-emerald-300 font-semibold mb-1">
                      <Download size={14} />
                      <span>Download</span>
                    </div>
                    <p className="text-2xl font-black">948.5</p>
                    <span className="text-[10px] text-white/70 font-medium">Mbps Throughput</span>
                  </div>
                  <div className="rounded-2xl bg-black/20 p-4 border border-white/10">
                    <div className="flex items-center gap-1.5 text-xs text-sky-300 font-semibold mb-1">
                      <Upload size={14} />
                      <span>Upload</span>
                    </div>
                    <p className="text-2xl font-black">941.2</p>
                    <span className="text-[10px] text-white/70 font-medium">Mbps Symmetrical</span>
                  </div>
                </div>

                {/* Network Metrics */}
                <div className="space-y-2 pt-1 text-xs">
                  <div className="flex justify-between items-center text-white/80">
                    <span>Direct Tier-1 Latency</span>
                    <span className="font-mono font-bold text-emerald-300">&lt; 1.8 ms</span>
                  </div>
                  <div className="flex justify-between items-center text-white/80">
                    <span>Packet Jitter</span>
                    <span className="font-mono font-bold text-white">0.32 ms</span>
                  </div>
                  <div className="flex justify-between items-center text-white/80">
                    <span>BDIX & CDN Peering</span>
                    <span className="font-mono font-bold text-emerald-300">Bufferless</span>
                  </div>
                </div>

                {/* Quick Link Button */}
                <Link href="/apply" className="block w-full">
                  <Button className="w-full bg-white text-slate-900 hover:bg-slate-100 font-bold gap-2 shadow-md">
                    <span>Connect Optical Fiber</span>
                    <ArrowRight size={14} />
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </div>

        {/* Ambient glow shapes */}
        <div className="absolute -right-20 -top-20 h-96 w-96 rounded-full bg-white/10 blur-3xl" />
        <div className="absolute right-40 bottom-5 h-64 w-64 rounded-full bg-white/10 blur-2xl" />
      </section>

      {/* ===================== PACKAGES SECTION ===================== */}
      {packages && packages.length > 0 && (
        <section id="packages" className="container mx-auto px-4 max-w-6xl scroll-mt-20">
          <div className="text-center max-w-2xl mx-auto mb-12">
            <Badge variant="outline" className="mb-3 px-3 py-1 font-semibold text-primary border-primary/30">
              {packagesSection?.badgeEn || 'International Gigabit Plans'}
            </Badge>
            <h2 className="text-3xl md:text-4xl font-extrabold tracking-tight">
              {packagesSection?.titleEn || t('ourPackages')}
            </h2>
            <p className="text-muted-foreground mt-2 text-sm md:text-base">
              {packagesSection?.subtitleEn || t('packagesSubtitle')}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {packages.map((pkg) => (
              <Card 
                key={pkg.id} 
                className={`relative flex flex-col justify-between border-2 transition-all duration-300 hover:shadow-2xl hover:-translate-y-1.5 ${
                  pkg.popular 
                    ? 'border-primary ring-2 ring-primary/20 shadow-xl bg-primary/[0.02]' 
                    : 'border-border hover:border-primary/50'
                }`}
              >
                {pkg.popular && (
                  <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
                    <Badge className="bg-primary text-primary-foreground font-bold px-3 py-1 shadow-md">
                      {packagesSection?.popularBadgeEn || t('popular')}
                    </Badge>
                  </div>
                )}

                <CardHeader className="pb-4">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-semibold text-muted-foreground">{pkg.id}</span>
                    <Badge variant="secondary" className="font-semibold text-xs">
                      Cloud Peering {pkg.bdixSpeed || pkg.speed * 2}M
                    </Badge>
                  </div>
                  <CardTitle className="text-2xl mt-2 font-bold">{pkg.name}</CardTitle>
                  <div className="mt-4 flex items-baseline">
                    <span className="text-4xl font-black text-primary">$ {pkg.price}</span>
                    <span className="text-xs text-muted-foreground ml-1.5 font-medium">{t('perMonth')}</span>
                  </div>
                </CardHeader>

                <CardContent className="space-y-4">
                  {/* Speed indicator */}
                  <div className="rounded-xl bg-muted/50 p-3 flex items-center justify-between text-sm border border-border/50">
                    <div className="flex items-center gap-2">
                      <Download className="h-4 w-4 text-emerald-500" />
                      <span className="font-semibold">{pkg.speed} {t('mbps')}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Upload className="h-4 w-4 text-blue-500" />
                      <span className="font-semibold">{pkg.uploadSpeed || pkg.speed} {t('mbps')}</span>
                    </div>
                  </div>

                  {/* Features list */}
                  <ul className="space-y-2.5 text-sm py-2">
                    {pkg.features?.map((feat, i) => (
                      <li key={i} className="flex items-center gap-2.5 text-foreground/90">
                        <CheckCircle className="h-4 w-4 text-emerald-500 flex-shrink-0" />
                        <span className="text-xs sm:text-sm">{feat}</span>
                      </li>
                    ))}
                  </ul>

                  <div className="pt-2">
                    <Link href={`/apply?package=${pkg.id}`} className="w-full">
                      <Button 
                        className="w-full font-bold shadow-sm" 
                        variant={pkg.popular ? 'default' : 'outline'}
                      >
                        {packagesSection?.chooseBtnEn || t('selectPlan')}
                      </Button>
                    </Link>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}

      {/* ===================== USER RETENTION / INCENTIVES ===================== */}
      {retention && (retention.referralTitleEn || retention.turboTitleEn || retention.vipTitleEn) && (
        <section className="container mx-auto px-4 max-w-6xl">
          <div className="rounded-3xl border border-primary/20 bg-gradient-to-br from-primary/5 via-card to-primary/10 p-6 sm:p-8 shadow-sm">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {retention.referralTitleEn && (
                <div className="p-5 rounded-2xl bg-card/80 border border-border/60 hover:-translate-y-1 transition-transform duration-200 shadow-sm space-y-2.5">
                  <div className="inline-flex items-center gap-2 rounded-lg bg-emerald-500/10 text-emerald-600 px-3 py-1 text-xs font-bold">
                    <Gift className="h-4 w-4" />
                    {t('referAndEarn')}
                  </div>
                  <h3 className="text-lg font-bold">
                    {retention.referralTitleEn}
                  </h3>
                  <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
                    {retention.referralDescEn}
                  </p>
                </div>
              )}

              {retention.turboTitleEn && (
                <div className="p-5 rounded-2xl bg-card/80 border border-border/60 hover:-translate-y-1 transition-transform duration-200 shadow-sm space-y-2.5">
                  <div className="inline-flex items-center gap-2 rounded-lg bg-amber-500/10 text-amber-600 px-3 py-1 text-xs font-bold">
                    <Zap className="h-4 w-4" />
                    {t('instantBoost')}
                  </div>
                  <h3 className="text-lg font-bold">
                    {retention.turboTitleEn}
                  </h3>
                  <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
                    {retention.turboDescEn}
                  </p>
                </div>
              )}

              {retention.vipTitleEn && (
                <div className="p-5 rounded-2xl bg-card/80 border border-border/60 hover:-translate-y-1 transition-transform duration-200 shadow-sm space-y-2.5">
                  <div className="inline-flex items-center gap-2 rounded-lg bg-purple-500/10 text-purple-600 px-3 py-1 text-xs font-bold">
                    <Star className="h-4 w-4" />
                    VIP Loyalty Status
                  </div>
                  <h3 className="text-lg font-bold">
                    {retention.vipTitleEn}
                  </h3>
                  <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
                    {retention.vipDescEn}
                  </p>
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* ===================== ENTERTAINMENT & CDN PEERING ===================== */}
      {mediaHubs && (mediaHubs.ftpUrl || mediaHubs.liveTvUrl || mediaHubs.speedtestUrl) && (
        <section className="container mx-auto px-4 max-w-6xl">
          <div className="text-center max-w-2xl mx-auto mb-10">
            <Badge variant="outline" className="mb-2 px-3 py-1 font-semibold text-primary border-primary/30">
              Cloud Entertainment Hubs
            </Badge>
            <h2 className="text-3xl font-extrabold tracking-tight">
              {mediaHubs?.titleEn || 'Free High-Speed CDN & Peering Services'}
            </h2>
            <p className="text-muted-foreground mt-2 text-sm md:text-base">
              {mediaHubs?.subtitleEn || 'Direct local and global peering connections with zero buffering and multi-gigabit throughput.'}
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {mediaHubs.ftpUrl && (
              <a
                href={mediaHubs.ftpUrl}
                target="_blank"
                rel="noreferrer"
                className="group rounded-2xl border p-6 hover:border-primary transition-all duration-300 hover:shadow-xl hover:-translate-y-1 bg-card flex flex-col justify-between"
              >
                <div>
                  <div className="h-12 w-12 rounded-xl bg-blue-500/10 text-blue-500 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                    <HardDrive size={24} />
                  </div>
                  <h3 className="text-xl font-bold mb-1">Global Storage CDN</h3>
                  <p className="text-xs text-muted-foreground mb-4">Direct ultra-fast cache nodes for high-speed file transfers.</p>
                </div>
                <span className="text-xs font-bold text-primary flex items-center gap-1 group-hover:underline mt-2">
                  Access Storage Hub <ArrowRight size={13} />
                </span>
              </a>
            )}

            {mediaHubs.liveTvUrl && (
              <a
                href={mediaHubs.liveTvUrl}
                target="_blank"
                rel="noreferrer"
                className="group rounded-2xl border p-6 hover:border-primary transition-all duration-300 hover:shadow-xl hover:-translate-y-1 bg-card flex flex-col justify-between"
              >
                <div>
                  <div className="h-12 w-12 rounded-xl bg-purple-500/10 text-purple-500 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                    <Tv size={24} />
                  </div>
                  <h3 className="text-xl font-bold mb-1">Ultra HD Stream Portal</h3>
                  <p className="text-xs text-muted-foreground mb-4">4K live broadcast channels peered directly with low delay.</p>
                </div>
                <span className="text-xs font-bold text-primary flex items-center gap-1 group-hover:underline mt-2">
                  Watch Streaming <ArrowRight size={13} />
                </span>
              </a>
            )}

            {mediaHubs.speedtestUrl && (
              <a
                href={mediaHubs.speedtestUrl}
                target="_blank"
                rel="noreferrer"
                className="group rounded-2xl border p-6 hover:border-primary transition-all duration-300 hover:shadow-xl hover:-translate-y-1 bg-card sm:col-span-2 lg:col-span-1 flex flex-col justify-between"
              >
                <div>
                  <div className="h-12 w-12 rounded-xl bg-emerald-500/10 text-emerald-500 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                    <Activity size={24} />
                  </div>
                  <h3 className="text-xl font-bold mb-1">Speed & Latency Test</h3>
                  <p className="text-xs text-muted-foreground mb-4">Verify your throughput directly against our nearest Tier-1 POP.</p>
                </div>
                <span className="text-xs font-bold text-primary flex items-center gap-1 group-hover:underline mt-2">
                  Run Speed Diagnostic <ArrowRight size={13} />
                </span>
              </a>
            )}
          </div>
        </section>
      )}

      {/* ===================== WORLDWIDE COVERAGE SUMMARY ===================== */}
      {coverageAreas && coverageAreas.length > 0 && (
        <section className="container mx-auto px-4 max-w-6xl">
          <div className="rounded-3xl border bg-muted/20 p-6 sm:p-8">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
              <div>
                <Badge variant="secondary" className="mb-2 font-semibold">Global Network Availability</Badge>
                <h2 className="text-2xl md:text-3xl font-extrabold tracking-tight">
                  {coverageSection?.titleEn || 'Worldwide Active Metro Coverage Zones'}
                </h2>
                <p className="text-muted-foreground text-sm mt-1 max-w-xl">
                  {coverageSection?.subtitleEn || 'Connected across major metropolitan hubs expanding globally.'}
                </p>
              </div>
              <Link href="/coverage">
                <Button size="lg" className="font-bold gap-2 flex-shrink-0 shadow-md">
                  <span>{t('checkCoverage')}</span>
                  <ArrowRight size={16} />
                </Button>
              </Link>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3.5 mt-6 pt-6 border-t border-border">
              {coverageAreas.map((area, idx) => (
                <div key={idx} className="p-3.5 rounded-xl bg-card border text-xs hover:border-primary/40 transition-colors">
                  <p className="font-bold text-foreground truncate">{area.zone}</p>
                  <p className="text-muted-foreground text-[11px] mt-0.5 truncate">{area.district}</p>
                  <span className="inline-flex items-center mt-2.5 font-mono text-[10px] text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded font-bold">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 mr-1.5 animate-pulse" />
                    {area.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ===================== BOTTOM CTA BANNER ===================== */}
      {ctaBanner && ctaBanner.titleEn && (
        <section className="container mx-auto px-4 max-w-6xl">
          <div className="rounded-3xl bg-gradient-to-r from-primary via-primary/95 to-primary/80 text-primary-foreground p-8 md:p-12 shadow-2xl flex flex-col md:flex-row md:items-center justify-between gap-6 relative overflow-hidden">
            <div className="absolute right-0 top-0 h-64 w-64 bg-white/10 rounded-full blur-2xl pointer-events-none" />
            <div className="max-w-xl relative z-10">
              <h2 className="text-2xl md:text-3xl font-black mb-2 tracking-tight">
                {ctaBanner.titleEn}
              </h2>
              <p className="text-primary-foreground/90 text-sm leading-relaxed">
                Contact our 24/7 Global NOC or submit an online provisioning order to get connected today.
              </p>
            </div>
            <div className="flex flex-wrap gap-3.5 relative z-10">
              <Link href="/apply">
                <Button size="lg" className="bg-white text-slate-900 hover:bg-slate-100 font-extrabold shadow-lg hover:scale-105 transition-all">
                  {ctaBanner.btnApplyEn || t('apply')}
                </Button>
              </Link>
              {brand?.phone && (
                <a href={`tel:${brand.phone}`}>
                  <Button size="lg" variant="outline" className="border-white/80 text-white hover:bg-white/20 font-bold gap-2">
                    <PhoneCall size={16} />
                    <span>{ctaBanner.btnCallEn || brand.phone}</span>
                  </Button>
                </a>
              )}
            </div>
          </div>
        </section>
      )}
    </div>
  )
}
