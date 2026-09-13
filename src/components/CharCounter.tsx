"use client";

import { useId, useState } from "react";

export default function CharCounter({
  name,
  maxLength,
  defaultValue,
  rows = 4,
  placeholder,
  className,
  required,
  id,
}: {
  name: string;
  maxLength: number;
  defaultValue?: string;
  rows?: number;
  placeholder?: string;
  className?: string;
  required?: boolean;
  id?: string;
}) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const counterId = `${fieldId}-counter`;
  const [count, setCount] = useState((defaultValue ?? "").length);

  return (
    <div>
      <textarea
        id={fieldId}
        name={name}
        rows={rows}
        maxLength={maxLength}
        defaultValue={defaultValue}
        placeholder={placeholder}
        required={required}
        aria-describedby={counterId}
        onChange={(e) => setCount(e.target.value.length)}
        className={
          className ??
          "w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm"
        }
      />
      <p id={counterId} aria-live="polite" className="text-xs text-neutral-500 text-right mt-0.5">
        {count} / {maxLength}
      </p>
    </div>
  );
}

export function InputCharCounter({
  name,
  maxLength,
  defaultValue,
  placeholder,
  className,
  required,
  id,
}: {
  name: string;
  maxLength: number;
  defaultValue?: string;
  placeholder?: string;
  className?: string;
  required?: boolean;
  id?: string;
}) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const counterId = `${fieldId}-counter`;
  const [count, setCount] = useState((defaultValue ?? "").length);

  return (
    <div>
      <input
        id={fieldId}
        type="text"
        name={name}
        maxLength={maxLength}
        defaultValue={defaultValue}
        placeholder={placeholder}
        required={required}
        aria-describedby={counterId}
        onChange={(e) => setCount(e.target.value.length)}
        className={
          className ??
          "w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm"
        }
      />
      <p id={counterId} aria-live="polite" className="text-xs text-neutral-500 text-right mt-0.5">
        {count} / {maxLength}
      </p>
    </div>
  );
}
