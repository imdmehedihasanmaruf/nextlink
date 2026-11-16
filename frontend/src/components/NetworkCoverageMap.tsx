'use client'

import React, { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { Navigation, RefreshCw, AlertCircle, Layers } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import type { CoverageArea } from '@/lib/portalApi'

interface NetworkCoverageMapProps {
  areas: CoverageArea[]
  loading?: boolean
  onSelectArea?: (area: CoverageArea) => void
}

export default function NetworkCoverageMap({
  areas,
  loading = false,
  onSelectArea,
}: NetworkCoverageMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<L.Map | null>(null)
  const markersLayerRef = useRef<L.LayerGroup | null>(null)
  const userMarkerRef = useRef<L.CircleMarker | null>(null)

  const [tileError, setTileError] = useState(false)
  const [selectedPoint, setSelectedPoint] = useState<CoverageArea | null>(null)
  const [locating, setLocating] = useState(false)
  const [activeFilter, setActiveFilter] = useState<'all' | 'available' | 'planned'>('all')

  // Initialize Leaflet Map
  useEffect(() => {
    if (!mapContainerRef.current) return
    if (mapInstanceRef.current) return // Already initialized

    // World view center
    const map = L.map(mapContainerRef.current, {
      center: [25.0, 10.0],
      zoom: 2.2,
      minZoom: 2,
      maxZoom: 18,
      worldCopyJump: true,
      zoomControl: true,
    })

    const tileLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors | NextLink Optical Backbone',
    })

    tileLayer.on('tileerror', () => {
      setTileError(true)
    })

    tileLayer.addTo(map)

    const markersGroup = L.layerGroup().addTo(map)
    markersLayerRef.current = markersGroup
    mapInstanceRef.current = map

    // Attempt gentle auto-locate on initial mount
    if (typeof window !== 'undefined' && 'geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude } = position.coords
          if (mapInstanceRef.current) {
            const userPulse = L.circleMarker([latitude, longitude], {
              radius: 9,
              color: '#3b82f6',
              fillColor: '#60a5fa',
              fillOpacity: 0.9,
              weight: 3,
            }).bindPopup(
              `<div style="font-family: inherit; font-size: 12px; padding: 4px;">
                <strong style="color: #2563eb;">📍 Your Current Location</strong>
                <p style="margin: 4px 0 0; color: #64748b; font-size: 11px;">Comparing distance to NextLink POPs...</p>
              </div>`
            )
            userPulse.addTo(mapInstanceRef.current)
            userMarkerRef.current = userPulse
          }
        },
        () => {
          // Geolocation declined or unavailable — keep global default
        },
        { timeout: 4000 }
      )
    }

    return () => {
      map.remove()
      mapInstanceRef.current = null
      markersLayerRef.current = null
    }
  }, [])

  // Plot markers when `areas` or `activeFilter` changes
  useEffect(() => {
    const map = mapInstanceRef.current
    const group = markersLayerRef.current
    if (!map || !group) return

    group.clearLayers()

    const validAreas = areas.filter((a) => {
      if (a.lat === null || a.lng === null) return false
      const lat = Number(a.lat)
      const lng = Number(a.lng)
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false
      if (activeFilter === 'available' && a.status !== 'available') return false
      if (activeFilter === 'planned' && a.status === 'available') return false
      return true
    })

    validAreas.forEach((item) => {
      const lat = Number(item.lat)
      const lng = Number(item.lng)
      const isAvailable = item.status === 'available'

      // Outer ripple circle for active POPs
      if (isAvailable) {
        const outerCircle = L.circleMarker([lat, lng], {
          radius: 14,
          color: '#10b981',
          fillColor: '#10b981',
          fillOpacity: 0.15,
          weight: 1,
          interactive: false,
        })
        group.addLayer(outerCircle)
      }

      // Main core marker
      const marker = L.circleMarker([lat, lng], {
        radius: isAvailable ? 8 : 6,
        color: isAvailable ? '#059669' : '#d97706',
        fillColor: isAvailable ? '#10b981' : '#f59e0b',
        fillOpacity: 0.9,
        weight: 2,
      })

      const areasListHtml = Array.isArray(item.areas)
        ? item.areas.slice(0, 4).map((a) => `<li style="margin: 2px 0;">${a}</li>`).join('')
        : ''

      const popupHtml = `
        <div style="font-family: inherit; font-size: 12px; min-width: 220px; line-height: 1.4; color: inherit;">
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px; border-bottom: 1px solid rgba(148, 163, 184, 0.3); padding-bottom: 4px;">
            <strong style="font-size: 13px; color: inherit;">${item.district || item.zone}</strong>
            <span style="display: inline-block; padding: 2px 6px; font-size: 10px; font-weight: 700; border-radius: 9999px; text-transform: uppercase; ${
              isAvailable
                ? 'background-color: rgba(16, 185, 129, 0.2); color: #10b981;'
                : 'background-color: rgba(245, 158, 11, 0.2); color: #f59e0b;'
            }">
              ${isAvailable ? 'Operational' : 'Expanding'}
            </span>
          </div>
          <p style="margin: 0 0 4px; opacity: 0.8; font-size: 11px;">
            Region: <strong>${item.zone}</strong>
          </p>
          <p style="margin: 0 0 6px; color: #10b981; font-weight: 600; font-size: 11px;">
            ⚡ Speeds: ${isAvailable ? 'Up to 10 Gbps (Symmetric)' : 'Planned 1-10 Gbps'}
          </p>
          ${
            areasListHtml
              ? `<p style="margin: 4px 0 2px; font-weight: 600; font-size: 11px; opacity: 0.9;">Coverage Nodes:</p>
                 <ul style="margin: 0; padding-left: 14px; font-size: 11px; opacity: 0.8;">
                   ${areasListHtml}
                 </ul>`
              : ''
          }
          ${item.notes ? `<p style="margin: 6px 0 0; font-style: italic; font-size: 10px; opacity: 0.6;">${item.notes}</p>` : ''}
        </div>
      `

      marker.bindPopup(popupHtml)
      marker.on('click', () => {
        setSelectedPoint(item)
        if (onSelectArea) onSelectArea(item)
      })

      group.addLayer(marker)
    })
  }, [areas, activeFilter, onSelectArea])

  const handleLocateMe = () => {
    if (!navigator.geolocation || !mapInstanceRef.current) return
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false)
        const { latitude, longitude } = pos.coords
        const map = mapInstanceRef.current
        if (!map) return

        map.flyTo([latitude, longitude], 11, { duration: 1.5 })

        if (userMarkerRef.current) {
          userMarkerRef.current.setLatLng([latitude, longitude])
        } else {
          const userPulse = L.circleMarker([latitude, longitude], {
            radius: 10,
            color: '#2563eb',
            fillColor: '#60a5fa',
            fillOpacity: 0.9,
            weight: 3,
          }).bindPopup('<strong>📍 You Are Here</strong>')
          userPulse.addTo(map)
          userMarkerRef.current = userPulse
        }
      },
      (err) => {
        setLocating(false)
        alert('Could not obtain your location. Please ensure location permissions are allowed in your browser.')
      },
      { enableHighAccuracy: true, timeout: 8000 }
    )
  }

  const handleResetView = () => {
    if (mapInstanceRef.current) {
      mapInstanceRef.current.setView([25.0, 10.0], 2.2)
    }
  }

  const availableCount = areas.filter((a) => a.status === 'available').length
  const plannedCount = areas.filter((a) => a.status !== 'available').length

  return (
    <div className="relative w-full rounded-2xl overflow-hidden border shadow-lg bg-card">
      {/* Top Map Action Toolbar */}
      <div className="p-3 bg-card/90 backdrop-blur-md border-b flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-primary" />
          <span className="font-bold text-foreground">Global Optical Backbone</span>
          <span className="text-muted-foreground">({areas.length} POP nodes plotted)</span>
        </div>

        <div className="flex items-center gap-2">
          {/* Status filter buttons */}
          <div className="flex items-center rounded-lg border bg-muted/40 p-0.5">
            <Button
              size="sm"
              variant={activeFilter === 'all' ? 'default' : 'ghost'}
              onClick={() => setActiveFilter('all')}
              className="h-7 text-xs px-2.5"
            >
              All ({areas.length})
            </Button>
            <Button
              size="sm"
              variant={activeFilter === 'available' ? 'default' : 'ghost'}
              onClick={() => setActiveFilter('available')}
              className="h-7 text-xs px-2.5 text-emerald-600 dark:text-emerald-400 font-semibold"
            >
              Active ({availableCount})
            </Button>
            <Button
              size="sm"
              variant={activeFilter === 'planned' ? 'default' : 'ghost'}
              onClick={() => setActiveFilter('planned')}
              className="h-7 text-xs px-2.5 text-amber-600 dark:text-amber-400"
            >
              Planned ({plannedCount})
            </Button>
          </div>

          <Button
            size="sm"
            variant="outline"
            onClick={handleLocateMe}
            disabled={locating}
            className="h-7 text-xs gap-1.5"
            title="Auto-center on my location"
          >
            <Navigation className={`h-3.5 w-3.5 ${locating ? 'animate-spin text-primary' : ''}`} />
            <span>{locating ? 'Locating…' : 'Locate Me'}</span>
          </Button>

          <Button
            size="sm"
            variant="outline"
            onClick={handleResetView}
            className="h-7 text-xs gap-1"
            title="Reset world view"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>Reset</span>
          </Button>
        </div>
      </div>

      {/* Main Map Canvas - explicit responsive height (550px) */}
      <div className="relative w-full h-[550px] min-h-[500px] bg-slate-100 dark:bg-slate-900">
        <div ref={mapContainerRef} className="w-full h-full z-0" tabIndex={0} aria-label="Interactive world coverage map" />

        {/* Loading Overlay */}
        {loading && (
          <div className="absolute inset-0 z-10 bg-background/60 backdrop-blur-xs flex items-center justify-center">
            <div className="flex items-center gap-2 rounded-xl bg-card border px-4 py-2.5 shadow-lg text-xs font-semibold">
              <RefreshCw className="h-4 w-4 animate-spin text-primary" />
              <span>Updating live coverage nodes…</span>
            </div>
          </div>
        )}

        {/* Tile Error Fallback Notice */}
        {tileError && (
          <div className="absolute top-4 right-4 z-20 max-w-sm p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-900 dark:text-amber-200 text-xs backdrop-blur-md shadow-md flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold">Offline Tile Cache Active</p>
              <p className="text-[11px] opacity-90 mt-0.5">
                Some map tile images could not be downloaded. Network node markers remain live and clickable.
              </p>
            </div>
          </div>
        )}

        {/* Bottom Legend */}
        <div className="absolute bottom-4 left-4 z-10 rounded-xl border bg-card/95 backdrop-blur-md p-3 text-xs shadow-md space-y-1.5 pointer-events-auto">
          <p className="font-bold text-[11px] uppercase tracking-wider text-muted-foreground">Legend</p>
          <div className="flex items-center gap-2">
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
            </span>
            <span className="font-semibold text-foreground">Operational Fiber POP ({availableCount})</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-block h-3 w-3 rounded-full bg-amber-500" />
            <span className="text-muted-foreground">Expansion Route In Progress ({plannedCount})</span>
          </div>
        </div>
      </div>
    </div>
  )
}

