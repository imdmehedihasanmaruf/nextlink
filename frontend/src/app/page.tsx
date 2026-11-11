'use client'

import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
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
  CreditCard,
  Headphones,
  Gauge,
  Radio,
  Server,
  Sparkles,
  Search,
  ExternalLink,
  ChevronRight
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { useTranslation } from '@/store/settingsStore'
import { useContentStore } from '@/store/contentStore'
import { useAuthStore } from '@/store/authStore'

export default function HomePage() {
  const router = useRouter()
  const { t } = useTranslation()
  const { isAuthenticated, hasHydrated } = useAuthStore()
  const {
    brand, 
    hero,
    mediaHubs, 
    coverageSection,
    coverageAreas, 
    ctaBanner,
    liveLatency,
    interfaceTraffic,
    boostBandwidth,
    referralRewards,
    peeringHubs,
    fetchContent 
  } = useContentStore()

  // Form states for interactive options before login
  const [billSubId, setBillSubId] = useState('')
  const [ticketIssue, setTicketIssue] = useState('')

  useEffect(() => {
    fetchContent()
  }, [fetchContent])

  // Logged-in users land on their dashboard, not on the public marketing
  // page. `hasHydrated` keeps the first render consistent on the server.
  useEffect(() => {
    if (hasHydrated && isAuthenticated) {
      router.push('/dashboard')
    }
  }, [hasHydrated, isAuthenticated, router])

  // Redirect to login page if user is not authenticated when clicking/submitting any option
  const handleProtectedAction = (e?: React.FormEvent, targetPath: string = '/login') => {
    if (e) e.preventDefault()
    if (!isAuthenticated) {
      router.push('/login')
    } else {
      router.push(targetPath)
    }
  }

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

              {/* Action Button: Check Availability */}
              <div className="flex flex-wrap gap-3.5">
                <Link href="/coverage">
                  <Button size="lg" className="bg-white text-primary hover:bg-white/90 font-extrabold gap-2 shadow-xl hover:scale-105 transition-all h-11 px-7">
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
                    <div className="h-3 w-3 rounded-full bg-primary-foreground/80"></div>
                    <div>
                      <h4 className="font-bold text-sm tracking-wide text-white">NextLink Optical Core</h4>
                      <p className="text-[10px] text-white/80">Illustrative preview of your portal</p>
                    </div>
                  </div>
                  <span className="text-[10px] font-mono font-bold text-white/90 bg-white/10 px-2.5 py-1 rounded-full border border-white/20">
                    Example
                  </span>
                </div>

                {/* Speed Gauges */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-2xl bg-black/20 p-4 border border-white/10">
                    <div className="flex items-center gap-1.5 text-xs text-emerald-300 font-semibold mb-1">
                      <Download size={14} />
                      <span>Download</span>
                    </div>
                    <p className="text-2xl font-black text-white">948.5</p>
                    <span className="text-[10px] text-white/80 font-medium">Mbps Throughput</span>
                  </div>
                  <div className="rounded-2xl bg-black/20 p-4 border border-white/10">
                    <div className="flex items-center gap-1.5 text-xs text-sky-300 font-semibold mb-1">
                      <Upload size={14} />
                      <span>Upload</span>
                    </div>
                    <p className="text-2xl font-black text-white">941.2</p>
                    <span className="text-[10px] text-white/80 font-medium">Mbps Symmetrical</span>
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
                  <Button className="w-full bg-white text-primary hover:bg-white/90 font-bold gap-2 shadow-md">
                    <span>Explore Optical Fiber Service</span>
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

      {/* ===================== 7 IMPORTANT BACKEND OPTIONS / FEATURES ===================== */}
      <section className="container mx-auto px-4 max-w-6xl space-y-8">
        <div className="text-center max-w-2xl mx-auto space-y-2">
          <Badge variant="outline" className="px-3.5 py-1 text-xs font-semibold text-primary border-primary/30">
            ISP Core Subscriber Features & Services
          </Badge>
          <h2 className="text-2xl sm:text-3xl md:text-4xl font-extrabold tracking-tight">
            Manage Everything From Your Subscriber Portal
          </h2>
          <p className="text-muted-foreground text-sm sm:text-base">
            Access our integrated optical network management tools, instant bill payments, latency diagnostics, and on-demand bandwidth controls.
          </p>
        </div>

        {/* 7 Feature Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">

          {/* 1. Quick Bill Payment & Invoices */}
          <Card className="border-2 border-border/80 hover:border-primary/60 transition-all duration-300 hover:shadow-xl flex flex-col justify-between">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="h-10 w-10 rounded-xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center">
                  <CreditCard size={20} />
                </div>
                <Badge variant="secondary" className="font-mono text-[11px] text-emerald-600 bg-emerald-500/10">
                  Instant Pay
                </Badge>
              </div>
              <CardTitle className="text-xl font-bold mt-3">Quick Bill Pay & Invoicing</CardTitle>
              <CardDescription className="text-xs">
                Pay your monthly fiber internet bills instantly using bKash, Nagad, Cards, or Bank Transfer with immediate receipt generation.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <form onSubmit={(e) => handleProtectedAction(e, '/dashboard')} className="space-y-2.5">
                <Input 
                  placeholder="Enter Subscriber ID (e.g. SUB-1024)"
                  value={billSubId}
                  onChange={(e) => setBillSubId(e.target.value)}
                  className="h-9 text-xs"
                />
                <Button 
                  type="submit" 
                  className="w-full h-9 text-xs font-bold gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm"
                >
                  <Search size={14} />
                  <span>Search Bill & Pay Now</span>
                </Button>
              </form>
            </CardContent>
          </Card>

          {/* 2. 24/7 Technical Support & Ticket Helpdesk */}
          <Card className="border-2 border-border/80 hover:border-primary/60 transition-all duration-300 hover:shadow-xl flex flex-col justify-between">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="h-10 w-10 rounded-xl bg-blue-500/10 text-blue-600 flex items-center justify-center">
                  <Headphones size={20} />
                </div>
                <Badge variant="secondary" className="font-mono text-[11px] text-blue-600 bg-blue-500/10">
                  24/7 NOC Active
                </Badge>
              </div>
              <CardTitle className="text-xl font-bold mt-3">Priority Support & Ticket CRM</CardTitle>
              <CardDescription className="text-xs">
                Facing line drop, optical loss, or Wi-Fi router issues? Submit an immediate priority trouble ticket for technician dispatch.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <form onSubmit={(e) => handleProtectedAction(e, '/tickets')} className="space-y-2.5">
                <Input 
                  placeholder="Describe your issue or line fault..."
                  value={ticketIssue}
                  onChange={(e) => setTicketIssue(e.target.value)}
                  className="h-9 text-xs"
                />
                <Button 
                  type="submit" 
                  className="w-full h-9 text-xs font-bold gap-1.5 shadow-sm"
                >
                  <span>Submit Support Ticket</span>
                  <ArrowRight size={14} />
                </Button>
              </form>
            </CardContent>
          </Card>

          {/* 3. Turbo Boost on Request — shown only when the operator enables
              it in the CMS; activation is a support action, not a button that
              changes the router. */}
          {boostBandwidth?.enabled !== false && (
          <Card className="border-2 border-border/80 hover:border-primary/60 transition-all duration-300 hover:shadow-xl flex flex-col justify-between">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="h-10 w-10 rounded-xl bg-amber-500/10 text-amber-600 flex items-center justify-center">
                  <Zap size={20} />
                </div>
                <Badge className="bg-amber-500 text-white font-mono text-[11px]">
                  {boostBandwidth?.boostSpeed || 1000} Mbps Burst
                </Badge>
              </div>
              <CardTitle className="text-xl font-bold mt-3">{boostBandwidth?.title || 'Turbo Boost on Request'}</CardTitle>
              <CardDescription className="text-xs">
                {boostBandwidth?.description || 'Ask support for a time-boxed speed burst for a big upload, live stream or download sprint. Activated by the helpdesk — not a one-click router override.'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between p-2.5 rounded-lg bg-muted/60 text-xs font-medium border">
                <span>Burst Duration</span>
                <span className="font-bold text-amber-600 dark:text-amber-400">
                  {boostBandwidth?.durationHours || 6} Hours
                </span>
              </div>
              <Button
                onClick={() => handleProtectedAction(undefined, '/dashboard')}
                className="w-full h-9 text-xs font-bold gap-1.5 bg-amber-600 hover:bg-amber-700 text-white shadow-sm"
              >
                <Zap size={14} />
                <span>Request a Turbo Boost</span>
              </Button>
            </CardContent>
          </Card>
          )}

          {/* 4. Realtime Ping & Latency Diagnostics */}
          <Card className="border-2 border-border/80 hover:border-primary/60 transition-all duration-300 hover:shadow-xl flex flex-col justify-between">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="h-10 w-10 rounded-xl bg-purple-500/10 text-purple-600 flex items-center justify-center">
                  <Radio size={20} />
                </div>
                <Badge variant="secondary" className="font-mono text-[11px] text-purple-600 bg-purple-500/10">
                  Edge POP
                </Badge>
              </div>
              <CardTitle className="text-xl font-bold mt-3">Latency & Ping Reference</CardTitle>
              <CardDescription className="text-xs">
                Reference round-trip times at the peering points, Cloudflare Anycast, and Google Cloud DNS. Values are how your line is provisioned, not measured from this page.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                {(liveLatency?.targets?.slice(0, 2) || []).length > 0 ? (
                  (liveLatency?.targets?.slice(0, 2) || []).map((t, idx) => (
                    <div key={idx} className="flex justify-between items-center text-xs p-1.5 rounded bg-muted/40">
                      <span className="truncate max-w-[170px]">{t.name}</span>
                      <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">{t.ping}</span>
                    </div>
                  ))
                ) : (
                  <div className="text-xs p-1.5 text-muted-foreground rounded bg-muted/40">
                    Peering reference times have not been configured yet.
                  </div>
                )}
              </div>
              <Button 
                onClick={() => handleProtectedAction(undefined, '/dashboard')}
                variant="outline"
                className="w-full h-9 text-xs font-bold gap-1.5 border-purple-500/30 text-purple-600 hover:bg-purple-500/10"
              >
                <Activity size={14} />
                <span>Run Full Ping Diagnostics</span>
              </Button>
            </CardContent>
          </Card>

          {/* 5. Bandwidth Consumption & Interface Traffic Meter */}
          <Card className="border-2 border-border/80 hover:border-primary/60 transition-all duration-300 hover:shadow-xl flex flex-col justify-between">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="h-10 w-10 rounded-xl bg-cyan-500/10 text-cyan-600 flex items-center justify-center">
                  <Gauge size={20} />
                </div>
                <Badge variant="secondary" className="font-mono text-[11px] text-cyan-600 bg-cyan-500/10">
                  GPON OLT
                </Badge>
              </div>
              <CardTitle className="text-xl font-bold mt-3">Bandwidth Consumption Meter</CardTitle>
              <CardDescription className="text-xs">
                Optical link provisions, uplink SFP+ port rates and monthly symmetrical traffic consumption — as configured by your operator.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-2 text-center">
                <div className="p-2 rounded bg-muted/50 border">
                  <span className="text-[10px] text-muted-foreground block">Download Rate</span>
                  <span className="text-sm font-bold text-emerald-600">
                    {interfaceTraffic?.downloadRateMbps ? `${interfaceTraffic.downloadRateMbps} Mbps` : '—'}
                  </span>
                </div>
                <div className="p-2 rounded bg-muted/50 border">
                  <span className="text-[10px] text-muted-foreground block">Upload Rate</span>
                  <span className="text-sm font-bold text-blue-600">
                    {interfaceTraffic?.uploadRateMbps ? `${interfaceTraffic.uploadRateMbps} Mbps` : '—'}
                  </span>
                </div>
              </div>
              <Button 
                onClick={() => handleProtectedAction(undefined, '/dashboard')}
                variant="outline"
                className="w-full h-9 text-xs font-bold gap-1.5 border-cyan-500/30 text-cyan-600 hover:bg-cyan-500/10"
              >
                <Gauge size={14} />
                <span>View Traffic Graphs</span>
              </Button>
            </CardContent>
          </Card>

          {/* 6. Cloud Peering & Direct Media Hubs */}
          <Card className="border-2 border-border/80 hover:border-primary/60 transition-all duration-300 hover:shadow-xl flex flex-col justify-between">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="h-10 w-10 rounded-xl bg-rose-500/10 text-rose-600 flex items-center justify-center">
                  <Server size={20} />
                </div>
                <Badge variant="secondary" className="font-mono text-[11px] text-rose-600 bg-rose-500/10">
                  Gigabit Peering
                </Badge>
              </div>
              <CardTitle className="text-xl font-bold mt-3">Cloud Peering & Media Hubs</CardTitle>
              <CardDescription className="text-xs">
                Zero-buffering BDIX & CDN access to Ultra HD streaming, local high-speed file storage, and Tier-1 diagnostic tools.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-1.5">
                {(peeringHubs || [
                  { name: 'Speedtest Diagnostic', badge: 'Tier-1' },
                  { name: 'Global Storage CDN', badge: 'Gigabit' },
                  { name: 'Ultra HD Streaming', badge: '4K HDR' },
                ]).slice(0, 3).map((h, idx) => (
                  <span key={idx} className="text-[10px] font-semibold px-2 py-0.5 rounded bg-muted border">
                    {h.name}
                  </span>
                ))}
              </div>
              <Button 
                onClick={() => handleProtectedAction(undefined, '/dashboard')}
                variant="outline"
                className="w-full h-9 text-xs font-bold gap-1.5 border-rose-500/30 text-rose-600 hover:bg-rose-500/10"
              >
                <Globe size={14} />
                <span>Access Peering Network</span>
              </Button>
            </CardContent>
          </Card>

          {/* 7. Referral Rewards — advertised only when the operator enables
              the programme. Subscribers get their personal invite link inside
              the dashboard; there is no global code. */}
          {referralRewards?.enabled !== false && (
          <Card className="border-2 border-border/80 hover:border-primary/60 transition-all duration-300 hover:shadow-xl md:col-span-2 lg:col-span-3 flex flex-col md:flex-row items-center justify-between p-6 gap-6 bg-gradient-to-r from-primary/5 via-card to-emerald-500/5">
            <div className="flex items-start gap-4">
              <div className="h-12 w-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                <Gift size={26} />
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Badge className="bg-emerald-600 text-white font-bold text-xs">
                    Earn ${referralRewards?.bonusAmount || 25} Credit
                  </Badge>
                </div>
                <h3 className="text-xl font-extrabold">{referralRewards?.title || 'Refer a friend'}</h3>
                <p className="text-xs sm:text-sm text-muted-foreground max-w-2xl">
                  {referralRewards?.description || 'Invite your friends to NextLink Optical Fiber — when your friend activates and pays their first bill, you both receive billing credit.'}
                </p>
              </div>
            </div>
            <div className="shrink-0 w-full md:w-auto">
              <Button
                onClick={() => handleProtectedAction(undefined, '/dashboard')}
                className="w-full md:w-auto font-bold h-11 px-6 gap-2 shadow-md hover:scale-105 transition-all"
              >
                <Gift size={16} />
                <span>Get My Invite Link</span>
                <ArrowRight size={15} />
              </Button>
            </div>
          </Card>
          )}

        </div>
      </section>

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
              <h2 className="text-2xl md:text-3xl font-black mb-2 tracking-tight text-white drop-shadow-sm">
                {ctaBanner.titleEn}
              </h2>
              <p className="text-white/90 text-sm leading-relaxed">
                Contact our 24/7 Global NOC or explore our optical fiber plans to get connected today.
              </p>
            </div>
            <div className="flex flex-wrap gap-3.5 relative z-10 items-center">
              <Link href="/packages">
                <Button size="lg" className="bg-white text-primary hover:bg-white/90 font-extrabold shadow-lg hover:scale-105 transition-all h-11 px-6">
                  Explore Plans
                </Button>
              </Link>

              {/* Call Support: redirects to login if unauthenticated */}
              <button
                type="button"
                onClick={() => {
                  if (!isAuthenticated) {
                    router.push('/login')
                  } else {
                    window.location.href = `tel:${brand?.phone?.replace(/\s+/g, '') || '+8801575XXXXXX'}`
                  }
                }}
                className="inline-flex items-center justify-center h-11 px-6 rounded-md font-extrabold gap-2 border-2 border-white bg-white/10 hover:bg-white hover:text-primary text-white backdrop-blur-sm transition-all shadow-md cursor-pointer"
              >
                <PhoneCall size={18} className="shrink-0" />
                <span className="tracking-wide">{ctaBanner?.btnCallEn || 'Call Support'}</span>
              </button>
            </div>
          </div>
        </section>
      )}
    </div>
  )
}
