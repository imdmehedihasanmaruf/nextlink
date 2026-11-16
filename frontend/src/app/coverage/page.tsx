'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { Search, MapPin, CheckCircle, XCircle, ArrowRight, Globe, Loader2, Map as MapIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { useTranslation } from '@/store/settingsStore'
import { useContentStore } from '@/store/contentStore'
import { useAuthStore } from '@/store/authStore'
import {
  fetchCoverageZones,
  fetchCoverageDistricts,
  fetchCoverageAreas,
  checkCoverage,
  type CoverageArea,
} from '@/lib/portalApi'
import Link from 'next/link'

const NetworkCoverageMap = dynamic(() => import('@/components/NetworkCoverageMap'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-[550px] min-h-[500px] rounded-2xl border bg-muted/30 flex items-center justify-center">
      <div className="flex items-center gap-2 text-xs text-muted-foreground font-semibold">
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
        <span>Loading Interactive World Coverage Map...</span>
      </div>
    </div>
  ),
})

/**
 * The coverage data itself now comes from the NextLink API
 * (`/api/coverage/*`), which the admin panel maintains. These local
 * fallbacks keep the page usable when the service is unreachable.
 */
const fallbackCoverageData: Record<string, Record<string, string[]>> = {
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

const fallbackCoveredAreas = [
  'Manhattan Financial District', 'Midtown Manhattan', 'Brooklyn DUMBO', 'San Francisco SoMa', 'San Jose Downtown',
  'City of London', 'Canary Wharf Financial Hub', 'Frankfurt Financial Centre', 'Shinjuku High-Rise District',
  'Marina Bay Financial Centre', 'Sydney CBD Financial Core', 'DIFC (Dubai Financial)'
]

export default function CoveragePage() {
  const router = useRouter()
  const { t } = useTranslation()
  const { isAuthenticated } = useAuthStore()
  const { coverageAreas, coverageSection, fetchContent } = useContentStore()
  const [region, setRegion] = useState('')
  const [metro, setMetro] = useState('')
  const [area, setArea] = useState('')
  const [result, setResult] = useState<'available' | 'unavailable' | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    fetchContent()
  }, [fetchContent])

  // Live coverage data served by the NextLink API.
  const [zones, setZones] = useState<Array<{ zone: string; area_count: number; available_count: number }>>([])
  const [districts, setDistricts] = useState<Array<{ district: string; area_count: number; available_count: number }>>([])
  const [mapAreas, setMapAreas] = useState<CoverageArea[]>([])
  const [dataOnline, setDataOnline] = useState<boolean | null>(null)

  const loadZones = useCallback(async () => {
    const [zonesResult, areasResult] = await Promise.all([
      fetchCoverageZones(),
      fetchCoverageAreas(),
    ])
    if (zonesResult.success) {
      setZones(zonesResult.zones || [])
      setDataOnline(true)
    } else {
      setDataOnline(false)
    }
    if (areasResult.success) setMapAreas(areasResult.areas || [])
  }, [])

  useEffect(() => {
    loadZones()
    const timer = setInterval(() => {
      loadZones()
    }, 5000)
    return () => clearInterval(timer)
  }, [loadZones])

  // Load the districts of the selected zone. A stale list from the previous
  // zone is cleared immediately and again when the request fails.
  const [districtsError, setDistrictsError] = useState<string | null>(null)

  useEffect(() => {
    if (!region) {
      setDistricts([])
      setDistrictsError(null)
      return
    }
    // Clear the previous zone's districts right away — otherwise the visitor
    // sees markets from another region while the new list loads.
    setDistricts([])
    setDistrictsError(null)
    let cancelled = false
    fetchCoverageDistricts(region).then((result) => {
      if (cancelled) return
      if (result.success) {
        setDistricts(result.districts || [])
      } else {
        setDistricts([])
        setDistrictsError(result.error || 'The district list could not be loaded.')
      }
    }).catch(() => {
      if (cancelled) return
      setDistricts([])
      setDistrictsError('The district list could not be loaded.')
    })
    return () => {
      cancelled = true
    }
  }, [region])

  // The districts are the metros of the selected zone, so they are grouped
  // from the zone explicitly. The areas shown belong to the selected metro.
  const areas = metro
    ? mapAreas
        .filter(
          (entry) => (entry.district || '').toLowerCase() === metro.toLowerCase(),
        )
        .flatMap((entry) => entry.areas || [])
    : []

  const handleCheck = async () => {
    if (!area) return

    setLoading(true)
    const check = await checkCoverage(region, metro || undefined, area)
    setLoading(false)

    if (!check.success) {
      const matchedFallback =
        fallbackCoveredAreas.includes(area) ||
        coverageAreas.some((ca) => (ca.areas || '').toLowerCase().includes(area.toLowerCase()))
      setResult(matchedFallback ? 'available' : 'unavailable')
      return
    }
    setResult(check.covered ? 'available' : 'unavailable')
  }

  return (
    <div className="min-h-screen py-10 px-4 bg-background">
      <div className="container mx-auto max-w-4xl">
        {/* Header */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center h-16 w-16 rounded-full bg-primary/10 mb-4 shadow-sm">
            <Globe size={28} className="text-primary" />
          </div>
          <h1 className="text-3xl font-extrabold mb-2 tracking-tight">
            {coverageSection?.titleEn || 'Worldwide Optical Coverage & Availability'}
          </h1>
          <p className="text-muted-foreground max-w-lg mx-auto">
            {coverageSection?.subtitleEn || 'Verify if your metropolitan business or residential district is connected to NextLink’s global Tier-1 fiber ring.'}
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
                <label htmlFor="coverage-region" className="text-sm font-semibold">Select Region / Continent</label>
                <Select
                  id="coverage-region"
                  value={region}
                  onChange={(e) => {
                    setRegion(e.target.value)
                    setMetro('')
                    setArea('')
                    setResult(null)
                  }}
                >
                  <option value="">Select Region...</option>
                  {zones.map((z) => (
                    <option key={z.zone} value={z.zone}>{z.zone}</option>
                  ))}
                </Select>
              </div>

              <div className="space-y-2">
                <label htmlFor="coverage-metro" className="text-sm font-semibold">Select Metropolitan Market</label>
                <Select
                  id="coverage-metro"
                  value={metro}
                  disabled={!region}
                  onChange={(e) => {
                    setMetro(e.target.value)
                    setArea('')
                    setResult(null)
                  }}
                >
                  <option value="">Select Metro Market...</option>
                  {districts.map((district) => (
                    <option key={district.district} value={district.district}>{district.district}</option>
                  ))}
                </Select>
                {districtsError && (
                  <p className="text-[11px] text-amber-700 dark:text-amber-400">{districtsError}</p>
                )}
              </div>

              <div className="space-y-2">
                <label htmlFor="coverage-area" className="text-sm font-semibold">Select District / Sector</label>
                <Select
                  id="coverage-area"
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
                  {metro && areas.length === 0 && (
                    <option value="" disabled>No districts listed for this market</option>
                  )}
                </Select>
              </div>
            </div>

            <Button
              onClick={handleCheck}
              disabled={!area || loading}
              className="w-full font-bold shadow"
            >
              {loading ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Verifying Optical Ring...</>
              ) : (
                'Verify Gigabit Fiber Coverage'
              )}
            </Button>

            {dataOnline === false && (
              <p className="mt-3 text-xs text-center text-muted-foreground">
                The live coverage service is unreachable — the map below shows the last known network footprint.
              </p>
            )}

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

        {/* Real Interactive Leaflet Network Coverage Map */}
        <div className="space-y-4 mb-8">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h2 className="text-xl font-bold flex items-center gap-2">
                <MapIcon size={20} className="text-primary" /> Network Coverage Map
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Explore NextLink global points of presence (POPs), metro aggregation rings, and planned fiber expansions.
              </p>
            </div>
          </div>

          <NetworkCoverageMap areas={mapAreas} loading={mapAreas.length === 0} />
        </div>

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
