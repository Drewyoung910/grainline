type CaseMessageAttachmentSummary = {
  id: string;
  contentType: string;
  byteSize: number;
};

function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function CaseMessageAttachments({
  caseId,
  attachments,
}: {
  caseId: string;
  attachments: readonly CaseMessageAttachmentSummary[];
}) {
  if (attachments.length === 0) return null;

  return (
    <ul className="mt-2 flex flex-wrap gap-2">
      {attachments.map((attachment, index) => (
        <li key={attachment.id}>
          <a
            href={`/api/cases/${caseId}/attachments/${attachment.id}`}
            target="_blank"
            rel="noopener noreferrer"
            referrerPolicy="no-referrer"
            className="inline-flex min-h-9 items-center rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
          >
            View evidence image {index + 1}
            <span className="ml-1 text-neutral-400">
              ({formatFileSize(attachment.byteSize)})
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}
