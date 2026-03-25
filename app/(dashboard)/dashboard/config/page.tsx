import { createSupabaseServerClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import BotConfigForm from './BotConfigForm';

export default async function ConfigPage() {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // Only tenant_admin+ can access config
  const { data: userDataRaw } = await supabase
    .from('users')
    .select('role, tenant_id')
    .eq('id', user.id)
    .single();

  const userData = userDataRaw as { role: string; tenant_id: string | null } | null;

  if (!userData || userData.role === 'tenant_operator') {
    redirect('/dashboard/conversations');
  }

  type TenantConfig = {
    system_prompt: string;
    handoff_keywords: string[];
    rag_score_threshold: number;
    language: string;
    max_tokens: number;
  };

  type TenantRow = { id: string; name: string; bot_config: TenantConfig };

  // Fetch current tenant config
  const { data: rawTenant } = await supabase
    .from('tenants')
    .select('id, name, bot_config')
    .eq('id', userData.tenant_id!)
    .single();

  const tenant = rawTenant as TenantRow | null;

  if (!tenant) {
    redirect('/dashboard/conversations');
  }

  return (
    <div>
      <h1 className="text-xl font-semibold text-gray-900 mb-2">Bot Configuration</h1>
      <p className="text-sm text-gray-500 mb-6">Configure how the bot responds to your customers.</p>
      <BotConfigForm
        tenantId={tenant.id}
        tenantName={tenant.name}
        initialConfig={tenant.bot_config}
      />
    </div>
  );
}
