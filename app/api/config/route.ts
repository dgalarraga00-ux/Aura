import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { z } from 'zod';

const BotConfigSchema = z.object({
  system_prompt: z.string().max(8000),
  handoff_keywords: z.array(z.string().max(100)).max(50),
  rag_score_threshold: z.number().min(0.1).max(0.99).optional().default(0.75),
  language: z.string().max(10),
  max_tokens: z.number().int().min(50).max(2000).optional().default(500),
});

const UpdateConfigSchema = z.object({
  bot_config: BotConfigSchema,
});

/**
 * GET /api/config
 * Returns the bot_config for the authenticated user's tenant.
 */
export async function GET(): Promise<NextResponse> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: userDataRaw } = await supabase
    .from('users')
    .select('role, tenant_id')
    .eq('id', user.id)
    .single();

  const userData = userDataRaw as { role: string; tenant_id: string | null } | null;

  if (!userData || !userData.tenant_id) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
  }

  const { data: rawTenant, error } = await supabase
    .from('tenants')
    .select('id, name, bot_config')
    .eq('id', userData.tenant_id)
    .single();

  const tenant = rawTenant as { id: string; name: string; bot_config: unknown } | null;

  if (error || !tenant) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
  }

  return NextResponse.json({ bot_config: tenant.bot_config });
}

/**
 * POST /api/config
 * Updates the bot_config for the authenticated user's tenant.
 * Only accessible by tenant_admin or saas_admin.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: userDataRaw2 } = await supabase
    .from('users')
    .select('role, tenant_id')
    .eq('id', user.id)
    .single();

  const userData = userDataRaw2 as { role: string; tenant_id: string | null } | null;

  if (!userData) {
    return NextResponse.json({ error: 'User not found' }, { status: 403 });
  }

  // Only admins can update config
  if (userData.role === 'tenant_operator') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  if (!userData.tenant_id && userData.role !== 'saas_admin') {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
  }

  // Parse and validate request body
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = UpdateConfigSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 422 }
    );
  }

  const serviceClient = createServiceClient();

  const { error: updateError } = await serviceClient
    .from('tenants')
    .update({ bot_config: parsed.data.bot_config })
    .eq('id', userData.tenant_id!);

  if (updateError) {
    console.error('[config][POST] Update failed:', updateError.message);
    return NextResponse.json({ error: 'Failed to update configuration' }, { status: 500 });
  }

  console.info(`[config][POST] Updated bot_config for tenantId=${userData.tenant_id} by userId=${user.id}`);

  return NextResponse.json({ success: true });
}
