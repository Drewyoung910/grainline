import { Suspense } from "react";
import WorkspaceShell from "@/components/WorkspaceShell";
import WorkspaceSidebar from "@/components/WorkspaceSidebar";
import WorkspaceSidebarData from "@/components/WorkspaceSidebarData";

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  return (
    <WorkspaceShell
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
