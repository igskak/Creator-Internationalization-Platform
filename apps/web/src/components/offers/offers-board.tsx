"use client";

import type { ProductsOverview } from "@rc/modules/offers";
import { ExternalLinkIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { format, formatNumber } from "@/lib/i18n/format";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import { OfferDialog, type OfferValues } from "./offer-dialog";
import { ProductDialog, type ProductValues } from "./product-dialog";

const STATUS_STYLE: Record<string, string> = {
  ACTIVE: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  DRAFT: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  PAUSED: "bg-muted text-muted-foreground",
  RETIRED: "bg-muted text-muted-foreground line-through",
  INACTIVE: "bg-muted text-muted-foreground",
};

/** Products with their offers per market (plan 10 §10.2 /knowledge/offers). */
export function OffersBoard({
  overview,
  canEdit,
}: {
  overview: ProductsOverview;
  canEdit: boolean;
}) {
  const { locale, messages } = useI18n();
  const t = messages.offers;
  const markets = overview.markets
    .filter((m) => m.isActive)
    .map(({ id, code, displayName, currency }) => ({ id, code, displayName, currency }));

  return (
    <div className="flex flex-col gap-4">
      {overview.products.map((product) => {
        const values: ProductValues = {
          id: product.id,
          code: product.code,
          name: product.name,
          type: product.type,
          description: product.description,
          originalLanguage: product.originalLanguage,
          sourceAssetId: product.sourceAssetId,
          status: product.status,
        };
        return (
          <Card key={product.id}>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2">
                {product.name}
                <Badge variant="ghost" className={cn(STATUS_STYLE[product.status])}>
                  {t.productStatus[product.status]}
                </Badge>
              </CardTitle>
              <CardDescription>
                <span className="font-mono">{product.code}</span> · {t.productType[product.type]} ·{" "}
                {format(t.original, { language: product.originalLanguage })}
                {product.description ? <> · {product.description}</> : null}
              </CardDescription>
              {canEdit ? (
                <CardAction className="flex gap-1">
                  <ProductDialog product={values} materials={overview.materials} />
                  <OfferDialog
                    productId={product.id}
                    productName={product.name}
                    markets={markets}
                  />
                </CardAction>
              ) : null}
            </CardHeader>
            <CardContent>
              {product.offers.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t.noOffers}</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t.table.market}</TableHead>
                      <TableHead>{t.table.offer}</TableHead>
                      <TableHead>{t.table.type}</TableHead>
                      <TableHead className="text-right">{t.table.price}</TableHead>
                      <TableHead>{t.table.keyword}</TableHead>
                      <TableHead className="text-right">{t.table.priority}</TableHead>
                      <TableHead>{t.table.status}</TableHead>
                      <TableHead>{t.table.landing}</TableHead>
                      {canEdit ? <TableHead /> : null}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {product.offers.map((offer) => {
                      const offerValues: OfferValues = {
                        id: offer.id,
                        marketId: offer.marketId,
                        name: offer.name,
                        type: offer.type,
                        price: offer.price,
                        currency: offer.currency,
                        landingUrl: offer.landingUrl,
                        defaultKeyword: offer.defaultKeyword,
                        priority: offer.priority,
                        status: offer.status,
                      };
                      return (
                        <TableRow key={offer.id}>
                          <TableCell className="font-mono text-xs">{offer.marketCode}</TableCell>
                          <TableCell className="font-medium">{offer.name}</TableCell>
                          <TableCell>{t.offerType[offer.type]}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {offer.price === null
                              ? t.free
                              : `${formatNumber(locale, Number(offer.price), 2)} ${offer.currency}`}
                            {offer.currency !== offer.marketCurrency ? (
                              <span className="text-destructive" title={offer.marketCurrency}>
                                {" "}
                                ⚠
                              </span>
                            ) : null}
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {offer.defaultKeyword ?? "–"}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {offer.priority}
                          </TableCell>
                          <TableCell>
                            <Badge variant="ghost" className={cn(STATUS_STYLE[offer.status])}>
                              {t.offerStatus[offer.status]}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {offer.landingUrl ? (
                              <a
                                href={offer.landingUrl}
                                target="_blank"
                                rel="noreferrer noopener"
                                className="inline-flex items-center gap-1 text-sm underline-offset-4 hover:underline"
                              >
                                {new URL(offer.landingUrl).hostname}
                                <ExternalLinkIcon className="size-3" />
                              </a>
                            ) : (
                              "–"
                            )}
                          </TableCell>
                          {canEdit ? (
                            <TableCell className="text-right">
                              <OfferDialog
                                productId={product.id}
                                productName={product.name}
                                offer={offerValues}
                                markets={markets}
                              />
                            </TableCell>
                          ) : null}
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
