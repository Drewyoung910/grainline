"use client";
import CustomOrderRequestForm from "@/components/CustomOrderRequestForm";

type Props = {
  sellerUserId: string;
  sellerName: string;
};

export default function ThreadCustomOrderButton({ sellerUserId, sellerName }: Props) {
  return (
    <CustomOrderRequestForm
      sellerUserId={sellerUserId}
      sellerName={sellerName}
      triggerLabel="Request Custom Order"
      triggerClassName="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100"
    />
  );
}
