'use client'

import { create } from 'zustand'

export type PackageCategory = 'Home Internet' | 'Advanced Internet' | 'Business Internet'

export interface PackageItem {
  id: string
  name: string
  speed: number
  uploadSpeed: number
  price: number
  bdixSpeed?: number
  popular: boolean
  features: string[]
  category?: PackageCategory
  targetCustomer?: string
  badge?: string
  speedLabel?: string
  description?: string
  unlimitedData?: boolean
  symmetricalSpeed?: boolean
  fiberConnection?: boolean
  ipv6Support?: boolean
  gamingOptimized?: boolean
  streaming4k8k?: boolean
  staticIp?: string
  prioritySupport?: boolean
  dedicatedBandwidth?: string
  businessSla?: string
  support24_7?: boolean
  lowLatencyRouting?: boolean
  directCloudPeering?: boolean
  hardwareReady?: string
  ddosProtection?: string
  bgpFailover?: string
  cirGuarantee?: string
}

export interface ContentState {
  brand: {
    name: string
    tagline: string
    logoSubtitle?: string
    logoUrl?: string
    phone: string
    email: string
    address: string
    officeHours?: string
    facebook?: string
    youtube?: string
  }
  nav?: {
    homeEn: string
    coverageEn: string
    applyEn: string
    supportEn: string
    loginBtnEn: string
    applyBtnEn: string
  }
  notice: {
    active: boolean
    textEn: string
  }
  hero: {
    badgeEn: string
    titleEn: string
    subtitleEn: string
    primaryBtnTextEn: string
    secondaryBtnTextEn: string
    stats?: Array<{
      value: string
      labelEn: string
    }>
  }
  packagesSection?: {
    badgeEn: string
    titleEn: string
    subtitleEn: string
    chooseBtnEn: string
    popularBadgeEn: string
  }
  packages: PackageItem[]
  mediaHubs: {
    badgeEn?: string
    titleEn?: string
    subtitleEn?: string
    ftpUrl: string
    liveTvUrl: string
    speedtestUrl: string
    movieHubUrl?: string
  }
  coverageSection?: {
    titleEn: string
    subtitleEn: string
    btnTextEn?: string
  }
  coverageAreas: Array<{
    zone: string
    district: string
    areas?: string
    status: string
  }>
  retention?: {
    referralBonusUSD?: number
    referralDiscountPercent?: number
    turboBoostSpeed?: number
    turboBoostDurationHours?: number
    referralTitleEn?: string
    referralDescEn?: string
    turboTitleEn?: string
    turboDescEn?: string
    vipTitleEn?: string
    vipDescEn?: string
  }
  referralRewards?: {
    enabled?: boolean
    bonusAmount?: number
    discountPercent?: number
    defaultCode?: string
    title?: string
    description?: string
    friendsJoinedCount?: number
    totalSavedAmount?: number
    tierName?: string
    referrals?: Array<{
      id: string
      name: string
      email?: string
      date: string
      reward: number
      status: string
    }>
  }
  boostBandwidth?: {
    enabled?: boolean
    boostSpeed?: number
    durationHours?: number
    title?: string
    description?: string
    status?: string
    burstQuotaPerMonth?: number
    history?: Array<{
      id: string
      subscriber?: string
      speed?: number
      duration?: number
      date?: string
      status?: string
    }>
  }
  liveLatency?: {
    enabled?: boolean
    title?: string
    description?: string
    targets?: Array<{
      id: string
      name: string
      host: string
      ping: string
      status: string
    }>
  }
  interfaceTraffic?: {
    allocatedSpeed?: number
    consumedDataGB?: string | number
    totalQuota?: string
    downloadRateMbps?: number
    uploadRateMbps?: number
    gatewayIPv4?: string
    gatewayIPv6?: string
    oltPort?: string
    terminalStatus?: string
    interfaces?: Array<{
      id: string
      name: string
      type: string
      rx: string
      tx: string
      status: string
    }>
  }
  peeringHubs?: Array<{
    id: string
    name: string
    url: string
    badge: string
    category?: string
    status?: string
  }>
  ctaBanner?: {
    titleEn: string
    btnCallEn?: string
    btnApplyEn?: string
  }
  footer?: {
    copyrightEn: string
  }
  isLoading: boolean
  lastFetched: number | null
  fetchContent: () => Promise<void>
}

