"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

/* =========================================================
   TYPES
========================================================= */

export type AuthState = {
  error?: string;
  message?: string;
};

/* =========================================================
   HELPERS
========================================================= */

function getString(
  formData: FormData,
  key: string
) {
  const value =
    formData.get(key);

  if (
    typeof value !== "string"
  ) {
    return "";
  }

  return value.trim();
}

/* =========================================================
   LOGIN
========================================================= */

export async function login(
  previousState: AuthState,
  formData: FormData
): Promise<AuthState> {
  const email =
    getString(
      formData,
      "email"
    );

  const password =
    getString(
      formData,
      "password"
    );

  if (
    !email ||
    !password
  ) {
    return {
      error:
        "Enter your email and password.",
    };
  }

  const supabase =
    await createClient();

  const {
    error,
  } =
    await supabase.auth.signInWithPassword(
      {
        email,
        password,
      }
    );

  if (error) {
    console.warn(
      "Supabase login failed",
      {
        code: error.code,
        status: error.status,
        message: error.message,
      }
    );

    if (
      error.message
        .toLowerCase()
        .includes("fetch failed")
    ) {
      return {
        error:
          "Sauti1 could not reach Supabase Auth. Check the local dev server network access and try again.",
      };
    }

    if (
      error.message
        .toLowerCase()
        .includes("email not confirmed")
    ) {
      return {
        error:
          "This account still needs email confirmation. Open the confirmation email, then try again.",
      };
    }

    return {
      error:
        "Invalid email or password. Check the account details and try again.",
    };
  }

  revalidatePath(
    "/",
    "layout"
  );

  redirect(
    "/auth/route"
  );
}

/* =========================================================
   CITIZEN SIGNUP
========================================================= */

export async function signup(
  previousState: AuthState,
  formData: FormData
): Promise<AuthState> {
  const fullName =
    getString(
      formData,
      "fullName"
    );

  const email =
    getString(
      formData,
      "email"
    );

  const password =
    getString(
      formData,
      "password"
    );

  const confirmPassword =
    getString(
      formData,
      "confirmPassword"
    );

  if (!fullName) {
    return {
      error:
        "Enter your name.",
    };
  }

  if (!email) {
    return {
      error:
        "Enter your email address.",
    };
  }

  if (
    !password ||
    password.length < 8
  ) {
    return {
      error:
        "Your password must be at least 8 characters.",
    };
  }

  if (
    password !==
    confirmPassword
  ) {
    return {
      error:
        "The passwords do not match.",
    };
  }

  const supabase =
    await createClient();

  const {
    data,
    error,
  } =
    await supabase.auth.signUp(
      {
        email,
        password,

        options: {
          data: {
            full_name:
              fullName,
          },
        },
      }
    );

  if (error) {
    return {
      error:
        error.message,
    };
  }

  /*
   * During development we are disabling
   * Confirm Email in Supabase.
   *
   * That means signUp returns a session
   * immediately.
   */

  if (data.session) {
    revalidatePath(
      "/",
      "layout"
    );

    redirect(
      "/auth/route"
    );
  }

  /*
   * This remains here for later when
   * email confirmation is re-enabled.
   */

  return {
    message:
      "Account created. Check your email to continue.",
  };
}

export async function requestPasswordReset(
  _previousState: AuthState,
  formData: FormData
): Promise<AuthState> {
  const email = getString(formData, "email");
  if (!email) return { error: "Enter your email address." };

  const requestHeaders = await headers();
  const origin = requestHeaders.get("origin");
  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: origin ? `${origin}/auth/confirm?next=/auth/reset-password` : undefined,
  });

  if (error) {
    console.warn("Supabase password recovery failed", {
      code: error.code,
      status: error.status,
      message: error.message,
    });
    if (/rate|email sending|fetch failed/i.test(error.message)) {
      return { error: "The recovery email could not be sent right now. Please try again shortly." };
    }
  }

  return { message: "If an account exists for that email, a password reset link has been sent." };
}
