"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";

const SAVED_NOTICE_MS = 3000;

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
  const { pending, data } = useFormStatus();
  // Every submit button stays disabled while the form is pending, but only
  // the button that submitted it shows its pending label. React adds the
  // submitter's name/value to the pending FormData; a submission without a
  // recorded submitter (for example requestSubmit()) falls back to all buttons.
  const isDisabled = disabled || pending;
  const showPending =
    pending && (!name || !data?.has(name) || data.getAll(name).includes(value ?? ""));
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
      {showPending ? pendingLabel : children}
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
  // 0 hides the saved notice; each success bumps it so a repeat save remounts
  // (and re-announces) the notice instead of silently extending it.
  const [savedNotice, setSavedNotice] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const lastSubmissionRef = useRef<Array<[string, FormDataEntryValue]> | null>(null);

  useEffect(() => {
    if (state?.ok) {
      const formId = formRef.current?.id || id || null;
      document.dispatchEvent(new CustomEvent("actionform:ok", {
        detail: { formId },
      }));

      setSavedNotice((current) => current + 1);
      const t = setTimeout(() => setSavedNotice(0), SAVED_NOTICE_MS);
      return () => clearTimeout(t);
    }
  }, [id, state]);

  // Server errors render beside the submit buttons at the end of the form.
  // Bring each new error into view, and give it focus when the disabled
  // submit button dropped focus to the page, without stealing focus from a
  // field the user is still typing in.
  useEffect(() => {
    const errorElement = errorRef.current;
    if (!state?.error || !errorElement) return;
    errorElement.scrollIntoView({ block: "nearest" });
    const active = document.activeElement;
    if (!active || active === document.body) {
      errorElement.focus({ preventScroll: true });
    }
  }, [state]);

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
      {/* Always mounted so screen readers announce the notice when it appears;
          matches the site toast placement (top on mobile, bottom-right on desktop). */}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed left-4 right-4 top-[calc(1rem+env(safe-area-inset-top))] z-[9999] sm:bottom-[calc(1rem+env(safe-area-inset-bottom))] sm:left-auto sm:right-4 sm:top-auto"
      >
        {savedNotice > 0 && (
          <div
            key={savedNotice}
            className="animate-slide-down rounded-md bg-green-600 px-4 py-2.5 text-sm font-medium text-white shadow-lg sm:min-w-72"
          >
            Saved
          </div>
        )}
      </div>
      <form
        ref={formRef}
        action={formAction}
        className={className}
        id={id}
        onSubmitCapture={handleSubmitCapture}
        onKeyDown={handleKeyDown}
      >
        {children}
        {state?.error && (
          <div
            ref={errorRef}
            role="alert"
            tabIndex={-1}
            className="mt-3 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
          >
            {state.error}
          </div>
        )}
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
