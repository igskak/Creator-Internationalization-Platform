"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { type MagicLinkState, requestMagicLink } from "./actions";

const messages: Record<MagicLinkState["status"], string | null> = {
  idle: null,
  sent: "If this email has access, a sign-in link is on its way. It expires in one hour.",
  invalid: "Enter a valid email address.",
  error: "Could not send the link. Try again in a minute.",
};

const initialState: MagicLinkState = { status: "idle" };

export function LoginForm() {
  const [state, action, pending] = useActionState(requestMagicLink, initialState);
  const message = messages[state.status];
  return (
    <form action={action} className="flex flex-col gap-3">
      <Label htmlFor="email">Email</Label>
      <Input
        id="email"
        name="email"
        type="email"
        autoComplete="email"
        required
        disabled={pending}
      />
      <Button type="submit" disabled={pending}>
        {pending ? "Sending…" : "Send sign-in link"}
      </Button>
      {message && (
        <p role="status" className="text-sm text-muted-foreground">
          {message}
        </p>
      )}
    </form>
  );
}
