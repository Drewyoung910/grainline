"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { ReactNode } from "react";

type InlineActionState = { ok: boolean; error?: string };

type Props = {
  action: (prevState: unknown, formData: FormData) => Promise<InlineActionState>;
  children: ReactNode;
  className?: string;
  confirm?: string;
  disabled?: boolean;
  pendingLabel?: string;
  title?: string;
};

function SubmitButton({
  children,
  className,
  confirm,
  disabled,
  pendingLabel = "...",
  title,
}: Omit<Props, "action">) {
  const { pending } = useFormStatus();
  const isDisabled = disabled || pending;

  return (
    <button
      type="submit"
      className={className}
      disabled={isDisabled}
      title={title}
      onClick={(event) => {
        if (isDisabled) return;
        if (confirm && !window.confirm(confirm)) event.preventDefault();
      }}
    >
      {pending ? pendingLabel : children}
    </button>
  );
}

export default function InlineActionButton({
  action,
  children,
  className,
  confirm,
  disabled,
  pendingLabel,
  title,
}: Props) {
  const [state, formAction] = useActionState(action, { ok: false });

  return (
    <form action={formAction} className="inline-flex flex-col items-start gap-1">
      <SubmitButton
        className={className}
        confirm={confirm}
        disabled={disabled}
        pendingLabel={pendingLabel}
        title={title}
      >
        {children}
      </SubmitButton>
      {state?.error && (
        <span role="alert" className="max-w-40 text-[10px] leading-tight text-red-700">
          {state.error}
        </span>
      )}
    </form>
  );
}
