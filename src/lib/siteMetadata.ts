import type { Metadata } from "next";

const DEFAULT_SOCIAL_IMAGE_PATH = "/og-image.jpg";

export function defaultOpenGraphImages(): NonNullable<Metadata["openGraph"]>["images"] {
  return [
    {
      url: DEFAULT_SOCIAL_IMAGE_PATH,
      width: 1200,
      height: 630,
      alt: "Grainline",
    },
  ];
}