const defaultPackages: PackageItem[] = [
  {
    id: 'PKG-001',
    name: 'Essential',
    speed: 100,
    uploadSpeed: 100,
    price: 0,
    bdixSpeed: 1000,
    popular: false,
    badge: 'Starter Symmetrical',
    speedLabel: '100 Mbps',
    category: 'Home Internet',
    targetCustomer: 'Individual / Small Household',
    description: 'Reliable 100 Mbps symmetrical optical fiber for everyday browsing, HD video calls, and essential smart devices.',
    features: [
      '100 Mbps Symmetrical Download & Upload',
      '100% Unlimited Fiber Data',
      'Direct Optical Fiber GPON Connection',
      'Gigabit ONU Equipment Included',
      'Basic DDoS Mitigation Shield',
      'Static IP Available (Add-on)',
    ],
    unlimitedData: true,
    symmetricalSpeed: true,
    fiberConnection: true,
    ipv6Support: false,
    gamingOptimized: false,
    streaming4k8k: false,
    staticIp: 'Add-on',
    prioritySupport: false,
    dedicatedBandwidth: '—',
    businessSla: '—',
    support24_7: false,
    lowLatencyRouting: false,
    directCloudPeering: false,
    hardwareReady: 'Gigabit ONU',
    ddosProtection: 'Basic',
    bgpFailover: '—',
    cirGuarantee: '—',
  },
  {
    id: 'PKG-002',
    name: 'Standard',
    speed: 200,
    uploadSpeed: 200,
    price: 29.99,
    bdixSpeed: 1000,
    popular: false,
    badge: 'Popular Everyday',
    speedLabel: '200 Mbps',
    category: 'Home Internet',
    targetCustomer: 'Regular Home Users',
    description: 'Robust 200 Mbps symmetrical fiber with Wi-Fi 6 ONU equipment for smooth multi-device households.',
    features: [
      '200 Mbps Symmetrical Download & Upload',
      '100% Unlimited Fiber Data',
      'Direct Optical Fiber GPON Connection',
      'Wi-Fi 6 ONU Equipment Included',
      'Basic DDoS Mitigation Shield',
      'Static IP Available (Add-on)',
    ],
    unlimitedData: true,
    symmetricalSpeed: true,
    fiberConnection: true,
    ipv6Support: false,
    gamingOptimized: false,
    streaming4k8k: false,
    staticIp: 'Add-on',
    prioritySupport: false,
    dedicatedBandwidth: '—',
    businessSla: '—',
    support24_7: false,
    lowLatencyRouting: false,
    directCloudPeering: false,
    hardwareReady: 'Wi-Fi 6 ONU',
    ddosProtection: 'Basic',
    bgpFailover: '—',
    cirGuarantee: '—',
  },
  {
    id: 'PKG-003',
    name: 'Advanced',
    speed: 300,
    uploadSpeed: 300,
    price: 39.99,
    bdixSpeed: 1000,
    popular: false,
    badge: 'Remote Work Ready',
    speedLabel: '300 Mbps',
    category: 'Home Internet',
    targetCustomer: 'Family / Remote Workers',
    description: 'High-capacity 300 Mbps symmetrical pipeline with full IPv6 support for remote professionals, video conferences, and seamless cloud syncing.',
    features: [
      '300 Mbps Symmetrical Download & Upload',
      '100% Unlimited Fiber Data',
      'Full IPv6 Dual-Stack Support',
      'Wi-Fi 6 ONU Equipment Included',
      'Basic DDoS Mitigation Shield',
      'Static IP Available (Add-on)',
    ],
    unlimitedData: true,
    symmetricalSpeed: true,
    fiberConnection: true,
    ipv6Support: true,
    gamingOptimized: false,
    streaming4k8k: false,
    staticIp: 'Add-on',
    prioritySupport: false,
    dedicatedBandwidth: '—',
    businessSla: '—',
    support24_7: false,
    lowLatencyRouting: false,
    directCloudPeering: false,
    hardwareReady: 'Wi-Fi 6 ONU',
    ddosProtection: 'Basic',
    bgpFailover: '—',
    cirGuarantee: '—',
  },
  {
    id: 'PKG-004',
    name: 'Premium',
    speed: 500,
    uploadSpeed: 500,
    price: 49.99,
    bdixSpeed: 1000,
    popular: true,
    badge: 'MOST POPULAR',
    speedLabel: '500 Mbps',
    category: 'Home Internet',
    targetCustomer: 'Heavy Users / Content Creators',
    description: 'Blazing 500 Mbps symmetrical pipe with gaming optimization, Sub-5ms low latency, Wi-Fi 6 Mesh, and 24/7 dedicated support.',
    features: [
      '500 Mbps Symmetrical Download & Upload',
      'Gaming Optimized FastPath Engine',
      'Sub-5ms Low Latency / FastPath Routing',
      'Wi-Fi 6 Mesh Equipment Included',
      '24/7 Dedicated Support',
      'Medium DDoS Mitigation Shield',
      'Full IPv6 Dual-Stack Support',
      'Static IP Available (Add-on)',
    ],
    unlimitedData: true,
    symmetricalSpeed: true,
    fiberConnection: true,
    ipv6Support: true,
    gamingOptimized: true,
    streaming4k8k: false,
    staticIp: 'Add-on',
    prioritySupport: false,
    dedicatedBandwidth: '—',
    businessSla: '—',
    support24_7: true,
    lowLatencyRouting: true,
    directCloudPeering: false,
    hardwareReady: 'Wi-Fi 6 Mesh',
    ddosProtection: 'Medium',
    bgpFailover: '—',
    cirGuarantee: '—',
  },
  {
    id: 'PKG-005',
    name: 'Ultra',
    speed: 750,
    uploadSpeed: 750,
    price: 69.99,
    bdixSpeed: 2000,
    popular: false,
    badge: 'Esports Choice',
    speedLabel: '750 Mbps',
    category: 'Advanced Internet',
    targetCustomer: 'Gaming / Streaming Enthusiasts',
    description: 'Ultra-low sub-millisecond ping and 750 Mbps symmetrical throughput engineered for competitive gaming tournaments and 8K HDR broadcasting.',
    features: [
      '750 Mbps Symmetrical Download & Upload',
      'Gaming Optimized & Esports FastPath',
      'Unrestricted 4K / 8K Multistreaming',
      'Direct Tier-1 CDN Peering (AWS/Google/Steam)',
      'Sub-5ms Low Latency / FastPath Routing',
      'Esports Router Equipment Included',
      '24/7 Dedicated Support',
      'Medium DDoS Mitigation Shield',
      'Static IP Available (Add-on)',
    ],
    unlimitedData: true,
    symmetricalSpeed: true,
    fiberConnection: true,
    ipv6Support: true,
    gamingOptimized: true,
    streaming4k8k: true,
    staticIp: 'Add-on',
    prioritySupport: false,
    dedicatedBandwidth: '—',
    businessSla: '—',
    support24_7: true,
    lowLatencyRouting: true,
    directCloudPeering: true,
    hardwareReady: 'Esports Router',
    ddosProtection: 'Medium',
    bgpFailover: '—',
    cirGuarantee: '—',
  },
  {
    id: 'PKG-006',
    name: 'Gigabit',
    speed: 1000,
    uploadSpeed: 1000,
    price: 89.99,
    bdixSpeed: 2000,
    popular: false,
    badge: '1 Gbps True Symmetrical',
    speedLabel: '1 Gbps',
    category: 'Home Internet',
    targetCustomer: 'Power Users / Smart Homes',
    description: 'Full 1 Gbps (1000 Mbps) symmetrical optical pipe powering whole-home multi-gig networks, 50+ smart devices, and zero-buffer 8K streaming.',
    features: [
      '1 Gbps (1000 Mbps) True Symmetrical Optical Fiber',
      'Wi-Fi 6E Tri-Band Equipment Included',
      'Bufferless 4K / 8K Multistreaming',
      'Direct Tier-1 CDN Peering (AWS/Google/Steam)',
      'Sub-5ms Low Latency / FastPath Routing',
      'Priority Support & 24/7 Helpdesk',
      'Medium DDoS Mitigation Shield',
      'IPv6 Dual-Stack & Static IP (Add-on)',
    ],
    unlimitedData: true,
    symmetricalSpeed: true,
    fiberConnection: true,
    ipv6Support: true,
    gamingOptimized: true,
    streaming4k8k: true,
    staticIp: 'Add-on',
    prioritySupport: true,
    dedicatedBandwidth: '—',
    businessSla: '—',
    support24_7: true,
    lowLatencyRouting: true,
    directCloudPeering: true,
    hardwareReady: 'Wi-Fi 6E Tri-Band',
    ddosProtection: 'Medium',
    bgpFailover: '—',
    cirGuarantee: '—',
  },
  {
    id: 'PKG-007',
    name: 'Multi-Gig',
    speed: 2000,
    uploadSpeed: 2000,
    price: 149.99,
    bdixSpeed: 5000,
    popular: false,
    badge: '2 Gbps Multi-Gigabit',
    speedLabel: '2 Gbps',
    category: 'Advanced Internet',
    targetCustomer: 'Studios / Professional Users',
    description: 'Next-generation 2 Gbps (2000 Mbps) symmetrical fiber with dedicated static IP included for production studios, heavy creators, and multi-gig labs.',
    features: [
      '2 Gbps (2000 Mbps) Extreme Symmetrical Fiber',
      '2.5G Port Optical ONU Included',
      'Dedicated Static Public IP Included',
      'Direct Tier-1 CDN Peering (AWS/Google/Steam)',
      'Priority Support & 24/7 Escalated NOC',
      'Advanced DDoS Shield (✓ Clean Pipe)',
      'Dedicated Bandwidth Option (Add-on)',
      'Business SLA & BGP Failover (Add-on)',
      '1:1 Dedicated CIR Bandwidth Ratio (Add-on)',
    ],
    unlimitedData: true,
    symmetricalSpeed: true,
    fiberConnection: true,
    ipv6Support: true,
    gamingOptimized: true,
    streaming4k8k: true,
    staticIp: 'Included',
    prioritySupport: true,
    dedicatedBandwidth: 'Add-on',
    businessSla: 'Add-on',
    support24_7: true,
    lowLatencyRouting: true,
    directCloudPeering: true,
    hardwareReady: '2.5G Port ONU',
    ddosProtection: '✓ (Clean Pipe)',
    bgpFailover: 'Add-on',
    cirGuarantee: 'Add-on',
  },
  {
    id: 'PKG-008',
    name: 'Business Pro',
    speed: 5000,
    uploadSpeed: 5000,
    price: 299.99,
    bdixSpeed: 10000,
    popular: false,
    badge: '5 Gbps Enterprise Grade',
    speedLabel: '5 Gbps',
    category: 'Business Internet',
    targetCustomer: 'Enterprise / Corporate',
    description: 'Carrier-grade 5 Gbps dedicated symmetrical pipe with 99.99% Business SLA, static IP, 1:1 CIR, and 10G SFP+ optical enterprise hardware.',
    features: [
      '5 Gbps (5000 Mbps) Carrier-Grade Dedicated Fiber',
      '10G SFP+ Enterprise ONU Included',
      '1:1 Dedicated CIR Bandwidth Ratio (100% CIR)',
      'BGP Multi-Carrier Failover Core (99.99% SLA)',
      'Enterprise Business SLA Included',
      'Dedicated Bandwidth Option Included',
      'Dedicated Static Public /29 Subnet Included',
      'Advanced Multi-Tbps DDoS Mitigation Shield',
      'Direct Tier-1 CDN Peering (AWS/Google/Steam)',
      '24/7 Dedicated Priority Enterprise NOC Team',
    ],
    unlimitedData: true,
    symmetricalSpeed: true,
    fiberConnection: true,
    ipv6Support: true,
    gamingOptimized: true,
    streaming4k8k: true,
    staticIp: 'Included',
    prioritySupport: true,
    dedicatedBandwidth: '✓',
    businessSla: '✓',
    support24_7: true,
    lowLatencyRouting: true,
    directCloudPeering: true,
    hardwareReady: '10G SFP+ ONU',
    ddosProtection: '✓ (Multi-Tbps)',
    bgpFailover: 'Included (99.99%)',
    cirGuarantee: 'Included (100% CIR)',
  },
]

