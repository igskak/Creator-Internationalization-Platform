"use client";

import { ExternalLinkIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAction } from "@/hooks/use-action";
import { format } from "@/lib/i18n/format";
import { useI18n } from "@/lib/i18n/provider";
import { getSourceDownloadUrl } from "@/server/actions/sources";

/**
 * Opens the source PDF at a page in a new tab. The link is a presigned URL that lives for ten
 * minutes, so it is made when the button is pressed. The tab is opened at once (a browser allows
 * that only inside the click) and sent to the link when the server has answered.
 */
export function OpenPdfButton({ sourceAssetId, page }: { sourceAssetId: string; page: number }) {
  const { messages } = useI18n();
  const open = useAction(getSourceDownloadUrl);
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={open.pending}
      onClick={async () => {
        const tab = window.open("about:blank", "_blank");
        if (tab) tab.opener = null;
        const result = await open.run({ sourceAssetId, page });
        if (!tab) return;
        if (result.ok) tab.location.href = result.data.url;
        else tab.close();
      }}
    >
      <ExternalLinkIcon />
      {open.pending
        ? messages.card.evidence.opening
        : format(messages.card.evidence.openPdf, { page })}
    </Button>
  );
}
