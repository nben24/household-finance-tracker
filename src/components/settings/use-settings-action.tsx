"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { SettingsResult } from "@/app/(app)/settings/actions";

/** Runs a settings action, then refreshes the page; tracks pending, error and message. */
export function useSettingsAction() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  function run(action: () => Promise<SettingsResult>, onSuccess?: () => void) {
    setError("");
    setMessage("");
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (result.message) setMessage(result.message);
      onSuccess?.();
      router.refresh();
    });
  }

  return { pending, error, message, run };
}

export function Feedback({ error, message }: { error: string; message: string }) {
  if (error) {
    return (
      <p role="alert" className="mt-3 rounded-lg bg-notice-soft px-3 py-2 text-sm text-notice">
        {error}
      </p>
    );
  }
  if (message) {
    return (
      <p role="status" className="mt-3 rounded-lg bg-accent-soft px-3 py-2 text-sm text-accent">
        {message}
      </p>
    );
  }
  return null;
}

export const inputClass =
  "rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent";
export const smallButton = "rounded-lg border border-line px-2.5 py-1 text-xs font-medium hover:bg-bg disabled:opacity-50";
export const primaryButton =
  "rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-surface disabled:opacity-50";
