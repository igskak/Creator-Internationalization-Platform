"use client";

import { useRef } from "react";
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

export type ShellUser = { email: string; displayName: string | null; role: string };

/** User menu: who is signed in, their role, sign out (POST /auth/sign-out). */
export function UserMenu({ user }: { user: ShellUser }) {
  const signOutForm = useRef<HTMLFormElement>(null);
  const name = user.displayName ?? user.email;
  return (
    <>
      <form ref={signOutForm} action="/auth/sign-out" method="post" hidden />
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="sm" aria-label="User menu" />}>
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
                <span className="text-xs font-normal text-muted-foreground">Role: {user.role}</span>
              </div>
            </DropdownMenuLabel>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => signOutForm.current?.requestSubmit()}>
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
