"use client";

import {
  ArrowRight,
  Eye,
  EyeOff,
  LoaderCircle,
  LockKeyhole,
  Mail,
  ShieldCheck,
  UserRound,
} from "lucide-react";

import Link from "next/link";

import {
  useActionState,
  useState,
} from "react";

import {
  login,
  requestPasswordReset,
  signup,
  type AuthState,
} from "@/app/login/actions";

const initialState: AuthState = {};

export function AuthForm() {
  const [mode, setMode] =
    useState<"login" | "signup" | "reset">(
      "login"
    );

  const [
    showPassword,
    setShowPassword,
  ] = useState(false);

  const [
    loginState,
    loginAction,
    loginPending,
  ] = useActionState(
    login,
    initialState
  );

  const [
    signupState,
    signupAction,
    signupPending,
  ] = useActionState(
    signup,
    initialState
  );

  const [
    resetState,
    resetAction,
    resetPending,
  ] = useActionState(
    requestPasswordReset,
    initialState
  );

  const state =
    mode === "login"
      ? loginState
      : mode === "signup"
        ? signupState
        : resetState;

  const pending =
    mode === "login"
      ? loginPending
      : mode === "signup"
        ? signupPending
        : resetPending;

  const isSignup =
    mode === "signup";
  const isReset = mode === "reset";

  return (
    <div className="min-h-dvh bg-[#f7f8fb] text-[#0b1633] lg:grid lg:h-dvh lg:grid-cols-[46%_54%] lg:overflow-hidden">

      {/* =====================================================
          LEFT BRAND PANEL
      ===================================================== */}

      <section className="relative hidden h-dvh overflow-hidden bg-[#07152f] lg:flex lg:flex-col lg:justify-between">

        {/* Ambient background */}

        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -right-[120px] -top-[120px] h-[430px] w-[430px] rounded-full bg-[#215cff]/20 blur-[30px]" />

          <div className="absolute -bottom-[180px] left-[30px] h-[480px] w-[480px] rounded-full bg-[#7655ff]/15 blur-[40px]" />

          <div className="absolute left-[14%] top-[38%] h-[250px] w-[250px] rounded-full border border-white/[0.05]" />

          <div className="absolute left-[19%] top-[43%] h-[170px] w-[170px] rounded-full border border-white/[0.05]" />
        </div>

        {/* Logo */}

        <div className="relative z-10 px-9 pt-7 xl:px-12">
          <Link
            href="/"
            className="inline-flex items-center"
          >
            <span className="text-[23px] font-[850] tracking-[-1.3px] text-white">
              SAUTI
            </span>

            <span className="text-[23px] font-[850] tracking-[-1.3px] text-[#4f7dff]">
              1
            </span>

            <span className="ml-1 text-[11px] font-bold text-white/50">
              AI
            </span>
          </Link>
        </div>

        {/* Main statement */}

        <div className="relative z-10 max-w-[560px] px-9 xl:px-12">

          <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-[15px] border border-white/10 bg-white/[0.07] text-[#7fa0ff]">
            <ShieldCheck
              size={20}
              strokeWidth={1.7}
            />
          </div>

          <h1 className="max-w-[500px] text-[38px] font-[760] leading-[1.02] tracking-[-1.8px] text-white xl:text-[46px]">
            One place to be
            heard.
          </h1>

          <p className="mt-4 max-w-[465px] text-[13px] leading-[1.7] text-[#aab6cd]">
            Talk naturally with
            Sauti1, explain what
            happened and stay
            connected to the
            institution responsible
            for resolving it.
          </p>
        </div>

        {/* Footer */}

        <div className="relative z-10 px-9 pb-6 text-[9px] text-white/35 xl:px-12">
          SAUTI1 AI · Citizen and
          institution intelligence
        </div>
      </section>

      {/* =====================================================
          RIGHT AUTH PANEL
      ===================================================== */}

      <section className="flex min-h-dvh flex-col lg:h-dvh lg:min-h-0 lg:overflow-hidden">

        {/* Mobile header */}

        <div className="flex h-[62px] shrink-0 items-center px-5 lg:hidden">
          <Link
            href="/"
            className="inline-flex items-center"
          >
            <span className="text-[20px] font-[850] tracking-[-1px]">
              SAUTI
            </span>

            <span className="text-[20px] font-[850] tracking-[-1px] text-[#1d5eff]">
              1
            </span>

            <span className="ml-1 text-[9px] font-bold text-[#67738b]">
              AI
            </span>
          </Link>
        </div>

        {/* Form container */}

        <div
          className={`
            flex flex-1 justify-center px-5 sm:px-8
            lg:min-h-0 lg:items-center
            ${
              isSignup
                ? "py-5 lg:py-3"
                : "py-8 lg:py-5"
            }
          `}
        >
          <div className="w-full max-w-[420px]">

            {/* =================================================
                HEADER
            ================================================= */}

            <div>
              <div className="text-[11px] font-medium text-[#8490a4]">
                {isSignup
                  ? "Join Sauti1"
                  : isReset
                    ? "Account recovery"
                    : "Welcome back"}
              </div>

              <h2
                className={`
                  mt-1 font-[760] tracking-[-1.2px]
                  ${
                    isSignup
                      ? "text-[28px] leading-[1.05] lg:text-[29px]"
                      : "text-[30px] leading-[1.08] lg:text-[31px]"
                  }
                `}
              >
                {isSignup
                  ? "Create your account"
                  : isReset
                    ? "Reset your password"
                    : "Sign in to Sauti1"}
              </h2>

              <p
                className={`
                  text-[#7b8597]
                  ${
                    isSignup
                      ? "mt-1.5 text-[11px] leading-[1.45]"
                      : "mt-2 text-[12px] leading-5"
                  }
                `}
              >
                {isSignup
                  ? "Create a citizen account and start talking with Sauti1."
                  : isReset
                    ? "Enter your account email and we will send a secure reset link."
                    : "Continue to your Sauti1 workspace."}
              </p>
            </div>

            {/* =================================================
                MODE SELECTOR
            ================================================= */}

            <div
              className={`
                grid grid-cols-2 rounded-[11px] bg-[#eef1f5] p-1
                ${
                  isSignup
                    ? "mt-5"
                    : "mt-6"
                }
              `}
            >
              <button
                type="button"
                onClick={() =>
                  setMode("login")
                }
                className={`h-9 rounded-[8px] text-[11px] font-semibold transition ${
                  mode === "login"
                    ? "bg-white text-[#0b1633] shadow-[0_2px_8px_rgba(18,35,70,0.08)]"
                    : "text-[#7c8799]"
                }`}
              >
                Sign in
              </button>

              <button
                type="button"
                onClick={() =>
                  setMode("signup")
                }
                className={`h-9 rounded-[8px] text-[11px] font-semibold transition ${
                  mode === "signup"
                    ? "bg-white text-[#0b1633] shadow-[0_2px_8px_rgba(18,35,70,0.08)]"
                    : "text-[#7c8799]"
                }`}
              >
                Create account
              </button>
            </div>

            {/* =================================================
                FORM
            ================================================= */}

            <form
              action={
                mode === "login"
                  ? loginAction
                  : mode === "signup"
                    ? signupAction
                    : resetAction
              }
              className={
                isSignup
                  ? "mt-4"
                  : "mt-5"
              }
            >

              {/* ===============================================
                  FULL NAME
              =============================================== */}

              {isSignup && (
                <div>
                  <label
                    htmlFor="fullName"
                    className="mb-1.5 block text-[10px] font-semibold text-[#49566c]"
                  >
                    Full name
                  </label>

                  <div className="flex h-[42px] items-center gap-2.5 rounded-[11px] border border-[#dde3eb] bg-white px-3 transition focus-within:border-[#a8bfff] focus-within:ring-4 focus-within:ring-[#1d5eff]/[0.05]">
                    <UserRound
                      size={15}
                      className="shrink-0 text-[#929bab]"
                    />

                    <input
                      id="fullName"
                      name="fullName"
                      type="text"
                      autoComplete="name"
                      placeholder="Your name"
                      required
                      className="min-w-0 flex-1 border-0 bg-transparent text-[12px] outline-none placeholder:text-[#a4acb9]"
                    />
                  </div>
                </div>
              )}

              {/* ===============================================
                  EMAIL
              =============================================== */}

              <div
                className={
                  isSignup
                    ? "mt-3"
                    : ""
                }
              >
                <label
                  htmlFor="email"
                  className="mb-1.5 block text-[10px] font-semibold text-[#49566c]"
                >
                  Email address
                </label>

                <div className="flex h-[42px] items-center gap-2.5 rounded-[11px] border border-[#dde3eb] bg-white px-3 transition focus-within:border-[#a8bfff] focus-within:ring-4 focus-within:ring-[#1d5eff]/[0.05]">
                  <Mail
                    size={15}
                    className="shrink-0 text-[#929bab]"
                  />

                  <input
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    required
                    className="min-w-0 flex-1 border-0 bg-transparent text-[12px] outline-none placeholder:text-[#a4acb9]"
                  />
                </div>
              </div>

              {/* ===============================================
                  PASSWORD
              =============================================== */}

              {!isReset && <div
                className={
                  isSignup
                    ? "mt-3"
                    : "mt-4"
                }
              >
                <div className="mb-1.5 flex items-center justify-between">
                  <label
                    htmlFor="password"
                    className="text-[10px] font-semibold text-[#49566c]"
                  >
                    Password
                  </label>

                  {!isSignup && (
                    <button
                      type="button"
                      onClick={() => setMode("reset")}
                      className="text-[10px] font-semibold text-[#1d5eff]"
                    >
                      Forgot password?
                    </button>
                  )}
                </div>

                <div className="flex h-[42px] items-center gap-2.5 rounded-[11px] border border-[#dde3eb] bg-white px-3 transition focus-within:border-[#a8bfff] focus-within:ring-4 focus-within:ring-[#1d5eff]/[0.05]">
                  <LockKeyhole
                    size={15}
                    className="shrink-0 text-[#929bab]"
                  />

                  <input
                    id="password"
                    name="password"
                    type={
                      showPassword
                        ? "text"
                        : "password"
                    }
                    autoComplete={
                      isSignup
                        ? "new-password"
                        : "current-password"
                    }
                    placeholder="Enter your password"
                    minLength={8}
                    required
                    className="min-w-0 flex-1 border-0 bg-transparent text-[12px] outline-none placeholder:text-[#a4acb9]"
                  />

                  <button
                    type="button"
                    onClick={() =>
                      setShowPassword(
                        (value) =>
                          !value
                      )
                    }
                    className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-[#8993a4] transition hover:bg-[#f5f7fa]"
                    aria-label={
                      showPassword
                        ? "Hide password"
                        : "Show password"
                    }
                  >
                    {showPassword ? (
                      <EyeOff size={14} />
                    ) : (
                      <Eye size={14} />
                    )}
                  </button>
                </div>
              </div>}

              {/* ===============================================
                  CONFIRM PASSWORD
              =============================================== */}

              {isSignup && (
                <div className="mt-3">
                  <label
                    htmlFor="confirmPassword"
                    className="mb-1.5 block text-[10px] font-semibold text-[#49566c]"
                  >
                    Confirm password
                  </label>

                  <div className="flex h-[42px] items-center gap-2.5 rounded-[11px] border border-[#dde3eb] bg-white px-3 transition focus-within:border-[#a8bfff] focus-within:ring-4 focus-within:ring-[#1d5eff]/[0.05]">
                    <LockKeyhole
                      size={15}
                      className="shrink-0 text-[#929bab]"
                    />

                    <input
                      id="confirmPassword"
                      name="confirmPassword"
                      type={
                        showPassword
                          ? "text"
                          : "password"
                      }
                      autoComplete="new-password"
                      placeholder="Repeat your password"
                      minLength={8}
                      required
                      className="min-w-0 flex-1 border-0 bg-transparent text-[12px] outline-none placeholder:text-[#a4acb9]"
                    />
                  </div>
                </div>
              )}

              {/* ===============================================
                  ERROR
              =============================================== */}

              {state.error && (
                <div className="mt-3 rounded-[10px] border border-[#f0d6d2] bg-[#fff7f5] px-3 py-2 text-[10px] leading-4 text-[#a94b42]">
                  {state.error}
                </div>
              )}

              {/* ===============================================
                  SUCCESS
              =============================================== */}

              {state.message && (
                <div className="mt-3 rounded-[10px] border border-[#cfe8dd] bg-[#f3fbf7] px-3 py-2 text-[10px] leading-4 text-[#277054]">
                  {state.message}
                </div>
              )}

              {/* ===============================================
                  SUBMIT
              =============================================== */}

              <button
                type="submit"
                disabled={pending}
                className={`
                  flex w-full items-center justify-center gap-2
                  rounded-[11px] bg-[#155dff]
                  px-4 font-bold text-white
                  shadow-[0_8px_20px_rgba(21,93,255,0.17)]
                  transition hover:bg-[#0f52eb]
                  disabled:cursor-not-allowed disabled:opacity-65
                  ${
                    isSignup
                      ? "mt-4 h-[42px] text-[11px]"
                      : "mt-5 h-[46px] text-[12px]"
                  }
                `}
              >
                {pending ? (
                  <>
                    <LoaderCircle
                      size={15}
                      className="animate-spin"
                    />

                    Please wait
                  </>
                ) : (
                  <>
                    {isSignup
                      ? "Create account"
                      : isReset
                        ? "Send reset link"
                        : "Continue"}

                    <ArrowRight
                      size={14}
                    />
                  </>
                )}
              </button>
            </form>

            {/* =================================================
                INSTITUTION NOTE
            ================================================= */}

            <div
              className={`
                border-t border-[#e9ecf1] text-center
                ${
                  isSignup
                    ? "mt-4 pt-3"
                    : "mt-6 pt-5"
                }
              `}
            >
              <p className="text-[9px] leading-4 text-[#8b94a4]">
                Institution staff
                accounts are provided
                by their registered
                organization.
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
