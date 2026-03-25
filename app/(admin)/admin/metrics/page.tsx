import { createServiceClient } from '@/lib/supabase/service';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';

/**
 * /admin/metrics — Metricas globales del sistema.
 *
 * Server Component. Usa service role para queries cross-tenant.
 * Rango: ultimos 7 dias para mensajes y handoffs.
 */
export default async function MetricsPage() {
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

  // ── Conteos de tenants por estado ─────────────────────────────────────────────
  const { data: allTenants } = await service
    .from('tenants')
    .select('id, is_active, waba_id');

  const totalActive = (allTenants ?? []).filter(
    (t) => t.is_active && t.waba_id
  ).length;
  const totalInactive = (allTenants ?? []).filter((t) => !t.is_active).length;
  const totalPending = (allTenants ?? []).filter(
    (t) => t.is_active && !t.waba_id
  ).length;

  // ── Ultimos 7 dias ────────────────────────────────────────────────────────────
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { count: messagesLast7d } = await service
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', sevenDaysAgo);

  const { count: handoffsLast7d } = await service
    .from('handoffs')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', sevenDaysAgo);

  // ── Top 5 tenants por mensajes (total historico) ───────────────────────────────
  // Supabase no soporta GROUP BY directo via JS client, hacemos query manual
  // trayendo todos los mensajes con solo tenant_id y agregando en JS.
  // Para datasets grandes esto deberia ser una RPC, pero para MVP es suficiente.
  const { data: messagesByTenant } = await service
    .from('messages')
    .select('tenant_id');

  const tenantMessageCount = new Map<string, number>();
  for (const row of messagesByTenant ?? []) {
    tenantMessageCount.set(row.tenant_id, (tenantMessageCount.get(row.tenant_id) ?? 0) + 1);
  }

  // Fetch nombres de tenants para el top 5
  const top5TenantIds = [...tenantMessageCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id]) => id);

  const { data: top5Tenants } = top5TenantIds.length
    ? await service
        .from('tenants')
        .select('id, name')
        .in('id', top5TenantIds)
    : { data: [] };

  const tenantNameMap = new Map((top5Tenants ?? []).map((t) => [t.id, t.name]));

  const top5 = top5TenantIds.map((id) => ({
    id,
    name: tenantNameMap.get(id) ?? id,
    count: tenantMessageCount.get(id) ?? 0,
  }));

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Metricas globales</h1>
        <p className="text-sm text-gray-500 mt-1">Vista general del sistema</p>
      </div>

      {/* Estado de tenants */}
      <section className="mb-8">
        <h2 className="text-base font-semibold text-gray-700 mb-3">Tenants</h2>
        <div className="grid grid-cols-3 gap-4">
          <MetricCard
            value={totalActive}
            label="Activos"
            color="green"
          />
          <MetricCard
            value={totalInactive}
            label="Inactivos"
            color="red"
          />
          <MetricCard
            value={totalPending}
            label="Pendientes"
            color="yellow"
          />
        </div>
      </section>

      {/* Actividad ultimos 7 dias */}
      <section className="mb-8">
        <h2 className="text-base font-semibold text-gray-700 mb-3">
          Ultimos 7 dias
        </h2>
        <div className="grid grid-cols-2 gap-4">
          <MetricCard
            value={messagesLast7d ?? 0}
            label="Mensajes procesados"
            color="blue"
          />
          <MetricCard
            value={handoffsLast7d ?? 0}
            label="Handoffs generados"
            color="purple"
          />
        </div>
      </section>

      {/* Top 5 tenants */}
      <section>
        <h2 className="text-base font-semibold text-gray-700 mb-3">
          Top 5 tenants por mensajes
        </h2>
        {top5.length === 0 ? (
          <div className="bg-white shadow rounded-lg p-6 text-sm text-gray-400">
            No hay mensajes registrados todavia.
          </div>
        ) : (
          <div className="bg-white shadow rounded-lg overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    #
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Tenant
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Mensajes totales
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {top5.map((t, i) => (
                  <tr key={t.id}>
                    <td className="px-6 py-4 text-sm text-gray-400">{i + 1}</td>
                    <td className="px-6 py-4 text-sm font-medium text-gray-900">{t.name}</td>
                    <td className="px-6 py-4 text-sm text-gray-700 text-right tabular-nums">
                      {t.count.toLocaleString('es-AR')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

// ── Componente auxiliar ────────────────────────────────────────────────────────

type Color = 'green' | 'red' | 'yellow' | 'blue' | 'purple';

const colorMap: Record<Color, string> = {
  green: 'text-green-700',
  red: 'text-red-700',
  yellow: 'text-yellow-700',
  blue: 'text-blue-700',
  purple: 'text-purple-700',
};

function MetricCard({
  value,
  label,
  color,
}: {
  value: number;
  label: string;
  color: Color;
}) {
  return (
    <div className="bg-white shadow rounded-lg p-6">
      <p className={`text-3xl font-bold ${colorMap[color]}`}>
        {value.toLocaleString('es-AR')}
      </p>
      <p className="text-sm text-gray-500 mt-1">{label}</p>
    </div>
  );
}
