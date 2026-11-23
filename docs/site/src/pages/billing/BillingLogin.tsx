import type { FormEvent, RefObject } from "react";
import { CONTACT_EMAIL } from "@/lib/product";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";

interface BillingLoginProps {
  email: string;
  code: string;
  challenge: string | null;
  busy: boolean;
  codeField: RefObject<HTMLInputElement | null>;
  onEmailChange: (value: string) => void;
  onCodeChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
  onResetChallenge: () => void;
}

export function BillingLogin(props: BillingLoginProps) {
  const { email, code, challenge, busy, codeField, onEmailChange, onCodeChange, onSubmit, onResetChallenge } = props;
  const submitLabel = busy ? "Please wait…" : challenge ? "Sign in" : "Send sign-in code";

  return (
    <section className="bl-login" aria-labelledby="billing-title">
      <h1 id="billing-title">Your subscription</h1>
      <p>Sign in with the email you used at checkout to manage billing and your licence.</p>
      <form onSubmit={onSubmit}>
        <FieldGroup>
          <Field className="bl-field">
            <FieldLabel htmlFor="billing-email">Email address</FieldLabel>
            <Input
              id="billing-email"
              type="email"
              autoComplete="email"
              required
              maxLength={254}
              value={email}
              disabled={busy || !!challenge}
              onChange={(event) => onEmailChange(event.target.value)}
            />
          </Field>
          {challenge && (
            <Field className="bl-field">
              <FieldLabel htmlFor="billing-code">Sign-in code</FieldLabel>
              <Input
                ref={codeField}
                id="billing-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                required
                value={code}
                onChange={(event) => onCodeChange(event.target.value.replace(/\D/g, ""))}
              />
              <p className="bl-hint">Enter the six-digit code sent to {email}. It expires in 10 minutes.</p>
            </Field>
          )}
        </FieldGroup>
        <Button className="bl-primary" type="submit" disabled={busy}>{submitLabel}</Button>
        {challenge && (
          <Button type="button" variant="ghost" className="bl-link" disabled={busy} onClick={onResetChallenge}>
            Use another email or request a new code
          </Button>
        )}
      </form>
      <a href={`mailto:${CONTACT_EMAIL}`}>Contact support</a>
    </section>
  );
}
