import { SimpleListPageSkeleton } from "@/components/RouteSkeletons";

export default function BlockedUsersLoading() {
  return <SimpleListPageSkeleton label="Loading blocked users" title="h-8 w-44" rows={4} />;
}
