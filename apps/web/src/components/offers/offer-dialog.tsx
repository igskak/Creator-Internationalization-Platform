"use client";

import type { OfferWarning } from "@rc/modules/offers";
import { PencilIcon, PlusIcon } from "lucide-react";
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
import { format } from "@/lib/i18n/format";
import { useI18n } from "@/lib/i18n/provider";
import { upsertOffer } from "@/server/actions/offers";

const OFFER_TYPES = ["LEAD_MAGNET", "PAID_PRODUCT", "BUNDLE"] as const;
const OFFER_STATUSES = ["DRAFT", "ACTIVE", "PAUSED", "RETIRED"] as const;

export type OfferValues = {
  id: string;
  marketId: string;
  name: string;
  type: (typeof OFFER_TYPES)[number];
  price: string | null;
  currency: string;
  landingUrl: string | null;
  defaultKeyword: string | null;
  priority: number;
  status: (typeof OFFER_STATUSES)[number];
};

type Form = {
  marketId: string;
  name: string;
  type: OfferValues["type"];
  price: string;
  currency: string;
  landingUrl: string;
  defaultKeyword: string;
  priority: string;
  status: OfferValues["status"];
};

type MarketChoice = { id: string; code: string; displayName: string; currency: string };

const toForm = (offer: OfferValues | undefined, markets: MarketChoice[]): Form => ({
  marketId: offer?.marketId ?? markets[0]?.id ?? "",
  name: offer?.name ?? "",
  type: offer?.type ?? "PAID_PRODUCT",
  price: offer?.price ?? "",
  currency: offer?.currency ?? markets[0]?.currency ?? "EUR",
  landingUrl: offer?.landingUrl ?? "",
  defaultKeyword: offer?.defaultKeyword ?? "",
  priority: String(offer?.priority ?? 0),
  status: offer?.status ?? "DRAFT",
});

/** Adds or edits the offer of a product in one market (plan 05 §5.5 upsertOffer). */
export function OfferDialog({
  productId,
  productName,
  offer,
  markets,
}: {
  productId: string;
  productName: string;
  offer?: OfferValues;
  markets: MarketChoice[];
}) {
  const { messages } = useI18n();
  const t = messages.offers.offerForm;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Form>(() => toForm(offer, markets));
  const set = <K extends keyof Form>(key: K, value: Form[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const warn = (warning: OfferWarning) =>
    warning.code === "CURRENCY_MISMATCH"
      ? format(t.currencyMismatch, {
          currency: warning.currency,
          market: warning.marketCode,
          marketCurrency: warning.marketCurrency,
        })
      : t.noLanding;

  const { run, pending, fieldErrors, error } = useAction(upsertOffer, {
    toastOnError: false,
    successMessage: offer ? t.saved : t.created,
    onSuccess: ({ warnings }) => {
      setOpen(false);
      for (const warning of warnings) toast.warning(t.warningTitle, { description: warn(warning) });
      router.refresh();
    },
  });

  // Picking a market suggests its currency; the person can still change it.
  const pickMarket = (marketId: string) =>
    setForm((current) => ({
      ...current,
      marketId,
      currency: markets.find((m) => m.id === marketId)?.currency ?? current.currency,
    }));

  const submit = () => {
    const price = form.price.trim().replace(",", ".");
    void run({
      ...(offer ? { id: offer.id } : {}),
      marketId: form.marketId,
      productId,
      name: form.name,
      type: form.type,
      price: price === "" ? null : Number(price),
      currency: form.currency,
      landingUrl: form.landingUrl,
      defaultKeyword: form.defaultKeyword,
      priority: Number(form.priority) || 0,
      status: form.status,
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setForm(toForm(offer, markets));
      }}
    >
      <DialogTrigger
        render={
          <Button size="sm" variant={offer ? "ghost" : "outline"}>
            {offer ? <PencilIcon /> : <PlusIcon />}
            {offer ? messages.offers.editOffer : messages.offers.addOffer}
          </Button>
        }
      />
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{offer ? t.editTitle : t.createTitle}</DialogTitle>
          <DialogDescription>{format(t.description, { product: productName })}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <FieldBlock label={t.market} htmlFor="offer-market" error={fieldErrors?.marketId?.[0]}>
              <select
                id="offer-market"
                className={selectClass}
                value={form.marketId}
                onChange={(ev) => pickMarket(ev.target.value)}
              >
                {markets.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.displayName} ({m.code})
                  </option>
                ))}
              </select>
            </FieldBlock>
            <FieldBlock label={t.type} htmlFor="offer-type">
              <select
                id="offer-type"
                className={selectClass}
                value={form.type}
                onChange={(ev) => set("type", ev.target.value as Form["type"])}
              >
                {OFFER_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {messages.offers.offerType[type]}
                  </option>
                ))}
              </select>
            </FieldBlock>
          </div>
          <FieldBlock
            label={t.name}
            htmlFor="offer-name"
            hint={t.nameHint}
            error={fieldErrors?.name?.[0]}
          >
            <Input
              id="offer-name"
              value={form.name}
              maxLength={200}
              onChange={(ev) => set("name", ev.target.value)}
            />
          </FieldBlock>
          <div className="grid gap-4 sm:grid-cols-2">
            <FieldBlock
              label={t.price}
              htmlFor="offer-price"
              hint={t.priceHint}
              error={fieldErrors?.price?.[0]}
            >
              <Input
                id="offer-price"
                inputMode="decimal"
                value={form.price}
                onChange={(ev) => set("price", ev.target.value)}
              />
            </FieldBlock>
            <FieldBlock
              label={t.currency}
              htmlFor="offer-currency"
              error={fieldErrors?.currency?.[0]}
            >
              <Input
                id="offer-currency"
                value={form.currency}
                maxLength={3}
                className="w-24 uppercase"
                onChange={(ev) => set("currency", ev.target.value.toUpperCase())}
              />
            </FieldBlock>
          </div>
          <FieldBlock
            label={t.landing}
            htmlFor="offer-landing"
            hint={t.landingHint}
            error={fieldErrors?.landingUrl?.[0]}
          >
            <Input
              id="offer-landing"
              type="url"
              inputMode="url"
              placeholder="https://"
              value={form.landingUrl}
              onChange={(ev) => set("landingUrl", ev.target.value)}
            />
          </FieldBlock>
          <div className="grid gap-4 sm:grid-cols-2">
            <FieldBlock
              label={t.keyword}
              htmlFor="offer-keyword"
              hint={t.keywordHint}
              error={fieldErrors?.defaultKeyword?.[0]}
            >
              <Input
                id="offer-keyword"
                value={form.defaultKeyword}
                maxLength={40}
                onChange={(ev) => set("defaultKeyword", ev.target.value)}
              />
            </FieldBlock>
            <FieldBlock
              label={t.priority}
              htmlFor="offer-priority"
              hint={t.priorityHint}
              error={fieldErrors?.priority?.[0]}
            >
              <Input
                id="offer-priority"
                type="number"
                min={0}
                max={1000}
                className="w-28"
                value={form.priority}
                onChange={(ev) => set("priority", ev.target.value)}
              />
            </FieldBlock>
          </div>
          <FieldBlock label={t.status} htmlFor="offer-status" hint={t.statusHint}>
            <select
              id="offer-status"
              className={selectClass}
              value={form.status}
              onChange={(ev) => set("status", ev.target.value as Form["status"])}
            >
              {OFFER_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {messages.offers.offerStatus[status]}
                </option>
              ))}
            </select>
          </FieldBlock>
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
