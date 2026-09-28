import { Badge } from "@/components/ui/badge";
import { SCREENS, type ScreenKey } from "./screens";

/** Placeholder until the task in the screen catalog builds the real page. */
export function PlaceholderPage({ screen, subject }: { screen: ScreenKey; subject?: string }) {
  const s = SCREENS[screen];
  return (
    <main className="flex max-w-3xl flex-col gap-3 p-6">
      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-semibold">
          {s.title}
          {subject ? <span className="text-muted-foreground"> · {subject}</span> : null}
        </h1>
        {"p1" in s && <Badge variant="secondary">P1</Badge>}
      </div>
      <p className="text-muted-foreground">{s.purpose}</p>
      <p className="text-sm text-muted-foreground">
        Not built yet — arrives with task <span className="font-mono">{s.task}</span>.
      </p>
    </main>
  );
}
