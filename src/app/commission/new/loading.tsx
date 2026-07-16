import { FormPageSkeleton } from "@/components/RouteSkeletons";

export default function NewCommissionLoading() {
  return (
    <FormPageSkeleton
      label="Loading commission request form"
      title="h-8 w-64"
      subtitle="h-4 w-96"
      sections={3}
    />
  );
}
