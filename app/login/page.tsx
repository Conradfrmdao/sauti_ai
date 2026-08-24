import { redirect } from "next/navigation";

import { AuthForm } from "@/components/auth-form";

import { createClient } from "@/lib/supabase/server";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  const { mode } = await searchParams;
  const supabase =
    await createClient();

  const {
    data,
  } =
    await supabase.auth.getClaims();

  const userId =
    data?.claims?.sub;

  /*
   * If already authenticated,
   * let SAUTI1 decide which
   * workspace the user belongs to.
   */

  if (userId) {
    redirect(
      "/auth/route"
    );
  }

  return (
    <AuthForm initialMode={mode === "signup" ? "signup" : "login"} />
  );
}
