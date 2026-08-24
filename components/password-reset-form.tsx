"use client";

import { Eye, EyeOff, LoaderCircle, LockKeyhole } from "lucide-react";
import { FormEvent, useState } from "react";

import { createClient } from "@/lib/supabase/client";

export function PasswordResetForm() {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function updatePassword(event: FormEvent) {
    event.preventDefault();
    if (password.length < 8) {
      setError("Your password must be at least 8 characters.");
      return;
    }
    if (password !== confirmation) {
      setError("The passwords do not match.");
      return;
    }

    setPending(true);
    setError(undefined);
    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setError(updateError.message);
      setPending(false);
      return;
    }
    window.location.replace("/auth/route");
  }

  return (
    <form className="mt-6 space-y-4" onSubmit={updatePassword}>
      <label className="block">
        <span className="mb-1.5 block text-[11px] font-semibold text-[#49566c]">New password</span>
        <span className="flex h-12 items-center gap-2.5 rounded-[8px] border border-[#dde3eb] bg-white px-3 focus-within:border-[#8facff]">
          <LockKeyhole className="text-[#929bab]" size={16} />
          <input className="min-w-0 flex-1 border-0 bg-transparent text-[13px] outline-none" minLength={8} onChange={(event) => setPassword(event.target.value)} required type={showPassword ? "text" : "password"} value={password} />
          <button aria-label={showPassword ? "Hide password" : "Show password"} className="grid h-8 w-8 place-items-center text-[#7d8798]" onClick={() => setShowPassword((value) => !value)} type="button">
            {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        </span>
      </label>
      <label className="block">
        <span className="mb-1.5 block text-[11px] font-semibold text-[#49566c]">Confirm password</span>
        <span className="flex h-12 items-center gap-2.5 rounded-[8px] border border-[#dde3eb] bg-white px-3 focus-within:border-[#8facff]">
          <LockKeyhole className="text-[#929bab]" size={16} />
          <input className="min-w-0 flex-1 border-0 bg-transparent text-[13px] outline-none" minLength={8} onChange={(event) => setConfirmation(event.target.value)} required type={showPassword ? "text" : "password"} value={confirmation} />
        </span>
      </label>
      {error && <div className="rounded-[8px] border border-[#f0d6d2] bg-[#fff7f5] px-3 py-2 text-[11px] text-[#a94b42]" role="alert">{error}</div>}
      <button className="flex h-12 w-full items-center justify-center gap-2 rounded-[8px] bg-[#155dff] text-[12px] font-bold text-white disabled:opacity-60" disabled={pending} type="submit">
        {pending && <LoaderCircle className="animate-spin" size={16} />}
        {pending ? "Updating password..." : "Update password"}
      </button>
    </form>
  );
}
