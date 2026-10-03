"use client";

import { CheckIcon } from "lucide-react";
import { useRef, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { format } from "@/lib/i18n/format";
import { LOCALE_NAMES, LOCALES } from "@/lib/i18n/locales";
import { useI18n } from "@/lib/i18n/provider";
import { setLocale } from "@/server/actions/locale";

export type ShellUser = { email: string; displayName: string | null; role: string };

/** User menu: who is signed in, their role, the interface language, sign out (POST /auth/sign-out). */
export function UserMenu({ user }: { user: ShellUser }) {
  const signOutForm = useRef<HTMLFormElement>(null);
  const { locale, messages } = useI18n();
  const [, startTransition] = useTransition();
  const name = user.displayName ?? user.email;
  return (
    <>
      <form ref={signOutForm} action="/auth/sign-out" method="post" hidden />
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="sm" aria-label={messages.shell.userMenu} />}
        >
          <span className="flex size-6 items-center justify-center rounded-full bg-muted text-xs font-medium uppercase">
            {name.charAt(0)}
          </span>
          <span className="hidden max-w-48 truncate sm:inline">{name}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-56">
          <DropdownMenuGroup>
            <DropdownMenuLabel>
              <div className="flex flex-col">
                <span className="truncate">{user.email}</span>
                <span className="text-xs font-normal text-muted-foreground">
                  {format(messages.shell.role, { role: user.role })}
                </span>
              </div>
            </DropdownMenuLabel>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
              {messages.shell.language}
            </DropdownMenuLabel>
            {LOCALES.map((code) => (
              <DropdownMenuItem
                key={code}
                lang={code}
                onClick={() => startTransition(() => setLocale(code))}
              >
                {LOCALE_NAMES[code]}
                {code === locale ? (
                  <CheckIcon aria-hidden="true" className="ml-auto size-4" />
                ) : null}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => signOutForm.current?.requestSubmit()}>
            {messages.shell.signOut}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
