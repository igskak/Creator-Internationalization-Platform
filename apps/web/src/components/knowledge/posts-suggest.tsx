"use client";

import { SparklesIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAction } from "@/hooks/use-action";
import { format } from "@/lib/i18n/format";
import { useI18n } from "@/lib/i18n/provider";
import { suggestPostAnnotations } from "@/server/actions/knowledge";

/** Asks the model for annotation suggestions for the posts that have none (J17). */
export function PostsSuggest({ unannotated }: { unannotated: number }) {
  const t = useI18n().messages.posts.suggest;
  const router = useRouter();
  const run = useAction(suggestPostAnnotations, {
    onSuccess: ({ requested }) => {
      toast.success(format(t.started, { count: requested }));
      router.refresh();
    },
  });
  return (
    <Button
      size="sm"
      variant="outline"
      title={unannotated === 0 ? t.none : t.hint}
      disabled={unannotated === 0 || run.pending}
      onClick={() => run.run({})}
    >
      <SparklesIcon /> {t.button}
    </Button>
  );
}
