"use client";
export default function MessageTime({ date }: { date: string | Date }) {
  return (
    <>
      {new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date(date))}
    </>
  );
}
