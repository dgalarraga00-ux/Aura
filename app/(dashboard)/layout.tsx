import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createSupabaseServerClient } from '@/lib/supabase/server';

/**
 * Dashboard layout.
 *
 * Responsibilities:
 * 1. Verify the user is authenticated — redirect to /login if not.
 * 2. Fetch the user's role from the `users` table.
 * 3. Render sidebar with links filtered by role.
 *
 * RBAC visibility rules:
 * - saas_admin    : all links
 * - tenant_admin  : all links except cross-tenant admin tools
 * - tenant_operator: only Conversations + Handoffs
 */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createSupabaseServerClient();

  // Verify session
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  // Fetch user role
  const { data: userDataRaw } = await supabase
    .from('users')
    .select('role, full_name, tenant_id')
    .eq('id', user.id)
    .single();

  const userData = userDataRaw as {
    role: 'saas_admin' | 'tenant_admin' | 'tenant_operator';
    full_name: string | null;
    tenant_id: string | null;
  } | null;

  const role = userData?.role ?? 'tenant_operator';
  const isAdmin = role === 'saas_admin' || role === 'tenant_admin';

  const navLinks = [
    { href: '/dashboard/conversations', label: 'Conversations', always: true },
    { href: '/dashboard/handoffs', label: 'Handoffs', always: true },
    { href: '/dashboard/knowledge', label: 'Knowledge Base', always: false },
    { href: '/dashboard/config', label: 'Bot Config', always: false },
    { href: '/dashboard/analytics', label: 'Analytics', always: false },
  ];

  return (
    <div className="min-h-screen flex bg-gray-100">
      {/* Sidebar */}
      <aside className="w-56 flex-shrink-0 bg-white border-r border-gray-200 flex flex-col">
        <div className="px-4 py-5 border-b border-gray-200">
          <span className="font-bold text-gray-900 text-lg">WA SaaS</span>
          <p className="text-xs text-gray-500 mt-0.5 truncate">
            {userData?.full_name ?? user.email}
          </p>
          <span className="inline-block mt-1 text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">
            {role}
          </span>
        </div>

        {role === 'saas_admin' && (
          <div className="px-4 py-2 border-b border-gray-200">
            <Link href="/admin/tenants" className="text-xs text-blue-600 hover:underline">
              ← Panel Admin
            </Link>
          </div>
        )}

        <nav className="flex-1 py-4 space-y-1 px-2">
          {navLinks.map((link) => {
            // Operators only see links marked `always: true`
            if (!link.always && !isAdmin) return null;
            return (
              <Link
                key={link.href}
                href={link.href}
                className="block px-3 py-2 rounded-md text-sm text-gray-700 hover:bg-gray-100 hover:text-gray-900 transition-colors"
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="px-4 py-4 border-t border-gray-200">
          <form action="/api/auth/signout" method="POST">
            <button
              type="submit"
              className="w-full text-left text-sm text-gray-500 hover:text-gray-900 transition-colors"
            >
              Sign out
            </button>
          </form>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto p-6">{children}</main>
    </div>
  );
}
