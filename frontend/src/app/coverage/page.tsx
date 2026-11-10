'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Search, MapPin, CheckCircle, XCircle, ArrowRight, Globe } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { useTranslation } from '@/store/settingsStore'
import { useContentStore } from '@/store/contentStore'
import { useAuthStore } from '@/store/authStore'
import Link from 'next/link'

const globalCoverageData: Record<string, Record<string, string[]>> = {
  'North America': {
    'New York Metro': ['Manhattan Financial District', 'Midtown Manhattan', 'Brooklyn DUMBO', 'Queens LIC', 'Jersey City Waterfront'],
    'Silicon Valley': ['San Jose Downtown', 'Palo Alto Stanford Corridor', 'Sunnyvale Tech Campus', 'San Francisco SoMa'],
    'Toronto & GTA': ['Downtown Toronto Financial Core', 'Mississauga City Centre', 'Markham High-Tech Hub', 'Vaughan Metropolitan'],
  },
  'Europe': {
    'London Central': ['City of London', 'Westminster', 'Canary Wharf Financial Hub', 'Camden Tech Quarter'],
    'Frankfurt & Rhine': ['Frankfurt Financial Centre', 'Offenbach Data Cluster', 'Wiesbaden Hub', 'Darmstadt Tech Corridor'],
    'Paris Metro': ['Paris 8e Arrondissement', 'La Défense Business Park', 'Boulogne-Billancourt', 'Saint-Denis Pleyel'],
  },
  'Asia-Pacific': {
    'Tokyo & Kanto': ['Shinjuku High-Rise District', 'Shibuya Tech Hub', 'Chiyoda Marunouchi', 'Yokohama Minato Mirai', 'Roppongi'],
    'Singapore CBD': ['Marina Bay Financial Centre', 'Orchard Core', 'One-North Bio/Tech Park', 'Changi Business Park'],
    'Sydney Metro': ['Sydney CBD Financial Core', 'North Sydney', 'Parramatta Square', 'Surry Hills Creative Hub'],
  },
  'Middle East': {
    'Dubai & Abu Dhabi': ['DIFC (Dubai Financial)', 'Business Bay', 'Downtown Dubai', 'Dubai Marina', 'Al Maryah Island'],
  },
}

const coveredAreas = [
  'Manhattan Financial District', 'Midtown Manhattan', 'Brooklyn DUMBO', 'San Francisco SoMa', 'San Jose Downtown',
  'City of London', 'Canary Wharf Financial Hub', 'Frankfurt Financial Centre', 'Shinjuku High-Rise District',
  'Marina Bay Financial Centre', 'Sydney CBD Financial Core', 'DIFC (Dubai Financial)'
]

