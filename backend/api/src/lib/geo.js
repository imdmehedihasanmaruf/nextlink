'use strict';

/**
 * Real IP Geolocation and Session Timestamp Helper.
 * Handles X-Forwarded-For, X-Real-IP, Cloudflare headers.
 * Never invents mock or dummy data: falls back cleanly to 'Unknown'.
 */

const geoCache = new Map();

function extractClientIp(req) {
  if (!req) return '127.0.0.1';
  const headers = req.headers || {};
  const xff = headers['x-forwarded-for'] || (typeof req.get === 'function' ? req.get('x-forwarded-for') : null);
  if (typeof xff === 'string' && xff.trim()) {
    const first = xff.split(',')[0].trim();
    if (first) return first.replace(/^::ffff:/i, '');
  }
  const xReal =
    headers['x-real-ip'] ||
    headers['cf-connecting-ip'] ||
    (typeof req.get === 'function' ? req.get('x-real-ip') || req.get('cf-connecting-ip') : null);
  if (typeof xReal === 'string' && xReal.trim()) {
    return xReal.trim().replace(/^::ffff:/i, '');
  }
  const rawIp = req.ip || req.socket?.remoteAddress || '127.0.0.1';
  const cleaned = String(rawIp).replace(/^::ffff:/i, '');
  return cleaned === '::1' ? '127.0.0.1' : cleaned;
}

function isPrivateOrLoopbackIp(ip) {
  if (!ip) return true;
  if (ip === '127.0.0.1' || ip === '::1' || ip === 'localhost') return true;
  if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip)) return true;
  return false;
}

async function resolveGeoLocation(ip) {
  const cacheKey = ip || 'self';
  const cached = geoCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  const result = {
    ip: ip || '127.0.0.1',
    city: 'Unknown',
    postalCode: 'Unknown',
    state: 'Unknown',
    country: 'Unknown',
    isp: 'Unknown',
    success: false,
  };

  try {
    const targetUrl = isPrivateOrLoopbackIp(ip)
      ? 'https://ipwho.is/'
      : `https://ipwho.is/${encodeURIComponent(ip)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(targetUrl, { signal: controller.signal, headers: { Accept: 'application/json' } });
    clearTimeout(timer);
    if (res.ok) {
      const data = await res.json();
      if (data && data.success !== false) {
        result.city = data.city || 'Unknown';
        result.postalCode = data.postal || 'Unknown';
        result.state = data.region || data.region_code || 'Unknown';
        result.country = data.country || 'Unknown';
        result.isp = data.connection?.isp || data.isp || 'Unknown';
        if (isPrivateOrLoopbackIp(ip) && data.ip) {
          result.ip = `${ip} (${data.ip})`;
        }
        result.success = true;
      }
    }
  } catch {
    // Graceful fallback to 'Unknown', never fake data
  }

  // If ipwho.is fails, secondary attempt with ip-api.com
  if (!result.success) {
    try {
      const apiUrl = isPrivateOrLoopbackIp(ip)
        ? 'http://ip-api.com/json/'
        : `http://ip-api.com/json/${encodeURIComponent(ip)}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2000);
      const res = await fetch(apiUrl, { signal: controller.signal });
      clearTimeout(timer);
      if (res.ok) {
        const data = await res.json();
        if (data && data.status === 'success') {
          result.city = data.city || 'Unknown';
          result.postalCode = data.zip || 'Unknown';
          result.state = data.regionName || 'Unknown';
          result.country = data.country || 'Unknown';
          result.isp = data.isp || 'Unknown';
          result.success = true;
        }
      }
    } catch {
      // Keep 'Unknown'
    }
  }

  result.formattedCityPostal = `${result.city}, ${result.postalCode}`;
  result.formattedStateCountry = `${result.state}, ${result.country}`;

  geoCache.set(cacheKey, { data: result, expiresAt: Date.now() + 10 * 60 * 1000 });
  return result;
}

/**
 * Format date in DD/MM/YYYY (e.g. 12/11/2026)
 */
function formatDateDDMMYYYY(dateInput, timeZone) {
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput || Date.now());
  if (Number.isNaN(d.getTime())) return 'Unknown';
  if (timeZone) {
    try {
      const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone,
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      }).formatToParts(d);
      const day = parts.find((p) => p.type === 'day')?.value;
      const month = parts.find((p) => p.type === 'month')?.value;
      const year = parts.find((p) => p.type === 'year')?.value;
      return `${day}/${month}/${year}`;
    } catch {
      // fallback to local
    }
  }
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

/**
 * Format time in hh:mmAM/PM (e.g. 07:15PM)
 */
function formatTimeHHMMAMPM(dateInput, timeZone) {
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput || Date.now());
  if (Number.isNaN(d.getTime())) return 'Unknown';
  if (timeZone) {
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      }).formatToParts(d);
      const hour = parts.find((p) => p.type === 'hour')?.value || '12';
      const minute = parts.find((p) => p.type === 'minute')?.value || '00';
      const dayPeriod = (parts.find((p) => p.type === 'dayPeriod')?.value || 'AM').toUpperCase();
      return `${hour}:${minute}${dayPeriod}`;
    } catch {
      // fallback to local
    }
  }
  let hours = d.getHours();
  const mins = String(d.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  if (hours === 0) hours = 12;
  const hh = String(hours).padStart(2, '0');
  return `${hh}:${mins}${ampm}`;
}

/**
 * Construct authoritative session info snapshot.
 */
async function captureSessionInfo(req, clientProvided = {}) {
  const clientIp = extractClientIp(req);
  let geo = null;

  // Use client-provided geolocation if valid (not empty/unknown), else resolve server-side
  const hasClientGeo =
    clientProvided &&
    clientProvided.city &&
    clientProvided.city !== 'Unknown' &&
    clientProvided.country &&
    clientProvided.country !== 'Unknown';

  if (hasClientGeo) {
    geo = {
      ip: clientProvided.clientIp || clientIp,
      city: clientProvided.city,
      postalCode: clientProvided.postalCode || 'Unknown',
      state: clientProvided.state || 'Unknown',
      country: clientProvided.country,
    };
  } else {
    geo = await resolveGeoLocation(clientIp);
  }

  const now = new Date();
  const dateStr = clientProvided.date || clientProvided.purchaseDate || clientProvided.cancelDate || formatDateDDMMYYYY(now);
  const timeStr = clientProvided.time || clientProvided.purchaseTime || clientProvided.cancelTime || formatTimeHHMMAMPM(now);

  const city = geo.city || clientProvided.city || 'Unknown';
  const postalCode = geo.postalCode || clientProvided.postalCode || 'Unknown';
  const state = geo.state || clientProvided.state || 'Unknown';
  const country = geo.country || clientProvided.country || 'Unknown';

  return {
    date: dateStr,
    time: timeStr,
    city,
    postalCode,
    state,
    country,
    clientIp,
    formattedCityPostal: `${city}, ${postalCode}`,
    formattedStateCountry: `${state}, ${country}`,
    timezone: clientProvided.timezone || 'UTC',
    capturedAtUtc: now.toISOString(),
  };
}

module.exports = {
  extractClientIp,
  isPrivateOrLoopbackIp,
  resolveGeoLocation,
  formatDateDDMMYYYY,
  formatTimeHHMMAMPM,
  captureSessionInfo,
};
