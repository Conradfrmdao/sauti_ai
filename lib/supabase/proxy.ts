import {
  createServerClient,
} from "@supabase/ssr";

import {
  NextResponse,
  type NextRequest,
} from "next/server";

export async function updateSession(
  request: NextRequest
) {
  let supabaseResponse =
    NextResponse.next({
      request,
    });

  const pathname = request.nextUrl.pathname;
  if (
    pathname === "/" ||
    pathname === "/login" ||
    pathname.startsWith("/guest/") ||
    pathname === "/api/sauti1/guest" ||
    pathname === "/api/sauti1/guest-live-token"
  ) {
    return supabaseResponse;
  }

  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL;

  const supabasePublishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (
    !supabaseUrl ||
    !supabasePublishableKey
  ) {
    return supabaseResponse;
  }

  const supabase =
    createServerClient(
      supabaseUrl,
      supabasePublishableKey,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },

          setAll(cookiesToSet) {
            cookiesToSet.forEach(
              ({
                name,
                value,
              }) => {
                request.cookies.set(
                  name,
                  value
                );
              }
            );

            supabaseResponse =
              NextResponse.next({
                request,
              });

            cookiesToSet.forEach(
              ({
                name,
                value,
                options,
              }) => {
                supabaseResponse.cookies.set(
                  name,
                  value,
                  options
                );
              }
            );
          },
        },
      }
    );

  /*
   * This validates / refreshes the
   * authentication token when necessary.
   */
  const {
    data: claimsData,
  } = await supabase.auth.getClaims();

  const userId = claimsData?.claims?.sub;
  const isPublicPath =
    pathname === "/login" ||
    pathname.startsWith("/auth/") ||
    pathname.startsWith("/api/");

  if (!userId && !isPublicPath) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    return NextResponse.redirect(loginUrl);
  }

  if (userId && pathname === "/login") {
    const routeUrl = request.nextUrl.clone();
    routeUrl.pathname = "/auth/route";
    routeUrl.search = "";
    return NextResponse.redirect(routeUrl);
  }

  return supabaseResponse;
}
