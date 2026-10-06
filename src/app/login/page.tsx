import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { DevLoginForm } from "@/app/login/dev-login-form";
import { Button } from "@/components/ui/button";
import { signIn, oauthProviderFlags } from "@/lib/auth";
import { isDevLoginEnabled } from "@/lib/services/auth-policy";
import { getCurrentUser } from "@/lib/services/current-user";

export const metadata: Metadata = {
  title: "Sign in",
};

const ERRORS: Record<string, string> = {
  inactive: "This account is deactivated. A Super Admin can reactivate it.",
  idle: "You were signed out after a period of inactivity.",
  expired: "Your session expired. Sign in again.",
  AccessDenied: "Sign-in was denied. An active company account must already exist.",
  Configuration: "Sign-in is not configured. Check the Auth.js environment variables.",
  OAuthAccountNotLinked: "This sign-in could not be linked to an existing account.",
};

async function signInWithGoogle() {
  "use server";
  await signIn("google", { redirectTo: "/" });
}

async function signInWithMicrosoft() {
  "use server";
  await signIn("microsoft-entra-id", { redirectTo: "/" });
}

function firstParam(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[] }>;
}) {
  const current = await getCurrentUser();
  if (current) {
    redirect("/");
  }

  const errorCode = firstParam((await searchParams).error);
  const error = ERRORS[errorCode];
  const providers = oauthProviderFlags();
  const devLogin = isDevLoginEnabled();

  return (
    <main className="flex min-h-full items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 sm:p-8">
        <p className="text-lg font-semibold tracking-tight">
          <span className="text-primary">Avanza</span> Logistics
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">Sign in</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Use your company account. Accounts are created by a Super Admin. There is no self-signup.
        </p>

        {error ? <p className="mt-4 text-sm text-destructive">{error}</p> : null}

        <div className="mt-6 space-y-3">
          {providers.google ? (
            <form action={signInWithGoogle}>
              <Button type="submit" className="w-full">
                Sign in with Google
              </Button>
            </form>
          ) : null}
          {providers.microsoft ? (
            <form action={signInWithMicrosoft}>
              <Button type="submit" variant="secondary" className="w-full">
                Sign in with Microsoft
              </Button>
            </form>
          ) : null}
          {!providers.google && !providers.microsoft ? (
            <p className="text-sm text-muted-foreground">
              Google and Microsoft sign-in appear here once their client id and secret are set.
            </p>
          ) : null}
        </div>

        {devLogin ? (
          <section className="mt-8 border-t border-border pt-6">
            <h2 className="text-sm font-medium text-foreground">Password</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Signs in an existing active user. It does not create an account.
            </p>
            <div className="mt-4">
              <DevLoginForm />
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}
