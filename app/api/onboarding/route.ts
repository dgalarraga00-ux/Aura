import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { storeSecret } from '@/lib/vault/secrets';

const onboardingSchema = z.object({
  company_name: z.string().min(1, 'Company name is required'),
  waba_id: z.string().min(1, 'WhatsApp Business Account ID is required'),
  phone_number_id: z.string().min(1, 'Phone Number ID is required'),
  access_token: z.string().min(1, 'Access token is required'),
  webhook_verify_token: z.string().min(1, 'Webhook verification token is required'),
});

/**
 * POST /api/onboarding
 *
 * Completes tenant onboarding by:
 * 1. Authenticating the current user via session cookie
 * 2. Validating the WABA configuration fields with Zod
 * 3. Storing the access_token in Supabase Vault (encrypted at rest)
 * 4. Creating the tenant row (or updating if it already exists)
 * 5. Linking the user to the tenant with role 'tenant_admin'
 * 6. Marking onboarding_completed = true
 *
 * The access_token is NEVER stored in plaintext in any database column.
 */
export async function POST(request: Request) {
  // 1. Authenticate
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 2. Parse and validate body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = onboardingSchema.safeParse(body);
  if (!parsed.success) {
    const firstError = parsed.error.errors[0];
    return NextResponse.json(
      { error: firstError?.message ?? 'Validation failed' },
      { status: 422 }
    );
  }

  const { company_name, waba_id, phone_number_id, access_token, webhook_verify_token } =
    parsed.data;

  const service = createServiceClient();

  // 3. Check if user already has a tenant (idempotency — allow re-submission)
  const { data: existingUser } = await service
    .from('users')
    .select('tenant_id')
    .eq('id', user.id)
    .single();

  if (existingUser?.tenant_id) {
    const { data: existingTenant } = await service
      .from('tenants')
      .select('onboarding_completed')
      .eq('id', existingUser.tenant_id)
      .single();

    if (existingTenant?.onboarding_completed) {
      // Already onboarded — treat as success, let the client redirect
      return NextResponse.json({ success: true });
    }
  }

  // 4. Store access_token in Vault — NEVER in plaintext
  let vaultSecretId: string;
  try {
    const secretName = `tenant_access_token_${user.id}`;
    vaultSecretId = await storeSecret(access_token, secretName);
  } catch (err) {
    console.error('[onboarding] Vault store failed:', err);
    return NextResponse.json(
      { error: 'Failed to securely store access token. Please try again.' },
      { status: 500 }
    );
  }

  // 5. Generate a URL-safe slug from company name
  const slug =
    company_name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') +
    '-' +
    Math.random().toString(36).slice(2, 7);

  // 6. Create the tenant row
  const { data: tenant, error: tenantError } = await service
    .from('tenants')
    .insert({
      name: company_name,
      slug,
      waba_id,
      phone_number_id,
      vault_secret_id: vaultSecretId,
      webhook_verify_token,
      is_active: true,
      onboarding_completed: true,
      bot_config: {
        system_prompt: '',
        handoff_keywords: [],
        rag_score_threshold: 0.75,
        language: 'es',
        max_tokens: 500,
      },
    })
    .select('id')
    .single();

  if (tenantError || !tenant) {
    console.error('[onboarding] Tenant insert failed:', tenantError);
    return NextResponse.json(
      { error: 'Failed to create your account configuration. Please try again.' },
      { status: 500 }
    );
  }

  // 7. Check if users row exists — create or update to link tenant_id
  const { data: userRow } = await service
    .from('users')
    .select('id')
    .eq('id', user.id)
    .single();

  if (userRow) {
    const { error: userUpdateError } = await service
      .from('users')
      .update({
        tenant_id: tenant.id,
        role: 'tenant_admin',
        full_name: user.user_metadata?.full_name ?? null,
      })
      .eq('id', user.id);

    if (userUpdateError) {
      console.error('[onboarding] User update failed:', userUpdateError);
      return NextResponse.json(
        { error: 'Failed to link your user to the account. Please try again.' },
        { status: 500 }
      );
    }
  } else {
    const { error: userInsertError } = await service.from('users').insert({
      id: user.id,
      tenant_id: tenant.id,
      role: 'tenant_admin',
      full_name: user.user_metadata?.full_name ?? null,
    });

    if (userInsertError) {
      console.error('[onboarding] User insert failed:', userInsertError);
      return NextResponse.json(
        { error: 'Failed to create your user profile. Please try again.' },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({ success: true });
}
