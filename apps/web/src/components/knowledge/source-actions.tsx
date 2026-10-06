"use client";

import { ArchiveIcon, DownloadIcon, RefreshCwIcon, ShieldIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { FieldBlock, selectClass } from "@/components/knowledge/field-block";
import { RightsMatrix, type RightsValue } from "@/components/knowledge/rights-matrix";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/hooks/use-action";
import { useI18n } from "@/lib/i18n/provider";
import {
  archiveSource,
  getSourceDownloadUrl,
  reprocessSource,
  updateSourceRights,
} from "@/server/actions/sources";

type RightsStatus = "UNKNOWN" | "PENDING_REVIEW" | "CLEARED" | "RESTRICTED";
const RIGHTS_STATUSES: RightsStatus[] = ["UNKNOWN", "PENDING_REVIEW", "CLEARED", "RESTRICTED"];

/** Download, process again, archive and (owner) edit rights of one source. */
export function SourceActions({
  id,
  status,
  hasFile,
  rights,
  rightsStatus,
  role,
}: {
  id: string;
  status: string;
  hasFile: boolean;
  rights: RightsValue;
  rightsStatus: RightsStatus;
  role: string;
}) {
  const t = useI18n().messages.sources;
  const router = useRouter();
  const isOwner = role === "owner";
  const [dialog, setDialog] = useState<null | "reprocess" | "archive" | "rights">(null);
  const [mode, setMode] = useState<"FULL" | "KNOWLEDGE_ONLY">("FULL");
  const [reason, setReason] = useState("");
  const [draft, setDraft] = useState<RightsValue>(rights);
  const [draftStatus, setDraftStatus] = useState<RightsStatus>(rightsStatus);

  const done = (message: string) => {
    setDialog(null);
    toast.success(message);
    router.refresh();
  };
  const download = useAction(getSourceDownloadUrl);
  const reprocess = useAction(reprocessSource, {
    onSuccess: () => done(t.actions.reprocessStarted),
  });
  const archive = useAction(archiveSource, { onSuccess: () => done(t.actions.archived) });
  const saveRights = useAction(updateSourceRights, { onSuccess: () => done(t.detail.rightsSaved) });
  const canReprocess = status === "READY" || status === "FAILED";

  return (
    <div className="flex flex-wrap gap-2">
      <Button
        size="sm"
        variant="outline"
        disabled={!hasFile || download.pending}
        onClick={async () => {
          const result = await download.run({ sourceAssetId: id });
          if (result.ok) window.open(result.data.url, "_blank", "noopener");
        }}
      >
        <DownloadIcon /> {t.actions.download}
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={!canReprocess || role === "chef"}
        title={canReprocess ? undefined : t.actions.cannotReprocess}
        onClick={() => setDialog("reprocess")}
      >
        <RefreshCwIcon /> {t.actions.reprocess}
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={!isOwner}
        title={isOwner ? undefined : t.detail.onlyOwner}
        onClick={() => {
          setDraft(rights);
          setDraftStatus(rightsStatus);
          setDialog("rights");
        }}
      >
        <ShieldIcon /> {t.detail.editRights}
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={!isOwner}
        title={isOwner ? undefined : t.actions.onlyOwner}
        onClick={() => setDialog("archive")}
      >
        <ArchiveIcon /> {t.actions.archive}
      </Button>

      <Dialog open={dialog === "reprocess"} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.actions.reprocessTitle}</DialogTitle>
            <DialogDescription>{t.actions.reprocessBody}</DialogDescription>
          </DialogHeader>
          <FieldBlock label={t.actions.reprocess} htmlFor="reprocess-mode">
            <select
              id="reprocess-mode"
              className={selectClass}
              value={mode}
              onChange={(event) => setMode(event.target.value as typeof mode)}
            >
              <option value="FULL">{t.actions.modeFull}</option>
              <option value="KNOWLEDGE_ONLY">{t.actions.modeKnowledge}</option>
            </select>
          </FieldBlock>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)} disabled={reprocess.pending}>
              {t.actions.cancel}
            </Button>
            <Button
              disabled={reprocess.pending}
              onClick={() => reprocess.run({ sourceAssetId: id, mode })}
            >
              {t.actions.reprocessConfirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "archive"} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.actions.archiveTitle}</DialogTitle>
            <DialogDescription>{t.actions.archiveBody}</DialogDescription>
          </DialogHeader>
          <FieldBlock
            label={t.actions.archiveReason}
            htmlFor="archive-source-reason"
            error={archive.fieldErrors?.reason?.[0]}
          >
            <Textarea
              id="archive-source-reason"
              rows={2}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </FieldBlock>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)} disabled={archive.pending}>
              {t.actions.cancel}
            </Button>
            <Button
              disabled={archive.pending || reason.trim() === ""}
              onClick={() => archive.run({ sourceAssetId: id, reason })}
            >
              {t.actions.archiveConfirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "rights"} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{t.detail.rightsTitle}</DialogTitle>
          </DialogHeader>
          <RightsMatrix value={draft} onChange={setDraft} disabled={saveRights.pending} />
          <FieldBlock label={t.detail.rightsStatus} htmlFor="rights-status">
            <select
              id="rights-status"
              className={selectClass}
              value={draftStatus}
              onChange={(event) => setDraftStatus(event.target.value as RightsStatus)}
            >
              {RIGHTS_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {t.rightsStatus[value]}
                </option>
              ))}
            </select>
          </FieldBlock>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)} disabled={saveRights.pending}>
              {t.actions.cancel}
            </Button>
            <Button
              disabled={saveRights.pending}
              onClick={() =>
                saveRights.run({ sourceAssetId: id, rights: draft, rightsStatus: draftStatus })
              }
            >
              {t.detail.rightsSave}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
