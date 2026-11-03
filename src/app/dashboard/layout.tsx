import { Suspense } from "react";
import WorkspaceShell from "@/components/WorkspaceShell";
import WorkspaceSidebar from "@/components/WorkspaceSidebar";
import WorkspaceSidebarData from "@/components/WorkspaceSidebarData";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <WorkspaceShell
      workshopSidebar={
        <Suspense fallback={<WorkspaceSidebar kind="workshop" />}>
          <WorkspaceSidebarData kind="workshop" />
        </Suspense>
      }
      accountSidebar={
        <Suspense fallback={<WorkspaceSidebar kind="account" />}>
          <WorkspaceSidebarData kind="account" />
        </Suspense>
      }
    >
      {children}
    </WorkspaceShell>
  );
}
