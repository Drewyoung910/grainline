"use client";

import { useActionState, useEffect, useRef, useState } from "react";
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
  preventEnterSubmit = false,
  preserveOnError = false,
}: {
  action: (prevState: unknown, formData: FormData) => Promise<{ ok: boolean; error?: string }>;
  children: React.ReactNode;
  className?: string;
  id?: string;
  preventEnterSubmit?: boolean;
  preserveOnError?: boolean;
}) {
  const [state, formAction] = useActionState(action, { ok: false });
  const [show, setShow] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const lastSubmissionRef = useRef<Array<[string, FormDataEntryValue]> | null>(null);

  useEffect(() => {
    if (state?.ok) {
      const formId = formRef.current?.id || id || null;
      document.dispatchEvent(new CustomEvent("actionform:ok", {
        detail: { formId },
      }));

      setShow(true);
      const t = setTimeout(() => setShow(false), 1800);
      return () => clearTimeout(t);
    }
  }, [id, state]);

  useEffect(() => {
    if (!preserveOnError || !state?.error || !lastSubmissionRef.current || !formRef.current) return;
    const formId = formRef.current.id || id || null;
    restoreFormValues(formRef.current, lastSubmissionRef.current);
    document.dispatchEvent(new CustomEvent("actionform:error", {
      detail: { formId, values: Object.fromEntries(lastSubmissionRef.current) },
    }));
  }, [id, preserveOnError, state]);

  function handleSubmitCapture(event: React.FormEvent<HTMLFormElement>) {
    if (!preserveOnError) return;
    lastSubmissionRef.current = Array.from(new FormData(event.currentTarget).entries());
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLFormElement>) {
    if (!preventEnterSubmit || event.key !== "Enter") return;
    const target = event.target as HTMLElement | null;
    if (!(target instanceof HTMLInputElement)) return;
    const type = target.type.toLowerCase();
    if (["button", "checkbox", "file", "radio", "reset", "submit"].includes(type)) return;
    event.preventDefault();
  }

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
      <form
        ref={formRef}
        action={formAction}
        className={className}
        id={id}
        onSubmitCapture={handleSubmitCapture}
        onKeyDown={handleKeyDown}
      >
        {children}
      </form>
    </>
  );
}

function restoreFormValues(form: HTMLFormElement, entries: Array<[string, FormDataEntryValue]>) {
  const valuesByName = new Map<string, FormDataEntryValue[]>();
  for (const [name, value] of entries) {
    const values = valuesByName.get(name) ?? [];
    values.push(value);
    valuesByName.set(name, values);
  }

  const fields = form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
    "input[name], textarea[name], select[name]",
  );
  fields.forEach((field) => {
    const values = valuesByName.get(field.name);
    if (field instanceof HTMLInputElement && (field.type === "checkbox" || field.type === "radio")) {
      field.checked = values?.some((value) => String(value) === (field.value || "on")) ?? false;
      return;
    }
    if (field instanceof HTMLInputElement && field.type === "file") {
      return;
    }
    if (!values) return;
    if (field instanceof HTMLSelectElement && field.multiple) {
      const selected = new Set(values.map(String));
      Array.from(field.options).forEach((option) => {
        option.selected = selected.has(option.value);
      });
      return;
    }
    field.value = String(values[values.length - 1] ?? "");
  });
}
