import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const STYLE: Record<string, string> = {
  PROPOSED: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  ACCEPTED: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  REJECTED: "bg-muted text-muted-foreground line-through",
  ARCHIVED: "bg-muted text-muted-foreground",
};

/** The status of an idea as a badge (plan 10 §10.5 status colors). */
export function IdeaStatusBadge({ status, label }: { status: string; label: string }) {
  return (
    <Badge variant="ghost" className={cn(STYLE[status])}>
      {label}
    </Badge>
  );
}
