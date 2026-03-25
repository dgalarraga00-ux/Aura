import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { getRedisClient, tenantActiveKey } from '@/lib/redis/client';

/**
 * POST /api/admin/tenants/[id]/toggle
 *
 * Activa o suspende un tenant invirtiendo su `is_active` actual.
 *
 * Seguridad:
 * - Verifica que el caller tiene rol `saas_admin` (session cookie via anon client).
 * - Usa service role client para la mutacion (bypassea RLS).
 *
 * Efecto secundario critico:
 * - Al suspender (is_active = false): invalida la cache Redis `tenant:active:{tenantId}`
 *   seteando '0' con TTL 60s para que el circuit breaker del webhook actue de inmediato.
 * - Al activar (is_active = true): setea '1' para primar el cache.
 *
 * Retorna: { success: true, is_active: boolean }
 * Redirige a /admin/tenants si viene de un form submit HTML (Accept: text/html).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id: tenantId } = await params;

  // ── 1. Verificar autenticacion y rol ──────────────────────────────────────────
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: userDataRaw } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single();
  const userData = userDataRaw as { role: string } | null;

  if (userData?.role !== 'saas_admin') {
    return NextResponse.json({ error: 'Forbidden — saas_admin required' }, { status: 403 });
  }

  // ── 2. Fetch estado actual del tenant ─────────────────────────────────────────
  const service = createServiceClient();

  const { data: tenant, error: fetchError } = await service
    .from('tenants')
    .select('id, is_active, waba_id')
    .eq('id', tenantId)
    .single();

  if (fetchError || !tenant) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
  }

  const newIsActive = !tenant.is_active;

  // ── 3. Actualizar en base de datos ────────────────────────────────────────────
  const { error: updateError } = await service
    .from('tenants')
    .update({ is_active: newIsActive })
    .eq('id', tenantId);

  if (updateError) {
    console.error('[admin/toggle] DB update failed:', updateError);
    return NextResponse.json({ error: 'Failed to update tenant' }, { status: 500 });
  }

  // ── 4. Invalidar / actualizar cache Redis (CRITICO) ───────────────────────────
  // El webhook usa tenantActiveKey(tenantId) para el circuit breaker.
  // Si no se invalida aqui, el tenant suspendido sigue procesando mensajes
  // hasta que expire el TTL natural de 60 segundos.
  try {
    const redis = getRedisClient();
    await redis.set(tenantActiveKey(tenantId), newIsActive ? '1' : '0', { ex: 60 });
    console.info(
      `[admin/toggle] Redis cache updated: ${tenantActiveKey(tenantId)} = ${newIsActive ? '1' : '0'}`
    );
  } catch (redisErr) {
    // No hacer rollback del DB update — el cache expirara solo en 60s.
    // Loguear como error critico para alertas.
    console.error('[admin/toggle] CRITICAL: Redis cache update failed:', redisErr);
  }

  console.info(
    `[admin/toggle] Tenant ${tenantId} toggled to is_active=${newIsActive} by user=${user.id}`
  );

  // ── 5. Respuesta ──────────────────────────────────────────────────────────────
  // Si viene de un form HTML (navegacion directa), redirigir de vuelta.
  const acceptHeader = req.headers.get('accept') ?? '';
  const isHtmlRequest = acceptHeader.includes('text/html');

  if (isHtmlRequest) {
    // Redirigir a la pagina del tenant si vino del detalle, o a la lista
    const referer = req.headers.get('referer') ?? '/admin/tenants';
    return NextResponse.redirect(new URL(referer, req.url), { status: 303 });
  }

  return NextResponse.json({ success: true, is_active: newIsActive }, { status: 200 });
}
