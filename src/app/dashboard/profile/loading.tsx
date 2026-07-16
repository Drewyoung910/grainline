import { FormPageSkeleton } from "@/components/RouteSkeletons";

export default function ShopProfileLoading() {
  return (
    <FormPageSkeleton
      label="Loading shop profile"
      title="h-8 w-44"
      subtitle="h-4 w-80"
      sections={6}
    />
  );
}
