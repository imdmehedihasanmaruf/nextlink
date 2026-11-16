<?php

use Illuminate\Support\Facades\Schedule;

// Monthly recurring billing cycle: 1st of every month at 02:00 UTC
Schedule::command('billing:cycle')->monthlyOn(1, '02:00');

// Daily auto-suspension sweep: every day at 03:00 UTC
Schedule::command('billing:suspend-overdue')->dailyAt('03:00');

// Webhook retry processor: runs every 10 minutes
Schedule::command('webhooks:retry --limit=50')->everyTenMinutes();

// MikroTik state reconciliation sweep: runs daily at 04:00 UTC
Schedule::command('mikrotik:sync')->dailyAt('04:00');
