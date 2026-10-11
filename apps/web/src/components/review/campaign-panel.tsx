"use client";

import type { CampaignView } from "@rc/modules/content";
import { CopyIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { format } from "@/lib/i18n/format";
import { useI18n } from "@/lib/i18n/provider";

function CopyRow({ label, value, empty }: { label: string; value: string | null; empty: string }) {
  const t = useI18n().messages.review.campaign;
  const copy = async () => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      toast.success(t.copied);
    } catch {
      toast.error(t.copyFailed);
    }
  };
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {value ? (
        <span className="flex items-start justify-between gap-2">
          <code className="min-w-0 break-all rounded bg-muted px-1.5 py-0.5 text-xs">{value}</code>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={format(t.copy, { what: label })}
            onClick={() => void copy()}
          >
            <CopyIcon />
          </Button>
        </span>
      ) : (
        <span className="text-sm text-muted-foreground">{empty}</span>
      )}
    </div>
  );
}

/**
 * What the ManyChat flow of a commercial post is set up with (plan 11 §11.7, M4-11): the keyword,
 * the link with its UTM tags and the flow name (the campaign id), each with a copy button.
 */
export function CampaignPanel({ campaign }: { campaign: CampaignView | null }) {
  const t = useI18n().messages.review.campaign;
  return (
    <section
      aria-label={t.title}
      data-testid="campaign-panel"
      className="flex flex-col gap-2 rounded-lg border p-3 text-sm"
    >
      <h4 className="font-medium">{t.title}</h4>
      {campaign ? (
        <>
          <CopyRow label={t.keyword} value={campaign.keyword} empty={t.noKeyword} />
          <CopyRow label={t.link} value={campaign.url} empty={t.noLink} />
          <CopyRow label={t.flow} value={campaign.campaignId} empty="" />
          <p className="text-xs text-muted-foreground">{t.flowHint}</p>
        </>
      ) : (
        <p className="text-muted-foreground">{t.pending}</p>
      )}
    </section>
  );
}
