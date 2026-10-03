import { Skeleton } from "@/components/ui/skeleton";

/** Shown while the list loads (plan 10 §10.5: every list has a loading state). */
export default function Loading() {
  return (
    <main className="flex max-w-6xl flex-col gap-4 p-6" aria-busy="true">
      <Skeleton className="h-8 w-56" />
      <div className="flex gap-2">
        {["review", "approved", "archived", "all"].map((tab) => (
          <Skeleton key={tab} className="h-7 w-28 rounded-full" />
        ))}
      </div>
      <Skeleton className="h-8 w-full max-w-xl" />
      <div className="flex flex-col gap-2 rounded-lg border p-3">
        {["a", "b", "c", "d", "e", "f", "g", "h"].map((row) => (
          <Skeleton key={row} className="h-12 w-full" />
        ))}
      </div>
    </main>
  );
}
