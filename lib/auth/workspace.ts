import type { SupabaseClient } from "@supabase/supabase-js";

export async function isCitizenWorkspace(supabase: SupabaseClient, userId: string) {
  const [profileResult, membershipResult] = await Promise.all([
    supabase.from("profiles").select("role").eq("id", userId).maybeSingle(),
    supabase
      .from("institution_members")
      .select("institution_id")
      .eq("user_id", userId)
      .eq("active", true)
      .limit(1)
      .maybeSingle(),
  ]);

  if (profileResult.error || membershipResult.error || !profileResult.data) return false;
  return profileResult.data.role !== "admin" && !membershipResult.data;
}
