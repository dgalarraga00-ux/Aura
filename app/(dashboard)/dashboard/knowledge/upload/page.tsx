import { createSupabaseServerClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import UploadForm from './UploadForm';

export default async function KnowledgeUploadPage() {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: userDataRaw } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single();

  const userData = userDataRaw as { role: string } | null;

  if (userData?.role === 'tenant_operator') {
    redirect('/dashboard/conversations');
  }

  return (
    <div>
      <h1 className="text-xl font-semibold text-gray-900 mb-6">Upload Document</h1>
      <UploadForm />
    </div>
  );
}
