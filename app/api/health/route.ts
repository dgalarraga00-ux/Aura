import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';

/**
 * GET /api/health
 *
 * Health check endpoint for Vercel monitoring and uptime probes.
 * Does NOT require authentication.
 *
 * Performs a minimal Supabase connectivity check (count tenants).
 * Returns:
 *   200 { status: 'ok', timestamp, version }          — healthy
 *   503 { status: 'degraded', error, timestamp }      — Supabase unreachable
 */
export async function GET(): Promise<NextResponse> {
  const timestamp = new Date().toISOString();
  const version = process.env.npm_package_version ?? '0.1.0';

  try {
    const supabase = createServiceClient();
    // Minimal ping: count query against tenants — returns immediately
    const { error } = await supabase
      .from('tenants')
      .select('id', { count: 'exact', head: true });

    if (error) {
      return NextResponse.json(
        { status: 'degraded', error: 'Database connectivity check failed', timestamp },
        { status: 503 }
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { status: 'degraded', error: message, timestamp },
      { status: 503 }
    );
  }

  return NextResponse.json({ status: 'ok', timestamp, version }, { status: 200 });
}
