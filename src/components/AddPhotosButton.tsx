// Deprecated: existing-listing photos are now staged by EditPhotoGrid through
// photoManifestJson and committed only when the seller presses Save. Keeping a
// no-op export prevents stale imports from reintroducing the immediate photo
// API path.
export default function AddPhotosButton() {
  return null;
}
