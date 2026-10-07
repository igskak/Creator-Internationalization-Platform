import { Skeleton } from "@/components/ui/skeleton";

/** Shown while the ideas list loads (plan 10 §10.5: every list has a loading state). */
export default function Loading() {
  return (
    <main className="flex max-w-6xl flex-col gap-4 p-6" aria-busy="true">
      <Skeleton className="h-8 w-40" />
      <div className="flex gap-2">
        {["proposed", "accepted", "rejected", "archived"].map((tab) => (
          <Skeleton key={tab} className="h-7 w-28 rounded-full" />
        ))}
      </div>
      <div className="flex flex-col gap-2 rounded-lg border p-3">
        {["a", "b", "c", "d", "e"].map((row) => (
          <Skeleton key={row} className="h-16 w-full" />
        ))}
      </div>
    </main>
  );
}