const defaultContent = {
  brand: {
    name: "NextLink Global",
    tagline: "Next-Gen Ultra Fast Optical Fiber & Global Gigabit Internet",
    logoSubtitle: "GLOBAL FIBER NETWORK",
    logoUrl: "/logo.svg",
    phone: "+880 1575 XXXXXX",
    email: "support@nextlink.global",
    address: "One World Trade Center, Suite 8500, New York, NY 10007, USA",
    officeHours: "24/7 Global NOC & Support",
    facebook: "",
    youtube: ""
  },
  nav: {
    homeEn: "Home",
    coverageEn: "Coverage",
    applyEn: "Get Connected",
    supportEn: "Support",
    loginBtnEn: "Login",
    applyBtnEn: "Order Service"
  },
  notice: {
    active: false,
    textEn: ""
  },
  hero: {
    badgeEn: "🚀 Ultra Low-Latency Tier-1 Global Backbone",
    titleEn: "Blazing Fast Optical Gigabit Internet For Homes & Enterprises Worldwide",
    subtitleEn: "Experience symmetrical gigabit speeds up to 2.5 Gbps with direct Tier-1 cloud peering, bufferless 8K streaming, and 99.99% uptime SLA.",
    primaryBtnTextEn: "Explore Plans",
    secondaryBtnTextEn: "Check Availability",
    stats: []
  },
  packagesSection: {
    badgeEn: "International Gigabit Plans",
    titleEn: "Choose Your Ideal Worldwide Fiber Plan",
    subtitleEn: "All plans include 100% symmetrical speeds, unlimited bandwidth, and dedicated IPv4/IPv6.",
    chooseBtnEn: "Select Plan",
    popularBadgeEn: "Most Popular"
  },
  packages: defaultPackages,
  mediaHubs: {
    ftpUrl: "",
    liveTvUrl: "",
    speedtestUrl: ""
  },
  coverageSection: {
    titleEn: "Worldwide Active Metro Coverage Zones",
    subtitleEn: "Connected across global metropolitan cities and expanding."
  },
  coverageAreas: [],
  retention: {},
  // No fabricated history ships with the build. The referral program has no
  // tracking backend yet — the operator configures the copy in the admin panel
  // and the credits are not applied automatically. Empty lists render as no
  // stats rather than made-up ones.
  referralRewards: {
    enabled: false,
    bonusAmount: 25,
    discountPercent: 10,
    defaultCode: "",
    title: "Refer a friend",
    description: "Share your invite link with a friend — you both receive billing credit when they activate.",
    friendsJoinedCount: 0,
    totalSavedAmount: 0,
    tierName: "",
    referrals: [],
  },
  boostBandwidth: {
    enabled: false,
    boostSpeed: 1000,
    durationHours: 6,
    title: "Turbo Boost on Request",
    description: "Request a time-boxed speed burst over the service hours. Routed to support like any other change.",
    status: "",
    burstQuotaPerMonth: 0,
    history: [],
  },
  liveLatency: {
    enabled: true,
    title: "Realtime Ping & Latency",
    description: "Real-time response to Tier-1 international backbones",
    targets: [
      { id: "LAT-1", name: "Direct POP Peering", host: "pop.nextlink.net", ping: "1.2 ms", status: "optimal" },
      { id: "LAT-2", name: "Cloudflare Edge (1.1.1.1)", host: "1.1.1.1", ping: "2.4 ms", status: "optimal" },
      { id: "LAT-3", name: "Google DNS (8.8.8.8)", host: "8.8.8.8", ping: "3.1 ms", status: "optimal" },
      { id: "LAT-4", name: "AWS Cloud Peering", host: "aws.amazon.com", ping: "4.8 ms", status: "optimal" }
    ]
  },
  interfaceTraffic: {
    allocatedSpeed: 500,
    consumedDataGB: "648.2 GB",
    totalQuota: "Unlimited Symmetrical",
    downloadRateMbps: 498.2,
    uploadRateMbps: 494.7,
    gatewayIPv4: "198.51.100.12",
    gatewayIPv6: "2001:db8:85a3::8a2e:370:7334",
    oltPort: "2/1/4",
    terminalStatus: "Synchronized",
    interfaces: [
      { id: "IF-1", name: "sfp-sfpplus1 (Uplink)", type: "Optical 10G SFP+", rx: "4.82 Gbps", tx: "3.91 Gbps", status: "Up" },
      { id: "IF-2", name: "ether1-gateway (Client Drop)", type: "Gigabit Ethernet", rx: "498.2 Mbps", tx: "494.7 Mbps", status: "Up" },
      { id: "IF-3", name: "gpon-olt-port (Fiber PON)", type: "GPON ITU-T G.984", rx: "1.24 Gbps", tx: "1.18 Gbps", status: "Up" }
    ]
  },
  peeringHubs: [
    { id: "HUB-1", name: "Speedtest Diagnostic", url: "https://speedtest.net", badge: "Tier-1", category: "speedtest", status: "Active" },
    { id: "HUB-2", name: "Global Storage CDN", url: "https://storage.nextlink.global", badge: "Gigabit", category: "cdn", status: "Active" },
    { id: "HUB-3", name: "Ultra HD Streaming", url: "https://tv.nextlink.global", badge: "4K HDR", category: "streaming", status: "Active" },
    { id: "HUB-4", name: "Cloudflare IX Gateway", url: "https://cloudflare.com", badge: "Edge Anycast", category: "peering", status: "Active" }
  ],
  ctaBanner: {
    titleEn: "Ready For Blazing Fast Gigabit Fiber Worldwide?",
    btnCallEn: "Call Support",
    btnApplyEn: "Apply Now"
  },
  footer: {
    copyrightEn: "All rights reserved."
  }
}

