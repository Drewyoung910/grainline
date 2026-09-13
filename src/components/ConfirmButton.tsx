"use client";

import React from "react";

type Props = {
  confirm?: string;          // dialog text
  className?: string;
  disabled?: boolean;
  title?: string;
  children: React.ReactNode; // button label
};

export default function ConfirmButton({
  confirm = "Are you sure?",
  className,
  disabled,
  title,
  children,
}: Props) {
  return (
    <button
      type="submit"
      className={className}
      disabled={disabled}
      title={title}
      onClick={(e) => {
        if (disabled) return;
        if (!window.confirm(confirm)) e.preventDefault(); // cancel the form submit
      }}
    >
      {children}
    </button>
  );
}

