"use client";

import { useActionState } from "react";
import { FormField } from "@/components/shared/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { devSignIn, type DevSignInState } from "@/lib/auth-actions";

const initialState: DevSignInState = {};

export function DevLoginForm() {
  const [state, action, pending] = useActionState(devSignIn, initialState);

  return (
    <form action={action} className="space-y-4">
      <FormField label="Work email" htmlFor="dev-email">
        <Input name="email" type="email" autoComplete="username" required />
      </FormField>
      <FormField
        label="Development password"
        htmlFor="dev-password"
        hint="Shared dev password from AUTH_DEV_PASSWORD. This does not create an account."
      >
        <Input name="password" type="password" autoComplete="current-password" required />
      </FormField>
      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Signing in…" : "Sign in with dev password"}
      </Button>
    </form>
  );
}
