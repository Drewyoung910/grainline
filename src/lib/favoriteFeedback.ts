export function favoriteErrorMessage(status: number) {
  if (status === 403 || status === 404) {
    return "This listing isn’t available.";
  }
  if (status === 429) {
    return "Too many save attempts. Try again shortly.";
  }
  return "Couldn’t update saved items. Please try again.";
}
