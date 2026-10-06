"use client";

import { PlusIcon } from "lucide-react";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/hooks/use-action";
import { format } from "@/lib/i18n/format";
import { useI18n } from "@/lib/i18n/provider";
import { uploadWithProgress } from "@/lib/source-upload";
import { cn } from "@/lib/utils";
import {
  completeSourceUpload,
  createSourceUpload,
  createTextSource,
} from "@/server/actions/sources";

const FILE_TYPES = ["BOOK", "GUIDE", "RECIPE", "PRODUCT_MATERIAL", "NOTE", "TRANSCRIPT"] as const;
const TEXT_TYPES = ["NOTE", "TRANSCRIPT", "RECIPE"] as const;
const LANGUAGES = ["ru", "en", "es", "uk"] as const;

export type SourceUploadConfig = {
  /** Rights pre-filled per source type (Settings → Rights). */
  defaults: Record<string, RightsValue>;
  /** Accepted extensions and the size limit in MB, per source type. */
  formats: Record<string, { extensions: string[]; maxMb: number }>;
  maxTextChars: number;
};

const MIME: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain",
  md: "text/markdown",
  srt: "application/x-subrip",
  vtt: "text/vtt",
};
const extensionOf = (name: string) => name.split(".").pop()?.toLowerCase() ?? "";

