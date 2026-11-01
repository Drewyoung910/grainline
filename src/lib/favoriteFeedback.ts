export function favoriteErrorMessage(status: number, code?: string) {
  if (code === "ACCOUNT_SUSPENDED") {
    return "Your account has been suspended. Contact support@thegrainline.com.";
  }
  if (code === "ACCOUNT_DELETED") {
    return "This account has been deleted. Contact support@thegrainline.com.";
  }
  if (status === 403 || status === 404) {
    return "This listing isn’t available.";
  }
  if (status === 429) {
    return "Too many save attempts. Try again shortly.";
  }
  return "Couldn’t update saved items. Please try again.";
}
