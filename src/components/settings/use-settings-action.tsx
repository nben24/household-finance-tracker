"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { SettingsResult } from "@/app/(app)/settings/actions";

/** Runs a settings action, then refreshes the page; tracks pending, error and message. */
export function useSettingsAction() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [link, setLink] = useState<{ href: string; label: string } | undefined>();

  function run(action: () => Promise<SettingsResult>, onSuccess?: () => void) {
    setError("");
    setMessage("");
    setLink(undefined);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.error);
        setLink(result.link);
        return;
      }
      if (result.message) setMessage(result.message);
      onSuccess?.();
      router.refresh();
    });
  }

  return { pending, error, message, link, run };
}

export function Feedback({
  error,
  message,
  link,
  id,
}: {
  error: string;
  message: string;
  /** a place to go to resolve the error */
  link?: { href: string; label: string };
  /** lets a field point at this message with aria-describedby */
  id?: string;
}) {
  if (error) {
    return (
      <p id={id} role="alert" className="mt-3 rounded-lg bg-notice-soft px-3 py-2 text-sm text-notice">
        {error}
        {link && (
          <>
            {" "}
            <Link href={link.href} className="font-medium underline">
              {link.label}
            </Link>
          </>
        )}
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

export { inputClass, primaryButton, secondaryButton, smallButton } from "@/components/styles";
