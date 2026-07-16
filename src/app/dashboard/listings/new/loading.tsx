import { FormPageSkeleton } from "@/components/RouteSkeletons";

export default function CreateListingLoading() {
  return (
    <FormPageSkeleton
      label="Loading listing form"
      title="h-8 w-44"
      subtitle="h-4 w-80"
      sections={5}
    />
  );
}
