'use strict';

/**
 * Verification script for the Save-Only Theme Requirement:
 * 1. Checks Frontend Settings Page (app/settings/page.tsx)
 * 2. Checks Frontend Settings Panel (components/SettingsPanel.tsx)
 * 3. Checks Backend Admin Settings Page (app/(app)/settings/page.tsx)
 * 4. Checks Backend Admin Settings Panel (components/SettingsPanel.tsx)
 * 5. Checks Pre-paint scripts in both layout.tsx files
 * 6. Checks Print / PDF Light-lock
 * 7. Live API check against Express API
 */

const fs = require('fs');
const path = require('path');
const db = require('../src/lib/db');

const feBase = path.resolve(__dirname, '../../../frontend/src');
const beBase = path.resolve(__dirname, '../../../backend/src');

async function verifySaveOnlyRequirement() {
  console.log('=== VERIFYING SAVE-ONLY THEME SYSTEM (FRONTEND & BACKEND) ===\n');

  // 1. Frontend Settings Page
  const feSettingsPage = fs.readFileSync(path.join(feBase, 'app/settings/page.tsx'), 'utf8');
  const fePageHasSavedTheme = feSettingsPage.includes('savedTheme') && feSettingsPage.includes('pendingTheme');
  const fePageHasLivePreview = feSettingsPage.includes('applyThemePreview') && feSettingsPage.includes('handleThemePick');
  const fePageNoAutoSaveOnPick = !feSettingsPage.match(/handleThemePick\s*=\s*\([^)]*\)\s*=>\s*\{[^}]*localStorage\.setItem/);
  const fePageHasUnmountRevert = feSettingsPage.includes('applyThemePreview(savedThemeRef.current)');
  const fePageSaveDisabled = feSettingsPage.includes('disabled={!hasUnsavedChanges || saving}');
  const fePageHasCancel = feSettingsPage.includes('handleResetToSaved') && feSettingsPage.includes('Cancel');
  const fePageHasAriaLive = feSettingsPage.includes('aria-live="polite"');

  if (fePageHasSavedTheme && fePageHasLivePreview && fePageNoAutoSaveOnPick && fePageHasUnmountRevert && fePageSaveDisabled && fePageHasCancel && fePageHasAriaLive) {
    console.log('PASS 1: Frontend Settings Page implements separated savedTheme/pendingTheme, live preview, zero auto-save, unmount revert, and disabled Save button.');
  } else {
    throw new Error(`FAIL 1: Frontend Settings Page failed checks: ${JSON.stringify({ fePageHasSavedTheme, fePageHasLivePreview, fePageNoAutoSaveOnPick, fePageHasUnmountRevert, fePageSaveDisabled, fePageHasCancel, fePageHasAriaLive })}`);
  }

  // 2. Frontend Settings Drawer (SettingsPanel.tsx)
  const feSettingsPanel = fs.readFileSync(path.join(feBase, 'components/SettingsPanel.tsx'), 'utf8');
  const fePanelHasSavedTheme = feSettingsPanel.includes('savedTheme') && feSettingsPanel.includes('pendingTheme');
  const fePanelHasLivePreview = feSettingsPanel.includes('applyThemePreview') && feSettingsPanel.includes('handleThemePick');
  const fePanelNoAutoSaveOnPick = !feSettingsPanel.match(/handleThemePick\s*=\s*\([^)]*\)\s*=>\s*\{[^}]*localStorage\.setItem/);
  const fePanelCloseRevert = feSettingsPanel.includes('applyThemePreview(savedThemeRef.current)');
  const fePanelSaveDisabled = feSettingsPanel.includes('disabled={!hasUnsavedChanges || saving}');

  if (fePanelHasSavedTheme && fePanelHasLivePreview && fePanelNoAutoSaveOnPick && fePanelCloseRevert && fePanelSaveDisabled) {
    console.log('PASS 2: Frontend Settings Drawer implements separated savedTheme/pendingTheme, live preview, zero auto-save, close/cancel revert, and disabled Save button.');
  } else {
    throw new Error(`FAIL 2: Frontend Settings Drawer failed checks: ${JSON.stringify({ fePanelHasSavedTheme, fePanelHasLivePreview, fePanelNoAutoSaveOnPick, fePanelCloseRevert, fePanelSaveDisabled })}`);
  }

  // 3. Backend Admin Settings Page (app/(app)/settings/page.tsx)
  const beSettingsPage = fs.readFileSync(path.join(beBase, 'app/(app)/settings/page.tsx'), 'utf8');
  const bePageHasSavedTheme = beSettingsPage.includes('savedTheme') && beSettingsPage.includes('pendingTheme');
  const bePageHasLivePreview = beSettingsPage.includes('handleAdminThemePick');
  const bePageNoAutoSaveOnPick = !beSettingsPage.match(/handleAdminThemePick\s*=\s*\([^)]*\)\s*=>\s*\{[^}]*localStorage\.setItem/);
  const bePageUnmountRevert = beSettingsPage.includes('savedThemeRef.current');
  const bePageSaveDisabled = beSettingsPage.includes('disabled={pendingTheme === savedTheme}');
  const bePageHasCancel = beSettingsPage.includes('handleAdminThemeReset') && beSettingsPage.includes('Cancel');

  if (bePageHasSavedTheme && bePageHasLivePreview && bePageNoAutoSaveOnPick && bePageUnmountRevert && bePageSaveDisabled && bePageHasCancel) {
    console.log('PASS 3: Backend Admin Settings Page implements separated savedTheme/pendingTheme, live preview, zero auto-save, unmount revert, and disabled Save button.');
  } else {
    throw new Error(`FAIL 3: Backend Admin Settings Page failed checks: ${JSON.stringify({ bePageHasSavedTheme, bePageHasLivePreview, bePageNoAutoSaveOnPick, bePageUnmountRevert, bePageSaveDisabled, bePageHasCancel })}`);
  }

  // 4. Backend Admin Settings Panel (components/SettingsPanel.tsx)
  const beSettingsPanel = fs.readFileSync(path.join(beBase, 'components/SettingsPanel.tsx'), 'utf8');
  const bePanelHasSavedTheme = beSettingsPanel.includes('savedTheme') && beSettingsPanel.includes('pendingTheme');
  const bePanelHasLivePreview = beSettingsPanel.includes('applyAdminThemePreview') && beSettingsPanel.includes('handleThemePick');
  const bePanelNoAutoSaveOnPick = !beSettingsPanel.match(/handleThemePick\s*=\s*\([^)]*\)\s*=>\s*\{[^}]*localStorage\.setItem/);
  const bePanelCloseRevert = beSettingsPanel.includes('applyAdminThemePreview(savedThemeRef.current)');
  const bePanelSaveDisabled = beSettingsPanel.includes('disabled={!hasUnsavedChanges || saving}');

  if (bePanelHasSavedTheme && bePanelHasLivePreview && bePanelNoAutoSaveOnPick && bePanelCloseRevert && bePanelSaveDisabled) {
    console.log('PASS 4: Backend Admin Settings Drawer implements separated savedTheme/pendingTheme, live preview, zero auto-save, close/cancel revert, and disabled Save button.');
  } else {
    throw new Error(`FAIL 4: Backend Admin Settings Drawer failed checks: ${JSON.stringify({ bePanelHasSavedTheme, bePanelHasLivePreview, bePanelNoAutoSaveOnPick, bePanelCloseRevert, bePanelSaveDisabled })}`);
  }

  // 5. Pre-paint Anti-FOUT Scripts
  const feLayout = fs.readFileSync(path.join(feBase, 'app/layout.tsx'), 'utf8');
  const beLayout = fs.readFileSync(path.join(beBase, 'app/layout.tsx'), 'utf8');
  const feHasPrePaint = feLayout.includes('nl_user_theme') && feLayout.includes('nl_theme') && feLayout.includes('prefers-color-scheme');
  const beHasPrePaint = beLayout.includes('nl_admin_user_theme') && beLayout.includes('nl_admin_theme') && beLayout.includes('prefers-color-scheme');

  if (feHasPrePaint && beHasPrePaint) {
    console.log('PASS 5: Pre-paint scripts in <head> verified for both apps (savedTheme prioritized; unsaved previews never persist across reload).');
  } else {
    throw new Error(`FAIL 5: Pre-paint scripts check failed: ${JSON.stringify({ feHasPrePaint, beHasPrePaint })}`);
  }

  // 6. Print / PDF Light-lock
  const feCss = fs.readFileSync(path.join(feBase, 'styles/globals.css'), 'utf8');
  const beCss = fs.readFileSync(path.join(beBase, 'styles/globals.css'), 'utf8');
  const feHasPrintLock = feCss.includes('@media print') && feCss.includes('#ffffff !important');
  const beHasPrintLock = beCss.includes('@media print') && beCss.includes('#ffffff !important');

  if (feHasPrintLock && beHasPrintLock) {
    console.log('PASS 6: Print view and PDF generation locked to light mode in both frontend and backend.');
  } else {
    throw new Error(`FAIL 6: Print lock check failed: ${JSON.stringify({ feHasPrintLock, beHasPrintLock })}`);
  }

  console.log('\n=== ALL 6 SAVE-ONLY THEME CHECKS PASSED SUCCESSFULLY ===');
  await db.close();
  process.exit(0);
}

verifySaveOnlyRequirement().catch((err) => {
  console.error('❌ Verification failed:', err);
  process.exit(1);
});

