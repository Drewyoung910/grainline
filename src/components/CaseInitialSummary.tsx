export default function CaseInitialSummary({ description }: { description: string }) {
  const body = description.trim();

  return (
    <div className="border-l-2 border-neutral-300 pl-3">
      <div className="text-xs font-medium text-neutral-500">Case summary</div>
      <p className="mt-1 whitespace-pre-wrap text-sm text-neutral-800">
        {body || "No message body was recorded for this case."}
      </p>
    </div>
  );
}
