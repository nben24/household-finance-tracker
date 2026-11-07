"use client";

import { useActionState, useState } from "react";
import {
  sendMagicLink,
  sendPasswordReset,
  signIn,
  updatePassword,
  type AuthFormState,
} from "@/app/auth/actions";

const inputClass =
  "w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-base outline-none focus:border-accent";
const buttonClass =
  "w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-surface disabled:opacity-60";
const linkClass = "text-sm font-medium text-accent hover:underline";

function Field({
  label,
  name,
  type,
  autoComplete,
}: {
  label: string;
  name: string;
  type: string;
  autoComplete: string;
}) {
  return (
    <label className="block text-sm font-medium">
      {label}
      <input name={name} type={type} autoComplete={autoComplete} required className={`mt-1 ${inputClass}`} />
    </label>
  );
}

function Feedback({ state }: { state: AuthFormState }) {
  if (state.error) {
    return (
      <p role="alert" className="rounded-lg bg-notice-soft px-3 py-2 text-sm text-notice">
        {state.error}
      </p>
    );
  }
  if (state.message) {
    return (
      <p role="status" className="rounded-lg bg-accent-soft px-3 py-2 text-sm text-accent">
        {state.message}
      </p>
    );
  }
  return null;
}

type Mode = "password" | "link" | "forgot";

const MODES = {
  password: { action: signIn, button: "Sign in" },
  link: { action: sendMagicLink, button: "Email me a sign-in link" },
  forgot: { action: sendPasswordReset, button: "Email me a reset link" },
} as const;

function ModeForm({ mode, next }: { mode: Mode; next: string }) {
  const [state, formAction, pending] = useActionState(MODES[mode].action, {});
  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="next" value={next} />
      <Field label="Email" name="email" type="email" autoComplete="email" />
      {mode === "password" && (
        <Field label="Password" name="password" type="password" autoComplete="current-password" />
      )}
      <Feedback state={state} />
      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? "One moment…" : MODES[mode].button}
      </button>
    </form>
  );
}

export function LoginForm({ next }: { next: string }) {
  const [mode, setMode] = useState<Mode>("password");
  return (
    <div className="flex flex-col gap-4">
      {/* key resets the form's messages when switching modes */}
      <ModeForm key={mode} mode={mode} next={next} />
      <div className="flex flex-wrap justify-between gap-2">
        {mode === "password" ? (
          <>
            <button type="button" className={linkClass} onClick={() => setMode("link")}>
              Sign in with an email link
            </button>
            <button type="button" className={linkClass} onClick={() => setMode("forgot")}>
              Forgot password?
            </button>
          </>
        ) : (
          <button type="button" className={linkClass} onClick={() => setMode("password")}>
            ← Back to password sign-in
          </button>
        )}
      </div>
    </div>
  );
}

export function NewPasswordForm() {
  const [state, formAction, pending] = useActionState(updatePassword, {});
  return (
    <form action={formAction} className="flex flex-col gap-4">
      <Field label="New password" name="password" type="password" autoComplete="new-password" />
      <Field label="Type it again" name="confirmation" type="password" autoComplete="new-password" />
      <Feedback state={state} />
      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? "Saving…" : "Save new password"}
      </button>
    </form>
  );
}
