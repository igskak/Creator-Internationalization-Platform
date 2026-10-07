import { Skeleton } from "@/components/ui/skeleton";

/** Shown while an idea loads. */
export default function Loading() {
  return (
    <main className="flex max-w-5xl flex-col gap-4 p-6" aria-busy="true">
      <Skeleton className="h-5 w-32" />
      <Skeleton className="h-8 w-96 max-w-full" />
      <Skeleton className="h-9 w-64" />
      <Skeleton className="h-20 w-full" />
      {["a", "b", "c"].map((card) => (
        <Skeleton key={card} className="h-32 w-full" />
      ))}
    </main>
  );
}