export default function CoveragePage() {
  const router = useRouter()
  const { t } = useTranslation()
  const { isAuthenticated } = useAuthStore()
  const { coverageAreas } = useContentStore()
  const [region, setRegion] = useState('')
  const [metro, setMetro] = useState('')
  const [area, setArea] = useState('')
  const [result, setResult] = useState<'available' | 'unavailable' | null>(null)
  const [loading, setLoading] = useState(false)

  const regions = Object.keys(globalCoverageData)
  const metros = region ? Object.keys(globalCoverageData[region] || {}) : []
  const areas = region && metro ? (globalCoverageData[region]?.[metro] || []) : []

  const handleCheck = () => {
    // If user is not authenticated, redirect to login page before verifying
    if (!isAuthenticated) {
      router.push('/login?redirect=coverage')
      return
    }
    if (!area) return
    setLoading(true)
    setTimeout(() => {
      setResult(coveredAreas.includes(area) ? 'available' : 'unavailable')
      setLoading(false)
    }, 800)
  }

  return (
    <div className="min-h-screen py-10 px-4 bg-background">
      <div className="container mx-auto max-w-4xl">
        {/* Header */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center h-16 w-16 rounded-full bg-primary/10 mb-4 shadow-sm">
            <Globe size={28} className="text-primary" />
          </div>
          <h1 className="text-3xl font-extrabold mb-2 tracking-tight">Worldwide Optical Coverage & Availability</h1>
          <p className="text-muted-foreground max-w-lg mx-auto">
            Verify if your metropolitan business or residential district is connected to NextLink’s global Tier-1 fiber ring.
          </p>
        </div>

        {/* Search card */}
        <Card className="mb-8 shadow-lg border">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Search size={20} className="text-primary" />
              Check District Fiber Availability
            </CardTitle>
            <CardDescription>Select continent, metropolitan market, and localized district</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
              <div className="space-y-2">
                <label className="text-sm font-semibold">Select Region / Continent</label>
                <Select
                  value={region}
                  onChange={(e) => {
                    setRegion(e.target.value)
                    setMetro('')
                    setArea('')
                    setResult(null)
                  }}
                >
                  <option value="">Select Region...</option>
                  {regions.map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </Select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-semibold">Select Metropolitan Market</label>
                <Select
                  value={metro}
                  disabled={!region}
                  onChange={(e) => {
                    setMetro(e.target.value)
                    setArea('')
                    setResult(null)
                  }}
                >
                  <option value="">Select Metro Market...</option>
                  {metros.map((th) => (
                    <option key={th} value={th}>{th}</option>
                  ))}
                </Select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-semibold">Select District / Sector</label>
                <Select
                  value={area}
                  disabled={!metro}
                  onChange={(e) => {
                    setArea(e.target.value)
                    setResult(null)
                  }}
                >
                  <option value="">Select District...</option>
                  {areas.map((a) => (
                    <option key={a} value={a}>{a}</option>
                  ))}
                </Select>
              </div>
            </div>

            <Button
              onClick={handleCheck}
              disabled={isAuthenticated && (!area || loading)}
              className="w-full font-bold shadow"
            >
              {loading ? 'Verifying Optical Ring...' : 'Verify Gigabit Fiber Coverage'}
            </Button>

            {/* Result */}
            {result && (
              <div className={`mt-6 p-5 rounded-xl border flex items-center justify-between animate-in fade-in ${
                result === 'available'
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-800 dark:text-emerald-300'
                  : 'bg-amber-500/10 border-amber-500/30 text-amber-800 dark:text-amber-300'
              }`}>
                <div className="flex items-center gap-3">
                  {result === 'available' ? (
                    <CheckCircle className="text-emerald-600 flex-shrink-0" size={26} />
                  ) : (
                    <XCircle className="text-amber-600 flex-shrink-0" size={26} />
                  )}
                  <div>
                    <h3 className="font-bold text-base">
                      {result === 'available' ? 'Gigabit Fiber Ready!' : 'Scheduled for Network Expansion'}
                    </h3>
                    <p className="text-xs opacity-90 mt-0.5">
                      {result === 'available'
                        ? `Congratulations! Optical fiber line is operational in ${area}. Provisioning SLA is 24-48 hours.`
                        : `NextLink optical ring is currently expanding towards ${area}. Pre-order to expedite installation.`}
                    </p>
                  </div>
                </div>

                <Link href="/apply">
                  <Button size="sm" className="font-bold gap-1 shadow flex-shrink-0">
                    <span>Order Connection</span>
                    <ArrowRight size={14} />
                  </Button>
                </Link>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Global Hubs Grid */}
        {coverageAreas && coverageAreas.length > 0 && (
          <div className="space-y-4">
            <h2 className="text-xl font-bold flex items-center gap-2">
              <MapPin size={20} className="text-primary" /> Active International Optical POPs
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {coverageAreas.map((hub, idx) => (
                <Card key={idx} className="border shadow-sm hover:border-primary/50 transition-colors">
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base">{hub.zone}</CardTitle>
                      <Badge variant="secondary" className="text-[10px] bg-emerald-500/10 text-emerald-600 font-bold border-emerald-500/30">
                        {hub.status}
                      </Badge>
                    </div>
                    <CardDescription className="text-xs font-semibold text-primary">{hub.district}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p className="text-xs text-muted-foreground">{hub.areas}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
