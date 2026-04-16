"use client";
export default function LocalDate({ date }: { date: string | Date }) {
  return <>{new Date(date).toLocaleString()}</>;
}
