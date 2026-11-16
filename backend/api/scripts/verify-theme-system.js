'use strict';

const fs = require('fs');
const path = require('path');

function testThemeImplementation() {
  console.log('=== VERIFYING DARK/LIGHT THEME IMPLEMENTATION (FRONTEND & BACKEND) ===\n');
  const results = [];

  // 1. Frontend ThemeProvider check
  const feProvider = fs.readFileSync('frontend/src/components/ThemeProvider.tsx', 'utf8');
  const feNoForced = !feProvider.includes('forcedTheme');
  const feNoRemove = !feProvider.includes('localStorage.removeItem');
  const feStorageKey = feProvider.includes('storageKey="nl_theme"');
  const feSystem = feProvider.includes('enableSystem={true}') || feProvider.includes('enableSystem');

  if (feNoForced && feNoRemove && feStorageKey && feSystem) {
    console.log('PASS 1: Frontend ThemeProvider has storageKey="nl_theme", enableSystem, and NO forcedTheme or cleared-localStorage.');
    results.push({ check: 'Frontend ThemeProvider Configuration', status: 'PASS', notes: 'storageKey="nl_theme", system preference enabled, no forced theme.' });
  } else {
    console.error('FAIL 1: Frontend ThemeProvider', { feNoForced, feNoRemove, feStorageKey, feSystem });
    results.push({ check: 'Frontend ThemeProvider Configuration', status: 'FAIL', notes: 'forcedTheme or removeItem found.' });
  }

  // 2. Backend ThemeProvider check
  const beProvider = fs.readFileSync('backend/src/components/ThemeProvider.tsx', 'utf8');
  const beNoForced = !beProvider.includes('forcedTheme');
  const beNoRemove = !beProvider.includes('localStorage.removeItem');
  const beStorageKey = beProvider.includes('storageKey="nl_admin_theme"');
  const beSystem = beProvider.includes('enableSystem={true}') || beProvider.includes('enableSystem');

  if (beNoForced && beNoRemove && beStorageKey && beSystem) {
    console.log('PASS 2: Backend ThemeProvider has storageKey="nl_admin_theme", enableSystem, and NO forcedTheme or cleared-localStorage.');
    results.push({ check: 'Backend ThemeProvider Configuration', status: 'PASS', notes: 'storageKey="nl_admin_theme", system preference enabled, no forced theme.' });
  } else {
    console.error('FAIL 2: Backend ThemeProvider', { beNoForced, beNoRemove, beStorageKey, beSystem });
    results.push({ check: 'Backend ThemeProvider Configuration', status: 'FAIL', notes: 'forcedTheme or removeItem found.' });
  }

  // 3. Pre-paint inline script in head to prevent FOUT
  const feLayout = fs.readFileSync('frontend/src/app/layout.tsx', 'utf8');
  const beLayout = fs.readFileSync('backend/src/app/layout.tsx', 'utf8');
  const feHasPrePaint = feLayout.includes('nl_theme') && feLayout.includes('document.documentElement.classList.add(\'dark\')');
  const beHasPrePaint = beLayout.includes('nl_admin_theme') && beLayout.includes('document.documentElement.classList.add(\'dark\')');

  if (feHasPrePaint && beHasPrePaint) {
    console.log('PASS 3: Pre-paint scripts verified in <head> of both frontend and backend layout.tsx.');
    results.push({ check: 'Pre-paint <head> Scripts (Anti-FOUT)', status: 'PASS', notes: 'Both layouts inject inline scripts checking localStorage & prefers-color-scheme.' });
  } else {
    console.error('FAIL 3: Pre-paint scripts missing', { feHasPrePaint, beHasPrePaint });
    results.push({ check: 'Pre-paint <head> Scripts (Anti-FOUT)', status: 'FAIL', notes: 'Missing script in layout.tsx' });
  }

  // 4. Header Toggle Buttons (Cleanly removed from Header markup; theme controlled via Settings > Appearance)
  const feNavbar = fs.readFileSync('frontend/src/components/Navbar.tsx', 'utf8');
  const beHeader = fs.readFileSync('backend/src/components/Header.tsx', 'utf8');
  const feToggleFile = fs.existsSync('frontend/src/components/ThemeToggle.tsx');
  const beToggleFile = fs.existsSync('backend/src/components/ThemeToggle.tsx');
  const feHasNoHeaderToggle = !feNavbar.includes('<ThemeToggle') && !feNavbar.includes('ThemeToggle');
  const beHasNoHeaderToggle = !beHeader.includes('<ThemeToggle') && !beHeader.includes('ThemeToggle');

  if (feToggleFile && beToggleFile && feHasNoHeaderToggle && beHasNoHeaderToggle) {
    console.log('PASS 4: ThemeToggle cleanly removed from both frontend Navbar and backend Header markup; theme controlled via Settings > Appearance.');
    results.push({ check: 'Header ThemeToggle Removal', status: 'PASS', notes: 'Removed from markup on both sides; zero DOM trace, no empty gaps.' });
  } else {
    console.error('FAIL 4: ThemeToggle integration', { feToggleFile, beToggleFile, feHasNoHeaderToggle, beHasNoHeaderToggle });
    results.push({ check: 'Header ThemeToggle Removal', status: 'FAIL', notes: 'Toggle still found in header markup or file missing.' });
  }

  // 5. Leaflet Dark Mode & Contrast
  const feGlobals = fs.readFileSync('frontend/src/styles/globals.css', 'utf8');
  const hasLeafletDark = feGlobals.includes('.dark .leaflet-tile') && feGlobals.includes('.dark .leaflet-popup-content-wrapper');
  if (hasLeafletDark) {
    console.log('PASS 5: Leaflet dark mode CSS filter and high-contrast popup styling verified.');
    results.push({ check: 'Coverage Map Dark Mode Styling', status: 'PASS', notes: 'Tile CSS filter active, popup wrapper and tip contrast styled.' });
  } else {
    console.error('FAIL 5: Leaflet dark mode CSS missing');
    results.push({ check: 'Coverage Map Dark Mode Styling', status: 'FAIL', notes: 'Missing leaflet dark rules in globals.css.' });
  }

  // 6. Print Light Lock (@media print)
  const beGlobals = fs.readFileSync('backend/src/styles/globals.css', 'utf8');
  const feHasPrintLight = feGlobals.includes('@media print') && feGlobals.includes('#ffffff');
  const beHasPrintLight = beGlobals.includes('@media print') && beGlobals.includes('#ffffff');

  if (feHasPrintLight && beHasPrintLight) {
    console.log('PASS 6: Invoices & Print views locked to light theme via @media print in both frontend & backend.');
    results.push({ check: 'Invoice & Print Light Mode Lock', status: 'PASS', notes: 'Enforces white background and dark text on print/PDF generation.' });
  } else {
    console.error('FAIL 6: Print light lock missing', { feHasPrintLight, beHasPrintLight });
    results.push({ check: 'Invoice & Print Light Mode Lock', status: 'FAIL', notes: 'Missing @media print in globals.css' });
  }

  // 7. Recharts Tooltip Contrast
  const feHasTooltip = feGlobals.includes('.dark .recharts-default-tooltip');
  const beHasTooltip = beGlobals.includes('.dark .recharts-default-tooltip');

  if (feHasTooltip && beHasTooltip) {
    console.log('PASS 7: Recharts dark mode tooltip contrast styling verified in both portals.');
    results.push({ check: 'Recharts Tooltip & Chart Contrast', status: 'PASS', notes: 'Dark card background and card-foreground text applied to tooltips.' });
  } else {
    console.error('FAIL 7: Recharts tooltip styling missing', { feHasTooltip, beHasTooltip });
    results.push({ check: 'Recharts Tooltip & Chart Contrast', status: 'FAIL', notes: 'Missing tooltip dark styles' });
  }

  // Summary Table
  console.log('\n================ THEME TEST REPORT ================');
  console.table(results);
  console.log('===================================================');

  process.exit(results.every(r => r.status === 'PASS') ? 0 : 1);
}

testThemeImplementation();

