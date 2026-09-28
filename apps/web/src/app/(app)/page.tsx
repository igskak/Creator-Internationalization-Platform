import { requireUser } from "@/server/auth/session";

export default async function DashboardPage() {
  const user = await requireUser();
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-2 p-8">
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <p className="text-muted-foreground">Signed in as {user.displayName ?? user.email}.</p>
    </main>
  );
}
