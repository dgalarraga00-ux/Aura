import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Middleware responsibilities:
 * 1. Refresh Supabase Auth session tokens on every request
 * 2. Protect all /dashboard/* and /admin/* routes — redirect unauthenticated users to /login
 * 3. Redirect authenticated users away from /login and /register
 * 4. Enforce onboarding gate:
 *    - Authenticated users without onboarding_completed → /onboarding/setup
 *    - Users at /onboarding/* with onboarding_completed = true → /dashboard
 *
 * Matches all routes EXCEPT: static files, images, Next.js internals, API routes.
 *
 * NOTE: Middleware runs on the Edge runtime and cannot use the service_role key or
 * Node-only modules. Onboarding state is read via the anon key + RLS — the user can
 * read their own tenant via the auth_tenant_id() helper used in the RLS policies.
 */
export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options?: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Refresh session — do NOT add logic between createServerClient and getUser()
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  // Protect /dashboard and /admin routes — redirect unauthenticated users to /login
  if ((pathname.startsWith('/dashboard') || pathname.startsWith('/admin')) && !user) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/login';
    loginUrl.searchParams.set('redirectTo', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Redirect authenticated users away from auth pages
  if (user && (pathname === '/login' || pathname === '/register')) {
    const dashboardUrl = request.nextUrl.clone();
    dashboardUrl.pathname = '/dashboard';
    return NextResponse.redirect(dashboardUrl);
  }

  // Redirect root to dashboard (or login if unauthenticated — handled above next request)
  if (pathname === '/') {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = user ? '/dashboard' : '/login';
    return NextResponse.redirect(redirectUrl);
  }

  // Onboarding gate — only applies to authenticated users on dashboard or onboarding routes
  if (user && (pathname.startsWith('/dashboard') || pathname.startsWith('/onboarding'))) {
    const onboardingCompleted = await getOnboardingCompleted(supabase);

    // Authenticated but not onboarded → redirect to setup (avoid infinite loop)
    if (!onboardingCompleted && !pathname.startsWith('/onboarding')) {
      const setupUrl = request.nextUrl.clone();
      setupUrl.pathname = '/onboarding/setup';
      return NextResponse.redirect(setupUrl);
    }

    // Already onboarded but trying to access onboarding → redirect to dashboard
    if (onboardingCompleted && pathname.startsWith('/onboarding')) {
      const dashboardUrl = request.nextUrl.clone();
      dashboardUrl.pathname = '/dashboard';
      return NextResponse.redirect(dashboardUrl);
    }
  }

  return supabaseResponse;
}

/**
 * Reads onboarding_completed for the authenticated user's tenant.
 * Returns true if the tenant exists and has onboarding_completed = true.
 * Returns false if no tenant row exists yet (new user pre-onboarding).
 * On any unexpected error, returns false to avoid blocking requests.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getOnboardingCompleted(supabase: any): Promise<boolean> {
  try {
    const { data: userRow } = await supabase
      .from('users')
      .select('tenant_id')
      .single();

    if (!userRow?.tenant_id) {
      return false;
    }

    const { data: tenant } = await supabase
      .from('tenants')
      .select('onboarding_completed')
      .eq('id', userRow.tenant_id)
      .single();

    return tenant?.onboarding_completed === true;
  } catch {
    return false;
  }
}

export const config = {
  matcher: [
    /*
     * Match all request paths EXCEPT:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico, sitemap.xml, robots.txt
     * - /api/* (API routes handle their own auth)
     */
    '/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|api/).*)',
  ],
};