export const useContentStore = create<ContentState>((set) => ({
  ...defaultContent,
  isLoading: false,
  lastFetched: null,
  fetchContent: async () => {
    try {
      set({ isLoading: true })
      let data: any = null
      try {
        const res = await fetch(`/api/content?t=${Date.now()}`, { cache: 'no-store' })
        if (res.ok) {
          data = await res.json()
        }
      } catch (e) {}

      if (!data) {
        try {
          const res2 = await fetch(`http://localhost:8000/api/content?t=${Date.now()}`, { cache: 'no-store' })
          if (res2.ok) {
            data = await res2.json()
          }
        } catch (e) {}
      }

      if (data && typeof data === 'object') {
        // The payload is merged into the current state instead of replacing
        // it. A partial response used to reset the brand, the hero and the
        // whole package catalogue to the built-in defaults, which emptied
        // the pricing page and made the application form unsubmittable.
        set((state) => ({
          brand: data.brand || state.brand,
          nav: data.nav || state.nav,
          notice: data.notice || state.notice,
          hero: data.hero || state.hero,
          packagesSection: data.packagesSection || state.packagesSection,
          packages: Array.isArray(data.packages) ? data.packages : state.packages,
          mediaHubs: data.mediaHubs || state.mediaHubs,
          coverageSection: data.coverageSection || state.coverageSection,
          coverageAreas: Array.isArray(data.coverageAreas) ? data.coverageAreas : state.coverageAreas,
          retention: data.retention || state.retention,
          referralRewards: data.referralRewards || state.referralRewards,
          boostBandwidth: data.boostBandwidth || state.boostBandwidth,
          liveLatency: data.liveLatency || state.liveLatency,
          interfaceTraffic: data.interfaceTraffic || state.interfaceTraffic,
          peeringHubs: Array.isArray(data.peeringHubs) ? data.peeringHubs : state.peeringHubs,
          ctaBanner: data.ctaBanner || state.ctaBanner,
          footer: data.footer || state.footer,
          lastFetched: Date.now(),
          isLoading: false,
        }))
      } else {
        set({ isLoading: false })
      }
    } catch (e) {
      set({ isLoading: false })
    }
  },
}))
