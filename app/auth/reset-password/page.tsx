import { redirect } from "next/navigation";

import { PasswordResetForm } from "@/components/password-reset-form";
import { createClient } from "@/lib/supabase/server";

export default async function ResetPasswordPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <main className="grid min-h-dvh place-items-center bg-[#f7f8fb] px-5 text-[#0b1633]">
      <section className="w-full max-w-[420px] rounded-[8px] border border-[#e0e5ed] bg-white p-6 shadow-[0_16px_45px_rgba(15,29,59,0.08)]">
        <div className="text-[20px] font-[850]">SAUTI<span className="text-[#1d5eff]">1</span><span className="ml-1 text-[9px] text-[#67738b]">AI</span></div>
        <h1 className="mt-7 text-[27px] font-bold">Choose a new password</h1>
        <p className="mt-2 text-[12px] leading-5 text-[#778296]">Use a password you do not use on another account.</p>
        <PasswordResetForm />
      </section>
    </main>
  );
}
