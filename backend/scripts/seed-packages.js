const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const connectionString = 'postgresql://postgres:Maruf%402000%23@localhost:5432/nextlink_db';
const pool = new Pool({ connectionString });

const mockPackages = [
  {
    id: 'PKG-001',
    name: 'Essential',
    downloadSpeed: 100,
    uploadSpeed: 100,
    price: 19.99,
    duration: 30,
    category: 'Home Internet',
    targetCustomer: 'Individual / Small Household',
    popular: false,
    badge: 'Starter Symmetrical',
    speedLabel: '100 Mbps',
    description: 'Reliable 100 Mbps symmetrical optical fiber for everyday browsing, HD video calls, and essential smart devices.',
    subscriberCount: 85,
    features: [
      '100 Mbps Symmetrical Download & Upload',
      'Unlimited Global Data (No FUP)',
      '100% Direct Optical Fiber Connection',
      'Static IP Available (Add-on)',
      'Sub-5ms Local Metro Latency',
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
  },
  {
    id: 'PKG-002',
    name: 'Standard',
    downloadSpeed: 200,
    uploadSpeed: 200,
    price: 29.99,
    duration: 30,
    category: 'Home Internet',
    targetCustomer: 'Regular Home Users',
    popular: false,
    badge: 'Popular Everyday',
    speedLabel: '200 Mbps',
    description: 'Robust 200 Mbps symmetrical fiber with IPv6 dual-stack and gaming routing for multi-device households.',
    subscriberCount: 142,
    features: [
      '200 Mbps Symmetrical Download & Upload',
      'Unlimited Global Data',
      'IPv6 Dual-Stack Support',
      'Gaming Low-Latency Engine',
      'Bufferless 4K UHD Streaming',
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
    support24_7: false,
  },
  {
    id: 'PKG-003',
    name: 'Advanced',
    downloadSpeed: 300,
    uploadSpeed: 300,
    price: 39.99,
    duration: 30,
    category: 'Home Internet',
    targetCustomer: 'Family / Remote Workers',
    popular: false,
    badge: 'Remote Work Ready',
    speedLabel: '300 Mbps',
    description: 'High-capacity 300 Mbps symmetrical pipeline ideal for remote professionals, simultaneous video conferences, and seamless cloud syncing.',
    subscriberCount: 93,
    features: [
      '300 Mbps Symmetrical Download & Upload',
      'Unlimited High-Speed Data',
      'IPv6 Dual-Stack & Cloud Peering',
      'Zero-Jitter Gaming & Video Calls',
      'Multi-device 4K / 8K UHD Streaming',
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
    support24_7: false,
  },
  {
    id: 'PKG-004',
    name: 'Premium',
    downloadSpeed: 500,
    uploadSpeed: 500,
    price: 49.99,
    duration: 30,
    category: 'Home Internet',
    targetCustomer: 'Heavy Users / Content Creators',
    popular: true,
    badge: 'MOST POPULAR',
    speedLabel: '500 Mbps',
    description: 'Blazing 500 Mbps symmetrical pipe tailored for content creators, live streamers, heavy cloud workflows, and 24/7 priority support.',
    subscriberCount: 215,
    features: [
      '500 Mbps Symmetrical Download & Upload',
      'Unlimited Unthrottled Data',
      'Priority Tier-1 BGP Peering Routes',
      'IPv6 & Esports Gaming Optimization',
      'Simultaneous 4K / 8K Multistreaming',
      '24/7 Dedicated Priority NOC Support',
      'Static IP Available (Add-on)',
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
  },
  {
    id: 'PKG-005',
    name: 'Ultra',
    downloadSpeed: 750,
    uploadSpeed: 750,
    price: 69.99,
    duration: 30,
    category: 'Advanced Internet',
    targetCustomer: 'Gaming / Streaming Enthusiasts',
    popular: false,
    badge: 'Esports Choice',
    speedLabel: '750 Mbps',
    description: 'Ultra-low sub-millisecond ping and 750 Mbps symmetrical throughput engineered for competitive gaming tournaments and 8K HDR broadcasting.',
    subscriberCount: 68,
    features: [
      '750 Mbps Symmetrical Download & Upload',
      'Ultra Low Latency Fastpath Engine',
      'Unrestricted 8K UHD Streaming Bandwidth',
      'Global Direct POP Cloud Peering',
      '24/7 Priority VIP NOC Dispatch',
      'Static IP Available (Add-on)',
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
  },
  {
    id: 'PKG-006',
    name: 'Gigabit',
    downloadSpeed: 1000,
    uploadSpeed: 1000,
    price: 89.99,
    duration: 30,
    category: 'Home Internet',
    targetCustomer: 'Power Users / Smart Homes',
    popular: false,
    badge: '1 Gbps True Symmetrical',
    speedLabel: '1 Gbps',
    description: 'Full 1 Gbps (1000 Mbps) symmetrical optical pipe powering whole-home multi-gig networks, VR environments, and massive cloud backups.',
    subscriberCount: 47,
    features: [
      '1 Gbps (1000 Mbps) Symmetrical Optical Bandwidth',
      'Zero-Buffer Whole-Home Smart Network',
      'IPv6 Dual-Stack & Direct Cloud Backbones',
      'High-Priority 24/7 NOC Assistance',
      'Esports & 8K Master Streaming Ready',
      'Static IP Available (Add-on)',
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
  },
  {
    id: 'PKG-007',
    name: 'Multi-Gig',
    downloadSpeed: 2000,
    uploadSpeed: 2000,
    price: 149.99,
    duration: 30,
    category: 'Advanced Internet',
    targetCustomer: 'Studios / Professional Users',
    popular: false,
    badge: '2 Gbps Multi-Gigabit',
    speedLabel: '2 Gbps',
    description: 'Next-generation 2 Gbps (2000 Mbps) symmetrical fiber with dedicated static IP included for production studios and professional creators.',
    subscriberCount: 24,
    features: [
      '2 Gbps (2000 Mbps) Symmetrical Fiber',
      'Dedicated Static Public IPv4 Address Included',
      'Dedicated Bandwidth Option (Add-on)',
      'Business SLA Option (Add-on)',
      '24/7 VIP Escalated NOC Support',
      'Requires 2.5G/10G ONU & Compatible Hardware',
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
  },
  {
    id: 'PKG-008',
    name: 'Business Pro',
    downloadSpeed: 5000,
    uploadSpeed: 5000,
    price: 299.99,
    duration: 30,
    category: 'Business Internet',
    targetCustomer: 'Enterprise / Corporate',
    popular: false,
    badge: '5 Gbps Enterprise Grade',
    speedLabel: '5 Gbps',
    description: 'Carrier-grade 5 Gbps dedicated symmetrical pipe with 99.99% Business SLA, static IP, and 1:1 CIR dedicated enterprise connectivity.',
    subscriberCount: 12,
    features: [
      '5 Gbps (5000 Mbps) Ultra-Carrier Optical Fiber',
      '99.99% Uptime Enterprise Business SLA Included',
      '1:1 Dedicated Bandwidth CIR (Committed Info Rate)',
      'Dedicated Static Public /29 Subnet Ready',
      '24/7/365 Dedicated Enterprise NOC Team',
      'Requires 10G SFP+ Optical ONU Terminal & Port',
    ],
    unlimitedData: true,
    symmetricalSpeed: true,
    fiberConnection: true,
    ipv6Support: true,
    gamingOptimized: true,
    streaming4k8k: true,
    staticIp: 'Included',
    prioritySupport: true,
    dedicatedBandwidth: 'Included',
    businessSla: 'Included',
    support24_7: true,
  },
];

async function run() {
  try {
    // 1. Update PostgreSQL packages table
    await pool.query('DELETE FROM packages');
    for (const item of mockPackages) {
      await pool.query(
        `INSERT INTO packages (id, name, speed, upload_speed, price, duration, description, subscriber_count, raw_data, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
        [
          item.id,
          item.name,
          item.downloadSpeed,
          item.uploadSpeed,
          item.price,
          item.duration,
          item.description,
          item.subscriberCount,
          JSON.stringify(item),
        ]
      );
    }
    console.log('PostgreSQL packages table seeded successfully!');

    // 2. Update adminStore.json
    const adminStorePath = path.join(__dirname, '..', 'data', 'adminStore.json');
    if (fs.existsSync(adminStorePath)) {
      const adminStore = JSON.parse(fs.readFileSync(adminStorePath, 'utf8'));
      adminStore.packages = mockPackages;
      adminStore.lastUpdated = new Date().toISOString();
      fs.writeFileSync(adminStorePath, JSON.stringify(adminStore, null, 2), 'utf8');
      console.log('adminStore.json updated!');
    }

    // 3. Update siteData.json
    const siteDataPath = path.join(__dirname, '..', 'data', 'siteData.json');
    let siteData = {};
    if (fs.existsSync(siteDataPath)) {
      siteData = JSON.parse(fs.readFileSync(siteDataPath, 'utf8'));
    }
    siteData.packages = mockPackages.map(p => ({
      id: p.id,
      name: p.name,
      speed: p.downloadSpeed,
      uploadSpeed: p.uploadSpeed,
      price: p.price,
      bdixSpeed: p.downloadSpeed >= 1000 ? 5000 : 1000,
      popular: !!p.popular,
      badge: p.badge,
      speedLabel: p.speedLabel,
      category: p.category,
      targetCustomer: p.targetCustomer,
      description: p.description,
      features: p.features,
      unlimitedData: p.unlimitedData,
      symmetricalSpeed: p.symmetricalSpeed,
      fiberConnection: p.fiberConnection,
      ipv6Support: p.ipv6Support,
      gamingOptimized: p.gamingOptimized,
      streaming4k8k: p.streaming4k8k,
      staticIp: p.staticIp,
      prioritySupport: p.prioritySupport,
      dedicatedBandwidth: p.dedicatedBandwidth,
      businessSla: p.businessSla,
      support24_7: p.support24_7,
    }));
    fs.writeFileSync(siteDataPath, JSON.stringify(siteData, null, 2), 'utf8');
    console.log('siteData.json updated!');

    // 4. Update app_settings in DB
    await pool.query(
      `INSERT INTO app_settings (key, value, updated_at)
       VALUES ('siteData', $1, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [JSON.stringify(siteData)]
    );
    console.log('app_settings siteData updated in PostgreSQL!');

    await pool.end();
  } catch (e) {
    console.error('Error:', e);
    await pool.end();
  }
}
run();

