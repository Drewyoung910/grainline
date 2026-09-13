"use client";

import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { appendNote, markReviewed, recordLabelVoided, type AdminOrderActionState } from "../../actions";
import {
  reconcileAmbiguousOrderRefund,
  type RefundReconciliationActionState,
} from "./refundReconciliationActions";

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

function ActionMessage({
  state,
}: {
  state: AdminOrderActionState | RefundReconciliationActionState;
}) {
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
        {"message" in state && state.message ? state.message : "Saved."}
      </div>
    );
  }
  return null;
}

export default function AdminOrderActions({
  orderId,
  reviewNeeded,
  labelStatus,
  labelClawbackStatus,
  canReconcileRefundClaim,
  refundClaimState,
}: {
  orderId: string;
  reviewNeeded: boolean;
  labelStatus: string | null;
  labelClawbackStatus: string | null;
  canReconcileRefundClaim: boolean;
  refundClaimState: "pending" | "ambiguous" | null;
}) {
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const [reviewState, reviewAction] = useActionState(markReviewed.bind(null, orderId), initialState);
  const [labelState, labelAction] = useActionState(recordLabelVoided.bind(null, orderId), initialState);
  const [noteState, noteAction] = useActionState(appendNote.bind(null, orderId), initialState);
  const [refundState, refundAction] = useActionState(
    reconcileAmbiguousOrderRefund.bind(null, orderId),
    initialState,
  );
  const canRecordLabelVoided =
    labelStatus === "PURCHASED" &&
    labelClawbackStatus !== "RETRY_PENDING" &&
    labelClawbackStatus !== "RETRYING";

  useEffect(() => {
    if (noteState.ok) noteRef.current?.form?.reset();
  }, [noteState.ok]);

  return (
    <div className="space-y-5">
      {canReconcileRefundClaim && refundClaimState && (
        <div className="space-y-3 rounded-lg border border-red-200 bg-red-50 p-4">
          <div>
            <p className="text-sm font-semibold text-red-950">
              Refund claim requires exact Stripe reconciliation
            </p>
            <p className="mt-1 text-sm text-red-900">
              This inspects Stripe for the database-derived claim. Grainline will
              derive the only safe result: record the existing refund, retry the
              same idempotency scope while it is still safe, wait, or release a
              claim only after the no-effect safety window.
            </p>
            <p className="mt-1 text-xs text-red-800">
              Current local state: {refundClaimState === "ambiguous"
                ? "provider outcome requires review"
                : "refund finalization is pending"}.
            </p>
          </div>
          <form action={refundAction} className="space-y-2">
            <label
              htmlFor="refund-reconciliation-reason"
              className="block text-sm font-medium text-red-950"
            >
              Reconciliation reason
            </label>
            <textarea
              id="refund-reconciliation-reason"
              name="reason"
              rows={3}
              minLength={10}
              maxLength={1000}
              required
              placeholder="Describe why this exact refund claim is being reconciled..."
              className="w-full rounded-md border border-red-200 bg-white px-3 py-2 text-sm"
            />
            <SubmitButton>Inspect Stripe and reconcile exact claim</SubmitButton>
            <ActionMessage state={refundState} />
          </form>
        </div>
      )}

      {reviewNeeded && (
        <div className="space-y-2">
          <p className="text-sm text-neutral-600">
            Once you have resolved the review note, mark this order as reviewed.
          </p>
          <form action={reviewAction} className="space-y-2">
            <SubmitButton>Mark as Reviewed</SubmitButton>
            <ActionMessage state={reviewState} />
          </form>
        </div>
      )}

      {canRecordLabelVoided && (
        <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="text-sm text-amber-900">
            Only use this after staff has voided or reconciled the carrier label outside Grainline.
            Recording the label as voided removes the app-level refund block.
          </p>
          <form action={labelAction} className="space-y-2">
            <SubmitButton>Record Label Voided</SubmitButton>
            <ActionMessage state={labelState} />
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
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
          />
          <SubmitButton>Append Note</SubmitButton>
          <ActionMessage state={noteState} />
        </form>
      </div>
    </div>
  );
}
