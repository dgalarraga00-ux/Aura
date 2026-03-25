import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import type { Database } from '@/types/database';

/**
 * GET /api/auth/callback
 *
 * Handles the OAuth / magic-link / email-confirmation redirect from Supabase Auth.
 * Exchanges the `code` query param for a session, then redirects the user to the
 * appropriate destination:
 *   - New user (no tenant) → /onboarding/setup
 *   - Existing user with onboarding complete → /dashboard (or redirectTo param)
 *   - Error → /login?error=...
 *
 * This route must exist for Supabase SSR email confirmation to work.
 * Configure Supabase dashboard → Authentication → URL Configuration:
 *   Site URL:      http://localhost:3000  (or your production URL)
 *   Redirect URLs: http://localhost:3000/api/auth/callback
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const redirectTo = searchParams.get('redirectTo') ?? null;

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`);
  }

  const response = NextResponse.redirect(`${origin}/onboarding/setup`);

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options?: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(error.message)}`);
  }

  // Determine where to send the user after successful authentication
  // If a safe redirectTo was provided and it's not an external URL, honour it
  if (redirectTo && redirectTo.startsWith('/') && !redirectTo.startsWith('//')) {
    const target = new URL(redirectTo, origin);
    return NextResponse.redirect(target.toString());
  }

  // Default: send new users to onboarding.
  // The middleware and onboarding layout will redirect to /dashboard if already completed.
  return response;
}
