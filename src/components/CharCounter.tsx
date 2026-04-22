"use client";

import { useState } from "react";

export default function CharCounter({
  name,
  maxLength,
  defaultValue,
  rows = 4,
  placeholder,
  className,
  required,
}: {
  name: string;
  maxLength: number;
  defaultValue?: string;
  rows?: number;
  placeholder?: string;
  className?: string;
  required?: boolean;
}) {
  const [count, setCount] = useState((defaultValue ?? "").length);

  return (
    <div>
      <textarea
        name={name}
        rows={rows}
        maxLength={maxLength}
        defaultValue={defaultValue}
        placeholder={placeholder}
        required={required}
        onChange={(e) => setCount(e.target.value.length)}
        className={className ?? "w-full border border-neutral-200 rounded-md px-3 py-2 text-sm"}
      />
      <p className="text-xs text-neutral-400 text-right mt-0.5">
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
}: {
  name: string;
  maxLength: number;
  defaultValue?: string;
  placeholder?: string;
  className?: string;
  required?: boolean;
}) {
  const [count, setCount] = useState((defaultValue ?? "").length);

  return (
    <div>
      <input
        type="text"
        name={name}
        maxLength={maxLength}
        defaultValue={defaultValue}
        placeholder={placeholder}
        required={required}
        onChange={(e) => setCount(e.target.value.length)}
        className={className ?? "w-full border border-neutral-200 rounded-md px-3 py-2 text-sm"}
      />
      <p className="text-xs text-neutral-400 text-right mt-0.5">
        {count} / {maxLength}
      </p>
    </div>
  );
}