/** Upload dialog: a file (presigned PUT with progress) or pasted text, with the rights matrix. */
export function SourceUpload({ config }: { config: SourceUploadConfig }) {
  const { locale, messages } = useI18n();
  const t = messages.sources;
  const u = t.upload;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"file" | "text">("file");
  const [type, setType] = useState<string>("GUIDE");
  const [title, setTitle] = useState("");
  const [language, setLanguage] = useState("ru");
  const [author, setAuthor] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [rights, setRights] = useState<RightsValue>(() => rightsFor(config, "GUIDE"));
  const [percent, setPercent] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const names = new Intl.DisplayNames(locale, { type: "language" });

  const createUpload = useAction(createSourceUpload, { toastOnError: false });
  const complete = useAction(completeSourceUpload);
  const pasted = useAction(createTextSource);
  const fieldErrors = { ...createUpload.fieldErrors, ...pasted.fieldErrors };

  const types = mode === "file" ? FILE_TYPES : TEXT_TYPES;
  const chooseType = (next: string) => {
    setType(next);
    setRights(rightsFor(config, next));
  };
  const chooseMode = (next: "file" | "text") => {
    setMode(next);
    if (!(next === "file" ? FILE_TYPES : TEXT_TYPES).includes(type as never)) chooseType("NOTE");
  };
  const format_ = config.formats[type];
  const finish = (status: "QUEUED" | "BLOCKED") => {
    toast[status === "BLOCKED" ? "warning" : "success"](
      status === "BLOCKED" ? u.blocked : u.started,
    );
    setOpen(false);
    setFile(null);
    setText("");
    setTitle("");
    router.refresh();
  };

  const submit = async () => {
    setBusy(true);
    setPercent(null);
    try {
      if (mode === "text") {
        const result = await pasted.run({
          type: type as (typeof TEXT_TYPES)[number],
          title,
          text,
          originalLanguage: language,
          ...(author.trim() ? { sourceAuthor: author.trim() } : {}),
          rights,
        });
        if (result.ok) finish(result.data.status);
        return;
      }
      if (!file) return;
      const created = await createUpload.run({
        type: type as (typeof FILE_TYPES)[number],
        title,
        fileName: file.name,
        mimeType: MIME[extensionOf(file.name)] ?? (file.type || "application/octet-stream"),
        sizeBytes: file.size,
        originalLanguage: language,
        ...(author.trim() ? { sourceAuthor: author.trim() } : {}),
        rights,
      });
      if (!created.ok) {
        toast.error(created.error.message);
        return;
      }
      setPercent(0);
      try {
        await uploadWithProgress(
          created.data.uploadUrl,
          created.data.uploadHeaders,
          file,
          setPercent,
        );
      } catch {
        toast.error(u.uploadFailed);
        return;
      }
      const done = await complete.run({ sourceAssetId: created.data.sourceAssetId });
      if (done.ok) finish(done.data.status);
    } finally {
      setBusy(false);
      setPercent(null);
    }
  };

  const ready =
    title.trim() !== "" && (mode === "file" ? file !== null : text.trim() !== "") && !busy;

  return (
    <Dialog open={open} onOpenChange={(value) => !busy && setOpen(value)}>
      <DialogTrigger render={<Button size="sm" />}>
        <PlusIcon /> {t.add}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{u.title}</DialogTitle>
          <DialogDescription>{u.description}</DialogDescription>
        </DialogHeader>

        <div role="tablist" className="flex gap-1">
          {(["file", "text"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              onClick={() => chooseMode(m)}
              className={cn(
                "rounded-full border px-3 py-1 text-sm",
                mode === m && "border-foreground/30 bg-muted font-medium",
              )}
            >
              {m === "file" ? u.tabFile : u.tabText}
            </button>
          ))}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <FieldBlock label={u.type} htmlFor="source-type" error={fieldErrors.type?.[0]}>
            <select
              id="source-type"
              className={selectClass}
              value={type}
              onChange={(event) => chooseType(event.target.value)}
            >
              {types.map((value) => (
                <option key={value} value={value}>
                  {t.types[value]}
                </option>
              ))}
            </select>
          </FieldBlock>
          <FieldBlock label={u.language} htmlFor="source-language">
            <select
              id="source-language"
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
        </div>
        <FieldBlock label={u.name} htmlFor="source-title" error={fieldErrors.title?.[0]}>
          <Input
            id="source-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </FieldBlock>
        <FieldBlock label={u.author} htmlFor="source-author">
          <Input
            id="source-author"
            value={author}
            onChange={(event) => setAuthor(event.target.value)}
          />
        </FieldBlock>

        {mode === "file" ? (
          <FieldBlock
            label={u.file}
            htmlFor="source-file"
            hint={
              format_
                ? format(u.fileHint, {
                    formats: format_.extensions.map((e) => `.${e}`).join(", "),
                    max: format_.maxMb,
                  })
                : undefined
            }
            error={fieldErrors.fileName?.[0] ?? fieldErrors.sizeBytes?.[0]}
          >
            <Input
              id="source-file"
              type="file"
              accept={format_?.extensions.map((e) => `.${e}`).join(",")}
              onChange={(event) => {
                const picked = event.target.files?.[0] ?? null;
                setFile(picked);
                if (picked && !title.trim()) setTitle(picked.name.replace(/\.[^.]+$/, ""));
              }}
            />
          </FieldBlock>
        ) : (
          <FieldBlock
            label={u.text}
            htmlFor="source-text"
            hint={format(u.textHint, { max: config.maxTextChars.toLocaleString(locale) })}
            error={fieldErrors.text?.[0]}
          >
            <Textarea
              id="source-text"
              rows={6}
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
          </FieldBlock>
        )}

        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium">{u.rights}</legend>
          <RightsMatrix value={rights} onChange={setRights} disabled={busy} />
          <p className="text-xs text-muted-foreground">{u.rightsHint}</p>
        </fieldset>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
            {u.cancel}
          </Button>
          <Button onClick={submit} disabled={!ready}>
            {busy ? (percent === null ? u.finishing : format(u.uploading, { percent })) : u.submit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function rightsFor(config: SourceUploadConfig, type: string): RightsValue {
  const d = config.defaults[type];
  return {
    use: d?.use ?? "UNKNOWN",
    translate: d?.translate ?? "UNKNOWN",
    adapt: d?.adapt ?? "UNKNOWN",
    visuallyTransform: d?.visuallyTransform ?? "UNKNOWN",
    sell: d?.sell ?? "UNKNOWN",
    aiProcessing: d?.aiProcessing ?? "UNKNOWN",
    improvePrompts: d?.improvePrompts ?? "UNKNOWN",
  };
}
