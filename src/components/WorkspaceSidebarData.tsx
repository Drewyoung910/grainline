import WorkspaceSidebar from "@/components/WorkspaceSidebar";
import { readWorkspaceIdentity } from "@/lib/workspaceIdentity";
import type { WorkspaceKind } from "@/lib/workspaceNav";

// Streams in after the links, which render at once from the same component.
export default async function WorkspaceSidebarData({ kind }: { kind: WorkspaceKind }) {
  const identity = await readWorkspaceIdentity().catch(() => null);
  return <WorkspaceSidebar kind={kind} identity={identity} />;
}
