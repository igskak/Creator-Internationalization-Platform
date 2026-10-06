"use client";

import { UploadIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { FieldBlock, selectClass } from "@/components/knowledge/field-block";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useAction } from "@/hooks/use-action";
import { useI18n } from "@/lib/i18n/provider";
import { POSTS_CSV_TEMPLATE } from "@/lib/posts-template";
import { importHistoricalPostsFile } from "@/server/actions/knowledge";

const LANGUAGES = ["ru", "en", "uk"] as const;

/** Import dialog: the file is read in the browser and sent as text; J16 does the rest. */
export function PostsImport({ isOwner }: { isOwner: boolean }) {
  const { locale, messages } = useI18n();
  const t = messages.posts.import;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [handle, setHandle] = useState("");
  const [language, setLanguage] = useState("ru");
  const [allowAi, setAllowAi] = useState(false);
  const [suggest, setSuggest] = useState(false);
  const [reading, setReading] = useState(false);
  const names = new Intl.DisplayNames(locale, { type: "language" });
  const run = useAction(importHistoricalPostsFile, {
    onSuccess: () => {
      setOpen(false);
      setFile(null);
      toast.success(t.started);
      router.refresh();
    },
  });

  const submit = async () => {
    if (!file) return;
    setReading(true);
    try {
      const text = await file.text();
      await run.run({
        fileName: file.name,
        text,
        accountHandle: handle,
        language,
        allowAiProcessing: allowAi,
        suggestAnnotations: allowAi && suggest,
      });
    } catch {
      toast.error(t.readError);
    } finally {
      setReading(false);
    }
  };

  const template = () => {
    const url = URL.createObjectURL(new Blob([`﻿${POSTS_CSV_TEMPLATE}\n`], { type: "text/csv" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "historical-posts-template.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>
        <UploadIcon /> {t.button}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.title}</DialogTitle>
          <DialogDescription>{t.description}</DialogDescription>
        </DialogHeader>
        <FieldBlock label={t.file} htmlFor="posts-file" error={run.fieldErrors?.file?.[0]}>
          <Input
            id="posts-file"
            type="file"
            accept=".csv,.json,text/csv,application/json"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
        </FieldBlock>
        <FieldBlock
          label={t.handle}
          htmlFor="posts-handle"
          hint={t.handleHint}
          error={run.fieldErrors?.accountHandle?.[0]}
        >
          <Input
            id="posts-handle"
            value={handle}
            onChange={(event) => setHandle(event.target.value)}
          />
        </FieldBlock>
        <FieldBlock label={t.language} htmlFor="posts-language">
          <select
            id="posts-language"
            className={selectClass}
            value={language}
            onChange={(event) => setLanguage(event.target.value)}
          >
            {LANGUAGES.map((code) => (
              <option key={code} value={code}>
                {names.of(code) ?? code}
              </option>
            ))}
          </select>
        </FieldBlock>
        <div className="flex flex-col gap-2">
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 size-4 accent-primary"
              checked={allowAi}
              disabled={!isOwner}
              onChange={(event) => {
                setAllowAi(event.target.checked);
                if (!event.target.checked) setSuggest(false);
              }}
            />
            <span>
              {t.allowAi}
              <span className="block text-xs text-muted-foreground">{t.allowAiHint}</span>
            </span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={suggest}
              disabled={!allowAi}
              onChange={(event) => setSuggest(event.target.checked)}
            />
            {t.suggest}
          </label>
        </div>
        <button
          type="button"
          onClick={template}
          className="w-fit text-sm underline underline-offset-4 hover:text-foreground"
        >
          {t.template}
        </button>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={run.pending}>
            {t.cancel}
          </Button>
          <Button onClick={submit} disabled={!file || !handle.trim() || run.pending || reading}>
            {run.pending || reading ? t.submitting : t.submit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
