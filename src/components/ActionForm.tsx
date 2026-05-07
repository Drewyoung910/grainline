"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";

export function SubmitButton({
  children,
  className = "rounded px-4 py-2 bg-black text-white",
  disabled = false,
  name,
  pendingLabel = "Saving…",
  title,
  value,
  "aria-describedby": ariaDescribedBy,
}: {
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
  name?: string;
  pendingLabel?: string;
  title?: string;
  value?: string;
  "aria-describedby"?: string;
}) {
  const { pending } = useFormStatus();
  const isDisabled = disabled || pending;
  return (
    <button
      type="submit"
      name={name}
      value={value}
      disabled={isDisabled}
      title={title}
      aria-describedby={ariaDescribedBy}
      className={className}
    >
      {pending ? pendingLabel : children}
    </button>
  );
}

export default function ActionForm({
  action,
  children,
  className,
  id,
}: {
  action: (prevState: unknown, formData: FormData) => Promise<{ ok: boolean; error?: string }>;
  children: React.ReactNode;
  className?: string;
  id?: string;
}) {
  const [state, formAction] = useActionState(action, { ok: false });
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (state?.ok) {
      // NEW: tell listeners (MessageComposer) that the action succeeded
      document.dispatchEvent(new CustomEvent("actionform:ok"));

      setShow(true);
      const t = setTimeout(() => setShow(false), 1800);
      return () => clearTimeout(t);
    }
  }, [state]);

  return (
    <>
      {show && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 rounded bg-green-600 text-white px-3 py-2 shadow">
          Saved
        </div>
      )}
      {state?.error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {state.error}
        </div>
      )}
      <form action={formAction} className={className} id={id}>{children}</form>
    </>
  );
}
