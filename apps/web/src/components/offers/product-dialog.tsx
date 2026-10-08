"use client";

import { PencilIcon, PlusIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/hooks/use-action";
import { useI18n } from "@/lib/i18n/provider";
import { upsertProduct } from "@/server/actions/offers";

export const PRODUCT_TYPES = ["GUIDE", "RECIPE_COLLECTION", "COURSE", "BUNDLE", "OTHER"] as const;
export const PRODUCT_STATUSES = ["ACTIVE", "INACTIVE"] as const;

export type ProductValues = {
  id: string;
  code: string;
  name: string;
  type: (typeof PRODUCT_TYPES)[number];
  description: string | null;
  originalLanguage: string;
  sourceAssetId: string | null;
  status: (typeof PRODUCT_STATUSES)[number];
};

const EMPTY: Omit<ProductValues, "id"> = {
  code: "",
  name: "",
  type: "GUIDE",
  description: "",
  originalLanguage: "ru",
  sourceAssetId: null,
  status: "ACTIVE",
};

/** Adds or edits a product (plan 05 §5.5 upsertProduct). */
export function ProductDialog({
  product,
  materials,
}: {
  product?: ProductValues;
  materials: { id: string; title: string }[];
}) {
  const { messages } = useI18n();
  const t = messages.offers.productForm;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Omit<ProductValues, "id">>(product ?? EMPTY);
  const { run, pending, fieldErrors, error } = useAction(upsertProduct, {
    toastOnError: false,
    successMessage: product ? t.saved : t.created,
    onSuccess: () => {
      setOpen(false);
      if (!product) setValues(EMPTY);
      router.refresh();
    },
  });
  const set = <K extends keyof typeof values>(key: K, value: (typeof values)[K]) =>
    setValues((current) => ({ ...current, [key]: value }));

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setValues(product ?? EMPTY);
      }}
    >
      <DialogTrigger
        render={
          <Button size="sm" variant={product ? "ghost" : "default"}>
            {product ? <PencilIcon /> : <PlusIcon />}
            {product ? messages.offers.editProduct : messages.offers.addProduct}
          </Button>
        }
      />
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{product ? t.editTitle : t.createTitle}</DialogTitle>
          <DialogDescription>{t.description}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void run({
              ...(product ? { id: product.id } : {}),
              ...values,
              description: values.description?.trim() || null,
            });
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <FieldBlock
              label={t.code}
              htmlFor="product-code"
              hint={t.codeHint}
              error={fieldErrors?.code?.[0]}
            >
              <Input
                id="product-code"
                value={values.code}
                maxLength={60}
                onChange={(ev) => set("code", ev.target.value)}
              />
            </FieldBlock>
            <FieldBlock label={t.name} htmlFor="product-name" error={fieldErrors?.name?.[0]}>
              <Input
                id="product-name"
                value={values.name}
                maxLength={200}
                onChange={(ev) => set("name", ev.target.value)}
              />
            </FieldBlock>
            <FieldBlock label={t.type} htmlFor="product-type">
              <select
                id="product-type"
                className={selectClass}
                value={values.type}
                onChange={(ev) => set("type", ev.target.value as ProductValues["type"])}
              >
                {PRODUCT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {messages.offers.productType[type]}
                  </option>
                ))}
              </select>
            </FieldBlock>
            <FieldBlock
              label={t.language}
              htmlFor="product-language"
              hint={t.languageHint}
              error={fieldErrors?.originalLanguage?.[0]}
            >
              <Input
                id="product-language"
                value={values.originalLanguage}
                maxLength={2}
                className="w-24"
                onChange={(ev) => set("originalLanguage", ev.target.value.toLowerCase())}
              />
            </FieldBlock>
          </div>
          <FieldBlock
            label={t.descriptionField}
            htmlFor="product-description"
            error={fieldErrors?.description?.[0]}
          >
            <Textarea
              id="product-description"
              rows={3}
              maxLength={2000}
              value={values.description ?? ""}
              onChange={(ev) => set("description", ev.target.value)}
            />
          </FieldBlock>
          <div className="grid gap-4 sm:grid-cols-2">
            <FieldBlock
              label={t.material}
              htmlFor="product-material"
              hint={t.materialHint}
              error={fieldErrors?.sourceAssetId?.[0]}
            >
              <select
                id="product-material"
                className={selectClass}
                value={values.sourceAssetId ?? ""}
                onChange={(ev) => set("sourceAssetId", ev.target.value || null)}
              >
                <option value="">{t.materialNone}</option>
                {materials.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.title}
                  </option>
                ))}
              </select>
            </FieldBlock>
            <FieldBlock label={t.status} htmlFor="product-status">
              <select
                id="product-status"
                className={selectClass}
                value={values.status}
                onChange={(ev) => set("status", ev.target.value as ProductValues["status"])}
              >
                {PRODUCT_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {messages.offers.productStatus[status]}
                  </option>
                ))}
              </select>
            </FieldBlock>
          </div>
          {error && !fieldErrors ? (
            <p role="alert" className="text-sm text-destructive">
              {error.message}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {t.cancel}
            </Button>
            <Button type="submit" disabled={pending}>
              {t.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
