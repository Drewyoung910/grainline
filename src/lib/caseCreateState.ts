export function caseEstimatedDeliveryBlockMessage(estimatedDeliveryDate: Date) {
  const formatted = new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(estimatedDeliveryDate);

  return `You can open a case after the estimated delivery date (${formatted}) if the order still has not arrived.`;
}
