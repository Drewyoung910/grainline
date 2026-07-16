import { FormPageSkeleton } from "@/components/RouteSkeletons";

export default function SellerSettingsLoading() {
  return (
    <FormPageSkeleton
      label="Loading shipping and seller settings"
      title="h-8 w-56"
      subtitle="h-4 w-96"
      sections={5}
    />
  );
}
