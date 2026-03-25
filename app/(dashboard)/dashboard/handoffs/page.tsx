import { createSupabaseServerClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import HandoffsClient from './HandoffsClient';

export default async function HandoffsPage() {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // Fetch user's tenant_id for Realtime subscription
  const { data: userDataRaw } = await supabase
    .from('users')
    .select('tenant_id, role')
    .eq('id', user.id)
    .single();

  const userData = userDataRaw as { tenant_id: string | null; role: string } | null;

  // Fetch initial escalated conversations — RLS ensures tenant isolation
  const { data: escalated } = await supabase
    .from('conversations')
    .select(
      `
      id,
      tenant_id,
      is_escalated,
      escalated_at,
      escalation_trigger,
      created_at,
      updated_at,
      contacts ( phone, name )
    `
    )
    .eq('is_escalated', true)
    .is('resolved_at', null)
    .order('escalated_at', { ascending: false })
    .limit(50);

  return (
    <div>
      <h1 className="text-xl font-semibold text-gray-900 mb-4">Handoff Inbox</h1>
      <HandoffsClient
        initialHandoffs={escalated ?? []}
        tenantId={userData?.tenant_id ?? ''}
        userId={user.id}
      />
    </div>
  );
}
