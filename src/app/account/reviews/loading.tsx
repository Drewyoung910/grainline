import { SimpleListPageSkeleton } from "@/components/RouteSkeletons";

export default function AccountReviewsLoading() {
  return <SimpleListPageSkeleton label="Loading reviews" title="h-8 w-32" rows={4} />;
}
