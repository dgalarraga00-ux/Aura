import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createSupabaseServerClient } from '@/lib/supabase/server';

/**
 * Admin layout.
 *
 * Responsibilities:
 * 1. Verify the user is authenticated — redirect to /login if not.
 * 2. Verify the user has role `saas_admin` — redirect to /dashboard if not.
 * 3. Render minimal sidebar with admin links.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const { data: userData } = await supabase
    .from('users')
    .select('role, full_name')
    .eq('id', user.id)
    .single();

  if (userData?.role !== 'saas_admin') {
    redirect('/dashboard');
  }

  const navLinks = [
    { href: '/admin/tenants', label: 'Tenants' },
    { href: '/admin/metrics', label: 'Metricas' },
  ];

  return (
    <div className="min-h-screen flex bg-gray-100">
      {/* Sidebar */}
      <aside className="w-52 flex-shrink-0 bg-gray-900 text-white flex flex-col">
        <div className="px-4 py-5 border-b border-gray-700">
          <span className="font-bold text-white text-lg">SaaS Admin</span>
          <p className="text-xs text-gray-400 mt-0.5 truncate">
            {userData?.full_name ?? user.email}
          </p>
          <span className="inline-block mt-1 text-xs bg-red-900 text-red-300 px-2 py-0.5 rounded">
            saas_admin
          </span>
        </div>

        <nav className="flex-1 py-4 space-y-1 px-2">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="block px-3 py-2 rounded-md text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="px-4 py-4 border-t border-gray-700">
          <Link
            href="/dashboard"
            className="block text-sm text-gray-400 hover:text-white transition-colors mb-2"
          >
            Ir al Dashboard
          </Link>
          <form action="/api/auth/signout" method="POST">
            <button
              type="submit"
              className="w-full text-left text-sm text-gray-400 hover:text-white transition-colors"
            >
              Cerrar sesion
            </button>
          </form>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto p-6">{children}</main>
    </div>
  );
}
