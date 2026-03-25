import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

/**
 * Onboarding layout — no sidebar, no nav.
 *
 * Guards:
 * - Unauthenticated users → /login
 * - Tenants with onboarding_completed = true → /dashboard
 *   (they have no business being in the onboarding flow)
 */
export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  // Check if this user's tenant has already completed onboarding.
  // Use service client to bypass RLS — the user row may not have a tenant_id yet.
  const service = createServiceClient();
  const { data: userRow } = await service
    .from('users')
    .select('tenant_id')
    .eq('id', user.id)
    .single();

  if (userRow?.tenant_id) {
    const { data: tenant } = await service
      .from('tenants')
      .select('onboarding_completed')
      .eq('id', userRow.tenant_id)
      .single();

    if (tenant?.onboarding_completed) {
      redirect('/dashboard');
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {children}
    </div>
  );
}
