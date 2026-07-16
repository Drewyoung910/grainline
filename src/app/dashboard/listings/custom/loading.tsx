import { FormPageSkeleton } from "@/components/RouteSkeletons";

export default function CustomListingLoading() {
  return (
    <FormPageSkeleton
      label="Loading custom listing form"
      title="h-8 w-56"
      subtitle="h-4 w-96"
      sections={4}
    />
  );
}
