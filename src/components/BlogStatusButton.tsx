"use client";

import { useFormStatus } from "react-dom";

export default function BlogStatusButton({
  children,
  className,
  confirm,
  pendingLabel,
}: {
  children: React.ReactNode;
  className?: string;
  confirm: string;
  pendingLabel: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      className={className}
      disabled={pending}
      aria-disabled={pending}
      onClick={(event) => {
        if (!pending && !window.confirm(confirm)) event.preventDefault();
      }}
    >
      {pending ? pendingLabel : children}
    </button>
  );
}
