"use client";

import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { appendNote, markReviewed, type AdminOrderActionState } from "../../actions";

const initialState: AdminOrderActionState = { ok: false };

function SubmitButton({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-medium hover:bg-neutral-50 active:bg-neutral-100 disabled:opacity-50"
    >
      {pending ? "Saving..." : children}
    </button>
  );
}

function ActionMessage({ state }: { state: AdminOrderActionState }) {
  if (state.error) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
        {state.error}
      </div>
    );
  }
  if (state.ok) {
    return (
      <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
        Saved.
      </div>
    );
  }
  return null;
}

export default function AdminOrderActions({
  orderId,
  reviewNeeded,
}: {
  orderId: string;
  reviewNeeded: boolean;
}) {
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const [reviewState, reviewAction] = useActionState(markReviewed.bind(null, orderId), initialState);
  const [noteState, noteAction] = useActionState(appendNote.bind(null, orderId), initialState);

  useEffect(() => {
    if (noteState.ok) noteRef.current?.form?.reset();
  }, [noteState.ok]);

  return (
    <div className="space-y-5">
      {reviewNeeded && (
        <div className="space-y-2">
          <p className="text-sm text-neutral-600">
            Once you have verified the shipping details are acceptable, mark this order as reviewed.
          </p>
          <form action={reviewAction} className="space-y-2">
            <SubmitButton>Mark as Reviewed</SubmitButton>
            <ActionMessage state={reviewState} />
          </form>
        </div>
      )}

      <div className="space-y-2">
        <p className="text-sm font-medium text-neutral-700">Append internal note</p>
        <form action={noteAction} className="space-y-2">
          <textarea
            ref={noteRef}
            name="note"
            rows={3}
            maxLength={2000}
            placeholder="Add an internal note..."
            required
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-400"
          />
          <SubmitButton>Append Note</SubmitButton>
          <ActionMessage state={noteState} />
        </form>
      </div>
    </div>
  );
}
