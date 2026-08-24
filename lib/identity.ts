import { createClient } from "@/lib/supabase/server";

export type AppIdentity = {
  userId: string;
  fullName: string;
  email: string;
  roleLabel: string;
  initials: string;
};

function initialsFromName(name: string) {
  const parts = name
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 0) {
    return "S1";
  }

  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export async function getCurrentIdentity(
  fallbackRoleLabel = "Citizen account"
): Promise<AppIdentity | null> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, role")
    .eq("id", user.id)
    .maybeSingle();

  const email = user.email ?? "";
  const fullName =
    profile?.full_name?.trim() ||
    user.user_metadata?.full_name ||
    user.user_metadata?.name ||
    email.split("@")[0] ||
    "Sauti1 user";

  const roleLabel =
    profile?.role === "admin"
      ? "Platform administrator"
      : fallbackRoleLabel;

  return {
    userId: user.id,
    fullName,
    email,
    roleLabel,
    initials: initialsFromName(fullName),
  };
}

export function getInitials(name: string) {
  return initialsFromName(name);
}
