import { SimpleListPageSkeleton } from "@/components/RouteSkeletons";

export default function FollowingLoading() {
  return <SimpleListPageSkeleton label="Loading followed makers" title="h-8 w-52" rows={5} />;
}
