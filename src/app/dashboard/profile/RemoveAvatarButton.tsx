"use client";
import { useRouter } from "next/navigation";

export default function RemoveAvatarButton({
  action,
}: {
  action: () => Promise<void>;
}) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={async () => {
        if (
          !window.confirm(
            "Remove your custom photo? Your Manage Account photo will be used instead."
          )
        )
          return;
        await action();
        router.refresh();
      }}
      className="text-xs text-neutral-500 hover:text-red-600 hover:underline"
    >
      Remove custom photo
    </button>
  );
}
