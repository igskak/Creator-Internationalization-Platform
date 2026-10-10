"use client";

import { useRouter } from "next/navigation";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useI18n } from "@/lib/i18n/provider";
import { getStatuses } from "@/server/actions/statuses";

// What the field editors of one market's draft share (plan 10 §10.3): the lock version that every
// edit sends, whether editing is allowed, the confirmation before an approval is undone, the
// "someone changed this" state, which slide is open, and focusing a field from the critic panel.

export type TemplateInfo = Record<
  string,
  {
    textSlots: { name: string; maxChars: number; maxLines: number; required: boolean }[];
    imageSlots: string[];
  }
>;

export type ConfirmKind = "approved" | "scheduled" | "failed";

export type PendingRegenerationView = {
  reviewEventId: string;
  field: string;
  original: unknown;
  edited: unknown;
};

type VariantState = {
  variantId: string;
  lockVersion: number;
  setLockVersion: (lockVersion: number) => void;
  /** Null when the person may edit; else why not. */
  editBlocker: string | null;
  confirmKind: ConfirmKind | null;
  /** True at once when no confirmation is needed; else asks and resolves with the answer. */
  askConfirm: () => Promise<boolean>;
  reasons: { code: string; label: string }[];
  templates: TemplateInfo;
  conflict: boolean;
  setConflict: (conflict: boolean) => void;
  /** Polls until the draft changes (a regeneration landed); false after the time limit. */
  waitForChange: (fromLock: number) => Promise<boolean>;
  openSlide: string | null;
  setOpenSlide: (slideId: string | null) => void;
  /** Scrolls to a field (opening its slide) and flashes it. */
  focusField: (path: string) => void;
  regenerations: ReadonlyMap<string, PendingRegenerationView>;
};

const Context = createContext<VariantState | null>(null);

export function useVariant(): VariantState {
  const value = useContext(Context);
  if (!value) throw new Error("useVariant must be used inside <VariantProvider>.");
  return value;
}

export const fieldDomId = (variantId: string, path: string) => `field-${variantId}-${path}`;

const POLL_MS = 2500;
const POLL_LIMIT_MS = 120_000;

export function VariantProvider({
  variantId,
  lockVersion,
  editBlocker,
  confirmKind,
  reasons,
  templates,
  regenerations,
  children,
}: {
  variantId: string;
  lockVersion: number;
  editBlocker: string | null;
  confirmKind: ConfirmKind | null;
  reasons: { code: string; label: string }[];
  templates: TemplateInfo;
  regenerations: PendingRegenerationView[];
  children: ReactNode;
}) {
  const { messages } = useI18n();
  const t = messages.review.edit.confirm;
  const router = useRouter();
  const [lock, setLock] = useState(lockVersion);
  const [conflict, setConflict] = useState(false);
  const [openSlide, setOpenSlide] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const answer = useRef<((ok: boolean) => void) | null>(null);

  // A refreshed page brings the server's lock version; it wins over the local guess.
  useEffect(() => {
    setLock(lockVersion);
    setConflict(false);
  }, [lockVersion]);

  const askConfirm = useCallback(() => {
    if (!confirmKind) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      answer.current = resolve;
      setAsking(true);
    });
  }, [confirmKind]);
  const settle = (ok: boolean) => {
    setAsking(false);
    answer.current?.(ok);
    answer.current = null;
  };

  const waitForChange = useCallback(
    async (fromLock: number) => {
      const started = Date.now();
      while (Date.now() - started < POLL_LIMIT_MS) {
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
        const result = await getStatuses({ variantIds: [variantId] }).catch(() => null);
        const entry = result?.ok ? result.data[variantId] : undefined;
        if (entry?.lockVersion !== undefined && entry.lockVersion > fromLock) {
          router.refresh();
          return true;
        }
      }
      return false;
    },
    [router, variantId],
  );

  const focusField = useCallback(
    (path: string) => {
      const slideId = /^slides\.([^.]+)/.exec(path)?.[1];
      if (slideId) setOpenSlide(slideId);
      // The slide drawer renders after the state change; look for the field then.
      setTimeout(() => {
        const el = document.getElementById(fieldDomId(variantId, path));
        if (!el) return;
        el.scrollIntoView({ block: "center", behavior: "smooth" });
        el.classList.add("ring-2", "ring-ring", "rounded-md");
        setTimeout(() => el.classList.remove("ring-2", "ring-ring"), 2000);
      }, 50);
    },
    [variantId],
  );

  const value = useMemo<VariantState>(
    () => ({
      variantId,
      lockVersion: lock,
      setLockVersion: setLock,
      editBlocker,
      confirmKind,
      askConfirm,
      reasons,
      templates,
      conflict,
      setConflict,
      waitForChange,
      openSlide,
      setOpenSlide,
      focusField,
      regenerations: new Map(regenerations.map((r) => [r.field, r])),
    }),
    [
      variantId,
      lock,
      editBlocker,
      confirmKind,
      askConfirm,
      reasons,
      templates,
      conflict,
      waitForChange,
      openSlide,
      focusField,
      regenerations,
    ],
  );

  return (
    <Context value={value}>
      {children}
      <Dialog open={asking} onOpenChange={(open) => (open ? null : settle(false))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.title}</DialogTitle>
            <DialogDescription>{confirmKind ? t[confirmKind] : ""}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => settle(false)}>
              {messages.review.edit.cancel}
            </Button>
            <Button type="button" onClick={() => settle(true)}>
              {t.submit}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Context>
  );
}
