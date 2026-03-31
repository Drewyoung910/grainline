"use client";

type Props = {
  id: string;
  action: (formData: FormData) => Promise<void>;
};

export default function DeleteBroadcastButton({ id, action }: Props) {
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        className="text-xs text-red-600 hover:text-red-800 border border-red-200 rounded px-2 py-1 hover:bg-red-50 transition-colors"
        onClick={(e) => {
          if (!confirm("Delete this broadcast? This cannot be undone.")) e.preventDefault();
        }}
      >
        Delete
      </button>
    </form>
  );
}
