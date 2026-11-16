import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { authenticate, authError } from '@/lib/customerAuth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

export async function GET(request: Request) {
  const auth = await authenticate(request);
  if (!auth.ok || !auth.subscriber) {
    return authError(auth);
  }

  try {
    const pool = getDbPool();
    const subscriberId = auth.subscriber.id;

    // Check user_preferences table
    const prefRes = await pool.query(
      `SELECT theme, theme_color, font_size, language, auto_save, updated_at
         FROM user_preferences
        WHERE user_id = $1`,
      [subscriberId]
    );

    // Also check subscribers table
    const subRes = await pool.query(
      `SELECT theme, raw_data FROM subscribers WHERE id = $1`,
      [subscriberId]
    );

    const sub = subRes.rows[0];
    const subRaw = sub?.raw_data || {};
    const pref = prefRes.rows[0] || {};

    const theme = pref.theme || sub?.theme || subRaw.theme || 'system';
    const themeColor = pref.theme_color || subRaw.themeColor || 'blue';
    const fontSize = pref.font_size || subRaw.fontSize || 'md';
    const language = pref.language || subRaw.language || 'us';
    const autoSave =
      pref.auto_save !== undefined
        ? Boolean(pref.auto_save)
        : subRaw.autoSave !== undefined
        ? Boolean(subRaw.autoSave)
        : true;

    return NextResponse.json(
      {
        success: true,
        preferences: {
          userId: subscriberId,
          theme,
          themeColor,
          fontSize,
          language,
          autoSave,
        },
        theme,
      },
      { headers: corsHeaders }
    );
  } catch (err: any) {
    console.error('Error fetching subscriber preferences:', err);
    return NextResponse.json(
      { success: false, error: err.message || 'Failed to fetch preferences' },
      { status: 500, headers: corsHeaders }
    );
  }
}

export async function POST(request: Request) {
  return handleSave(request);
}

export async function PATCH(request: Request) {
  return handleSave(request);
}

async function handleSave(request: Request) {
  const auth = await authenticate(request);
  if (!auth.ok || !auth.subscriber) {
    return authError(auth);
  }

  try {
    const subscriberId = auth.subscriber.id;
    const body = await request.json().catch(() => ({}));
    const { theme, themeColor, fontSize, language, autoSave } = body;

    let validTheme: string | null = null;
    if (theme && ['light', 'dark', 'system'].includes(String(theme).toLowerCase())) {
      validTheme = String(theme).toLowerCase();
    }

    const pool = getDbPool();

    // 1. Update subscribers table if validTheme
    if (validTheme) {
      await pool.query(
        `UPDATE subscribers
            SET theme = $1::text,
                raw_data = jsonb_set(COALESCE(raw_data, '{}'::jsonb), '{theme}', to_jsonb($1::text), true),
                updated_at = NOW()
          WHERE id = $2::text`,
        [validTheme, subscriberId]
      );
    }

    // 2. Upsert into user_preferences table
    await pool.query(
      `INSERT INTO user_preferences (user_id, theme, theme_color, font_size, language, auto_save, updated_at)
       VALUES ($1::text, COALESCE($2::text, 'system'), COALESCE($3::text, 'blue'), COALESCE($4::text, 'md'), COALESCE($5::text, 'us'), COALESCE($6::boolean, true), NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         theme = COALESCE(EXCLUDED.theme, user_preferences.theme),
         theme_color = COALESCE(EXCLUDED.theme_color, user_preferences.theme_color),
         font_size = COALESCE(EXCLUDED.font_size, user_preferences.font_size),
         language = COALESCE(EXCLUDED.language, user_preferences.language),
         auto_save = COALESCE(EXCLUDED.auto_save, user_preferences.auto_save),
         updated_at = NOW()`,
      [
        subscriberId,
        validTheme || null,
        themeColor || null,
        fontSize || null,
        language || null,
        autoSave !== undefined ? Boolean(autoSave) : null,
      ]
    );

    // 3. Audit log
    try {
      await pool.query(
        `INSERT INTO audit_log (actor_id, actor_role, action, entity_type, entity_id, details, ip_address)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          subscriberId,
          'subscriber',
          'subscriber_preferences_updated',
          'subscriber',
          subscriberId,
          JSON.stringify({
            theme: validTheme,
            themeColor,
            fontSize,
            language,
            autoSave,
          }),
          request.headers.get('x-forwarded-for')?.split(',')[0].trim() || null,
        ]
      );
    } catch (auditErr: any) {
      console.warn('Audit log write failed for subscriber preferences:', auditErr?.message);
    }

    return NextResponse.json(
      {
        success: true,
        message: 'Preferences updated successfully',
        preferences: {
          userId: subscriberId,
          theme: validTheme || 'system',
          themeColor: themeColor || 'blue',
          fontSize: fontSize || 'md',
          language: language || 'us',
          autoSave: autoSave !== undefined ? Boolean(autoSave) : true,
        },
        theme: validTheme || 'system',
      },
      { headers: corsHeaders }
    );
  } catch (err: any) {
    console.error('Error saving subscriber preferences:', err);
    return NextResponse.json(
      { success: false, error: err.message || 'Failed to save preferences' },
      { status: 500, headers: corsHeaders }
    );
  }
}
