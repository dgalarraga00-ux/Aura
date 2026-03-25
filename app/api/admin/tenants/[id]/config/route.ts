import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { redirect } from 'next/navigation';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // Verify saas_admin role
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const { data: userData } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single();

  if (userData?.role !== 'saas_admin') redirect('/dashboard');

  // Parse form data
  const formData = await request.formData();
  const rawRagScore = formData.get('rag_score_threshold');
  const rawMaxTokens = formData.get('max_tokens');

  const ragScoreThreshold = parseFloat(String(rawRagScore));
  const maxTokens = parseInt(String(rawMaxTokens), 10);

  // Validate
  if (
    isNaN(ragScoreThreshold) ||
    ragScoreThreshold < 0.5 ||
    ragScoreThreshold > 0.99
  ) {
    redirect(`/admin/tenants/${id}`);
  }

  if (isNaN(maxTokens) || maxTokens < 100 || maxTokens > 4000) {
    redirect(`/admin/tenants/${id}`);
  }

  // Fetch existing bot_config to merge
  const service = createServiceClient();
  const { data: tenant } = await service
    .from('tenants')
    .select('bot_config')
    .eq('id', id)
    .single();

  const existingConfig =
    (tenant?.bot_config as Record<string, unknown> | null) ?? {};

  const updatedConfig = {
    ...existingConfig,
    rag_score_threshold: ragScoreThreshold,
    max_tokens: maxTokens,
  };

  await service
    .from('tenants')
    .update({ bot_config: updatedConfig })
    .eq('id', id);

  redirect(`/admin/tenants/${id}`);
}
