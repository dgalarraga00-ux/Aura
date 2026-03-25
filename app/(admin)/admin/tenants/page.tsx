import React from 'react';
import { createServiceClient } from '@/lib/supabase/service';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';

/**
 * /admin/tenants — Lista todos los tenants del sistema.
 *
 * Server Component. Usa service role para bypassear RLS y ver todos los tenants.
 * Doble verificacion de rol: el layout ya bloquea, pero esta page lo re-verifica
 * por si se accede directamente.
 *
 * Estado del tenant:
 * - Activo     : is_active = true  AND tiene waba_id configurado
 * - Inactivo   : is_active = false
 * - Pendiente  : is_active = true  AND waba_id esta vacio (onboarding incompleto)
 */
export default async function TenantsPage() {
  // Re-verificar rol (defensa en profundidad)
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

  if (userData?.role !== 'saas_admin') redirect('/dashboard');

  // Fetch todos los tenants con su owner (primer usuario tenant_admin)
  const service = createServiceClient();

  const { data: tenants, error } = await service
    .from('tenants')
    .select('id, name, slug, waba_id, phone_number_id, is_active, created_at')
    .order('created_at', { ascending: false });

  // Para cada tenant buscar el owner via users table + auth.users para el email
  const { data: allUsers } = await service
    .from('users')
    .select('id, tenant_id, full_name');

  // Obtener emails desde auth.users via admin API
  const { data: authData } = await service.auth.admin.listUsers({ perPage: 1000 });
  const emailMap = new Map<string, string>();
  for (const u of authData?.users ?? []) {
    if (u.email) emailMap.set(u.id, u.email);
  }

  // Construir un mapa tenant_id -> owner info
  const ownerMap = new Map<string, string>();
  for (const u of allUsers ?? []) {
    if (u.tenant_id && !ownerMap.has(u.tenant_id)) {
      ownerMap.set(u.tenant_id, u.full_name ?? emailMap.get(u.id) ?? '—');
    }
  }

  if (error) {
    return (
      <div className="text-red-600 text-sm">
        Error al cargar tenants: {error.message}
      </div>
    );
  }

  function getTenantStatus(tenant: { is_active: boolean; waba_id: string | null }) {
    if (!tenant.is_active) return 'inactive';
    if (!tenant.waba_id) return 'pending';
    return 'active';
  }

  const statusBadge: Record<string, React.ReactElement> = {
    active: (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
        Activo
      </span>
    ),
    inactive: (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800">
        Inactivo
      </span>
    ),
    pending: (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-800">
        Pendiente
      </span>
    ),
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Tenants</h1>
        <p className="text-sm text-gray-500 mt-1">
          {tenants?.length ?? 0} tenants registrados
        </p>
      </div>

      <div className="bg-white shadow rounded-lg overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Empresa
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Owner
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Registro
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Estado
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                Acciones
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {(tenants ?? []).map((tenant) => {
              const status = getTenantStatus(tenant);
              return (
                <tr key={tenant.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm font-medium text-gray-900">{tenant.name}</div>
                    <div className="text-xs text-gray-400">{tenant.slug}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                    {ownerMap.get(tenant.id) ?? '—'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {new Date(tenant.created_at).toLocaleDateString('es-AR', {
                      day: '2-digit',
                      month: '2-digit',
                      year: 'numeric',
                    })}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {statusBadge[status]}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm space-x-3">
                    <Link
                      href={`/admin/tenants/${tenant.id}`}
                      className="text-blue-600 hover:text-blue-800 font-medium"
                    >
                      Ver detalle
                    </Link>
                    <ToggleButton
                      tenantId={tenant.id}
                      isActive={tenant.is_active}
                    />
                  </td>
                </tr>
              );
            })}
            {(tenants ?? []).length === 0 && (
              <tr>
                <td colSpan={5} className="px-6 py-10 text-center text-sm text-gray-400">
                  No hay tenants registrados todavia.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Boton de toggle inline con form action (no requiere Client Component).
 * Llama a la API route POST /api/admin/tenants/[id]/toggle.
 */
function ToggleButton({ tenantId, isActive }: { tenantId: string; isActive: boolean }) {
  return (
    <form
      action={`/api/admin/tenants/${tenantId}/toggle`}
      method="POST"
      className="inline"
    >
      <button
        type="submit"
        className={
          isActive
            ? 'text-red-600 hover:text-red-800 font-medium'
            : 'text-green-600 hover:text-green-800 font-medium'
        }
      >
        {isActive ? 'Suspender' : 'Activar'}
      </button>
    </form>
  );
}
