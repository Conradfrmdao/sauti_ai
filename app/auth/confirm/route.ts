import type {
  EmailOtpType,
} from "@supabase/supabase-js";

import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  createClient,
} from "@/lib/supabase/server";

export async function GET(
  request: NextRequest
) {
  const {
    searchParams,
  } =
    new URL(
      request.url
    );

  const tokenHash =
    searchParams.get(
      "token_hash"
    );

  const type =
    searchParams.get(
      "type"
    ) as
      | EmailOtpType
      | null;

  const redirectTo =
    request.nextUrl.clone();

  const requestedNext = searchParams.get("next");

  redirectTo.pathname = requestedNext?.startsWith("/") && !requestedNext.startsWith("//")
    ? requestedNext
    : type === "recovery"
      ? "/auth/reset-password"
      : "/auth/route";

  redirectTo.search = "";

  if (
    tokenHash &&
    type
  ) {
    const supabase =
      await createClient();

    const {
      error,
    } =
      await supabase.auth.verifyOtp(
        {
          type,
          token_hash:
            tokenHash,
        }
      );

    if (!error) {
      return NextResponse.redirect(
        redirectTo
      );
    }
  }

  redirectTo.pathname =
    "/login";

  redirectTo.searchParams.set(
    "error",
    "confirmation_failed"
  );

  return NextResponse.redirect(
    redirectTo
  );
}
