import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Global banners (plan 10 §10.1): publishing kill switch off, Instagram account needs re-auth,
 * token expires in < 7 days. The shell renders whatever it is given; M4/M5 and H-01 add sources.
 */
export type Banner = {
  id: string;
  tone: "info" | "warning" | "danger";
  message: string;
  href?: string;
};

const tones: Record<Banner["tone"], string> = {
  info: "border-border bg-muted text-foreground",
  warning:
    "border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100",
  danger: "border-destructive/40 bg-destructive/10 text-destructive",
};

export function Banners({ banners }: { banners: Banner[] }) {
  if (banners.length === 0) return null;
  return (
    <div className="flex flex-col gap-2 px-6 pt-4">
      {banners.map((banner) => (
        <div
          key={banner.id}
          role="status"
          className={cn("rounded-md border px-4 py-2 text-sm", tones[banner.tone])}
        >
          {banner.message}
          {banner.href && (
            <Link href={banner.href} className="ml-2 underline underline-offset-4">
              Open
            </Link>
          )}
        </div>
      ))}
    </div>
  );
}
