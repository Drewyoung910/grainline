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
        className="btn btn-danger btn-sm"
        onClick={(e) => {
          if (!confirm("Delete this broadcast? This cannot be undone.")) e.preventDefault();
        }}
      >
        Delete
      </button>
    </form>
  );
}
