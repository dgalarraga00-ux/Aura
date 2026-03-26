import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { getRedisClient, tenantActiveKey } from '@/lib/redis/client';

/**
 * Resolve tenant from phone_number_id (Redis cache → DB fallback).
 * Also enforces the is_active circuit breaker.
 * Returns tenantId string, or NextResponse to short-circuit.
 */
export async function resolveTenantId(
  phone_number_id: string,
  redis: ReturnType<typeof getRedisClient>,
  supabase: ReturnType<typeof createServiceClient>
): Promise<string | NextResponse> {
  const tenantCacheKey = `tenant:phone:${phone_number_id}`;
  const cachedTenantId = await redis.get<string>(tenantCacheKey);
  let tenantId: string;

  if (cachedTenantId) {
    tenantId = cachedTenantId;
  } else {
    const { data: tenant, error } = await supabase
      .from('tenants')
      .select('id, is_active')
      .eq('phone_number_id', phone_number_id)
      .single();
    if (error || !tenant) {
      console.warn(`[webhook][POST] No tenant for phone_number_id=${phone_number_id}`);
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }
    tenantId = tenant.id;
    await redis.set(tenantCacheKey, tenantId, { ex: 300 }); // Cache phone → tenant (5 min)
    await redis.set(tenantActiveKey(tenantId), tenant.is_active ? '1' : '0', { ex: 60 }); // Prime circuit breaker
  }

  // Circuit Breaker: is_active
  let isActiveRaw = await redis.get<string>(tenantActiveKey(tenantId));
  if (isActiveRaw === null) {
    const { data: tenant } = await supabase
      .from('tenants')
      .select('is_active')
      .eq('id', tenantId)
      .single();
    isActiveRaw = (tenant?.is_active ?? false) ? '1' : '0';
    await redis.set(tenantActiveKey(tenantId), isActiveRaw, { ex: 60 });
  }

  if (String(isActiveRaw) !== '1') {
    console.info(`[webhook][POST] Tenant ${tenantId} inactive — dropping silently`);
    return NextResponse.json({ status: 'ok' }, { status: 200 }); // 200 so Meta does NOT retry
  }

  return tenantId;
}
