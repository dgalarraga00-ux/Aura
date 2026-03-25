import { createServiceClient } from '@/lib/supabase/service';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';

interface Props {
  params: Promise<{ id: string }>;
}

/**
 * /admin/tenants/[id] — Detalle de un tenant especifico.
 *
 * Muestra:
 * - Informacion basica del tenant
 * - Metricas: total mensajes, handoffs, fecha ultimo mensaje
 * - Toggle is_active con confirmacion visual
 * - Link a conversaciones (para implementacion futura)
 */
export default async function TenantDetailPage({ params }: Props) {
  const { id } = await params;

  // Verificar rol
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

  const service = createServiceClient();

  // Fetch tenant
  const { data: tenant, error } = await service
    .from('tenants')
    .select('id, name, slug, waba_id, phone_number_id, is_active, created_at, bot_config')
    .eq('id', id)
    .single();

  if (error || !tenant) {
    notFound();
  }

  // Metricas: total mensajes
  const { count: totalMessages } = await service
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', id);

  // Metricas: total handoffs
  const { count: totalHandoffs } = await service
    .from('handoffs')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', id);

  // Fecha del ultimo mensaje
  const { data: lastMessageRow } = await service
    .from('messages')
    .select('created_at')
    .eq('tenant_id', id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  // Owner del tenant
  const { data: owner } = await service
    .from('users')
    .select('full_name')
    .eq('tenant_id', id)
    .eq('role', 'tenant_admin')
    .limit(1)
    .maybeSingle();

  const statusLabel = tenant.is_active ? 'Activo' : 'Inactivo';
  const statusClass = tenant.is_active
    ? 'bg-green-100 text-green-800'
    : 'bg-red-100 text-red-800';

  return (
    <div className="max-w-3xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <Link
            href="/admin/tenants"
            className="text-sm text-blue-600 hover:underline mb-1 inline-block"
          >
            &larr; Tenants
          </Link>
          <h1 className="text-2xl font-bold text-gray-900">{tenant.name}</h1>
          <p className="text-sm text-gray-500">{tenant.slug}</p>
        </div>
        <span className={`inline-flex items-center px-3 py-1 rounded text-sm font-medium ${statusClass}`}>
          {statusLabel}
        </span>
      </div>

      {/* Informacion basica */}
      <div className="bg-white shadow rounded-lg p-6 mb-6">
        <h2 className="text-base font-semibold text-gray-900 mb-4">Informacion basica</h2>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
          <div>
            <dt className="text-gray-500">ID</dt>
            <dd className="font-mono text-xs text-gray-700 break-all">{tenant.id}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Owner</dt>
            <dd className="text-gray-700">{owner?.full_name ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-gray-500">WABA ID</dt>
            <dd className="font-mono text-xs text-gray-700">{tenant.waba_id || '—'}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Phone Number ID</dt>
            <dd className="font-mono text-xs text-gray-700">{tenant.phone_number_id || '—'}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Fecha de registro</dt>
            <dd className="text-gray-700">
              {new Date(tenant.created_at).toLocaleDateString('es-AR', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
              })}
            </dd>
          </div>
        </dl>
      </div>

      {/* Metricas */}
      <div className="bg-white shadow rounded-lg p-6 mb-6">
        <h2 className="text-base font-semibold text-gray-900 mb-4">Metricas</h2>
        <div className="grid grid-cols-3 gap-4">
          <div className="text-center p-4 bg-gray-50 rounded-lg">
            <p className="text-2xl font-bold text-gray-900">{totalMessages ?? 0}</p>
            <p className="text-xs text-gray-500 mt-1">Total mensajes</p>
          </div>
          <div className="text-center p-4 bg-gray-50 rounded-lg">
            <p className="text-2xl font-bold text-gray-900">{totalHandoffs ?? 0}</p>
            <p className="text-xs text-gray-500 mt-1">Total handoffs</p>
          </div>
          <div className="text-center p-4 bg-gray-50 rounded-lg">
            <p className="text-sm font-semibold text-gray-700 leading-tight">
              {lastMessageRow?.created_at
                ? new Date(lastMessageRow.created_at).toLocaleDateString('es-AR', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                  })
                : '—'}
            </p>
            <p className="text-xs text-gray-500 mt-1">Ultimo mensaje</p>
          </div>
        </div>
      </div>

      {/* Configuracion Avanzada */}
      <div className="bg-white shadow rounded-lg p-6 mb-6">
        <h2 className="text-base font-semibold text-gray-900 mb-1">Configuracion Avanzada</h2>
        <p className="text-xs text-gray-400 mb-4">Managed by SaaS Admin</p>
        <form action={`/api/admin/tenants/${tenant.id}/config`} method="POST">
          <div className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm">
            <div>
              <label className="block text-gray-500 mb-1" htmlFor="rag_score_threshold">
                RAG Score Threshold
              </label>
              <input
                id="rag_score_threshold"
                name="rag_score_threshold"
                type="number"
                min="0.5"
                max="0.99"
                step="0.01"
                defaultValue={
                  (tenant as { bot_config?: { rag_score_threshold?: number } }).bot_config?.rag_score_threshold ?? 0.75
                }
                className="border border-gray-300 rounded-md px-3 py-2 text-sm text-gray-900 w-full"
              />
            </div>
            <div>
              <label className="block text-gray-500 mb-1" htmlFor="max_tokens">
                Max Response Tokens
              </label>
              <input
                id="max_tokens"
                name="max_tokens"
                type="number"
                min="100"
                max="4000"
                step="100"
                defaultValue={
                  (tenant as { bot_config?: { max_tokens?: number } }).bot_config?.max_tokens ?? 500
                }
                className="border border-gray-300 rounded-md px-3 py-2 text-sm text-gray-900 w-full"
              />
            </div>
          </div>
          <div className="mt-4">
            <button
              type="submit"
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 transition-colors"
            >
              Guardar configuración
            </button>
          </div>
        </form>
      </div>

      {/* Acciones */}
      <div className="bg-white shadow rounded-lg p-6">
        <h2 className="text-base font-semibold text-gray-900 mb-4">Acciones</h2>
        <div className="flex items-center gap-4">
          <form
            action={`/api/admin/tenants/${tenant.id}/toggle`}
            method="POST"
          >
            <button
              type="submit"
              className={
                tenant.is_active
                  ? 'px-4 py-2 bg-red-600 text-white text-sm font-medium rounded hover:bg-red-700 transition-colors'
                  : 'px-4 py-2 bg-green-600 text-white text-sm font-medium rounded hover:bg-green-700 transition-colors'
              }
            >
              {tenant.is_active ? 'Suspender tenant' : 'Activar tenant'}
            </button>
          </form>

          {/* Link futuro a conversaciones del tenant */}
          <span className="px-4 py-2 bg-gray-100 text-gray-400 text-sm font-medium rounded cursor-not-allowed">
            Ver conversaciones (proximo)
          </span>
        </div>

        {tenant.is_active && (
          <p className="text-xs text-gray-400 mt-3">
            Al suspender, el circuit breaker de Redis se invalida inmediatamente y el
            webhook deja de procesar mensajes de este tenant.
          </p>
        )}
      </div>
    </div>
  );
}
