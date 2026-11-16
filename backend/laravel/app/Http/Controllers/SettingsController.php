<?php

namespace App\Http\Controllers;

use App\Services\SettingsService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class SettingsController
{
    protected SettingsService $settingsService;

    public function __construct(SettingsService $settingsService)
    {
        $this->settingsService = $settingsService;
    }

    /**
     * GET /api/settings
     * Root settings endpoint: returns masked system settings for staff.
     */
    public function index(): JsonResponse
    {
        $masked = $this->settingsService->getMasked();
        return response()->json([
            'success' => true,
            'settings' => $masked,
        ]);
    }

    /**
     * GET /api/settings/public
     * Unauthenticated public fees & settings.
     */
    public function public(): JsonResponse
    {
        $public = $this->settingsService->getPublic();
        return response()->json($public);
    }

    /**
     * GET /api/settings/system
     * Masked system settings for super_admin and billing roles.
     */
    public function system(): JsonResponse
    {
        $masked = $this->settingsService->getMasked();
        return response()->json([
            'success' => true,
            'settings' => $masked,
        ]);
    }

    /**
     * PUT /api/settings/system/{group}
     * Persist one group of settings.
     */
    public function updateGroup(string $group, Request $request): JsonResponse
    {
        $payload = $request->all();
        $updated = $this->settingsService->setGroup($group, $payload);

        return response()->json([
            'success' => true,
            'group' => $group,
            'settings' => $updated,
        ]);
    }

    /**
     * PATCH /api/settings/system
     * Update settings groups via PATCH.
     */
    public function updateSystem(Request $request): JsonResponse
    {
        $payload = $request->all();

        // If payload has 'group' and 'value'
        if (isset($payload['group']) && is_string($payload['group'])) {
            $val = is_array($payload['value'] ?? null) ? $payload['value'] : [];
            $updated = $this->settingsService->setGroup($payload['group'], $val);
            return response()->json([
                'success' => true,
                'group' => $payload['group'],
                'settings' => $updated,
            ]);
        }

        // If multiple groups provided
        foreach ($payload as $grp => $val) {
            if (is_array($val)) {
                $this->settingsService->setGroup($grp, $val);
            }
        }

        $masked = $this->settingsService->getMasked();
        return response()->json([
            'success' => true,
            'settings' => $masked,
        ]);
    }
}
