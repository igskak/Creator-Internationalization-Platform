"use client";

import { SparklesIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAction } from "@/hooks/use-action";
import { useI18n } from "@/lib/i18n/provider";
import { generateVariants } from "@/server/actions/content";

/** The empty state's action: writes the drafts of every active market. */
export function GenerateDraftsButton({ ideaId }: { ideaId: string }) {
  const { messages } = useI18n();
  const t = messages.review;
  const router = useRouter();
  const { run, pending } = useAction(generateVariants, {
    onSuccess: () => {
      toast.success(t.queued);
      router.refresh();
    },
  });
  return (
    <Button disabled={pending} onClick={() => void run({ masterIdeaId: ideaId })}>
      <SparklesIcon /> {t.generate}
    </Button>
  );
}
