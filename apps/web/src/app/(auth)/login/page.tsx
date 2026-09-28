import { LoginForm } from "./login-form";

const errors: Record<string, string> = {
  link_invalid: "This sign-in link is invalid or has expired. Request a new one.",
  unknown: "This email does not have access. Ask an owner to add you.",
  inactive: "Your access has been turned off. Ask an owner.",
  email_linked_to_other_account: "This email is linked to another account. Ask an owner.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const message = error ? (errors[error] ?? "Sign-in failed. Try again.") : null;
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 p-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">RegChef Content Engine</h1>
        <p className="text-sm text-muted-foreground">Sign in with a link sent to your email.</p>
      </div>
      {message && (
        <p
          role="alert"
          className="rounded-md border border-destructive/30 p-3 text-sm text-destructive"
        >
          {message}
        </p>
      )}
      <LoginForm />
    </main>
  );
}
