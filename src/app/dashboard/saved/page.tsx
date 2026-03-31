// src/app/dashboard/saved/page.tsx
// Redirects to the new unified saved page under /account
import { redirect } from "next/navigation";

export default function DashboardSavedRedirect() {
  redirect("/account/saved");
}
