"use server";

import { isEmailAllowed } from "@rc/modules/core";
import { z } from "zod";
import { requestMagicLinkFor } from "@/server/auth/rules";
import { requestContext } from "@/server/context";
import { supabaseServer } from "@/server/supabase";

export type MagicLinkState = { status: "idle" | "sent" | "invalid" | "error" };

const Email = z.email();

/** 05 §5.2 requestMagicLink: always "sent"; only allowlisted, active users get an email. */
export async function requestMagicLink(
  _prev: MagicLinkState,
  formData: FormData,
): Promise<MagicLinkState> {
  const parsed = Email.safeParse(String(formData.get("email") ?? "").trim());
  if (!parsed.success) return { status: "invalid" };

  const ctx = await requestContext({ type: "SYSTEM" });
  try {
    const supabase = await supabaseServer();
    const result = await requestMagicLinkFor(parsed.data, {
      isAllowed: (email) => isEmailAllowed(ctx, email),
      send: async (email) => {
        // shouldCreateUser: false — sign-ups are disabled; users are created by the owner.
        const { error } = await supabase.auth.signInWithOtp({
          email,
          options: { shouldCreateUser: false },
        });
        if (error) throw error;
      },
    });
    ctx.logger.info({ delivered: result.delivered }, "magic link requested");
    return { status: "sent" };
  } catch (error) {
    ctx.logger.error({ err: error }, "magic link request failed");
    return { status: "error" };
  }
}
