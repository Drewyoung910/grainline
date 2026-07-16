export function clampTooltipCenter(
  desiredCenter: number,
  containerWidth: number,
  tooltipWidth: number,
  edgeGap = 8,
) {
  if (containerWidth <= 0 || tooltipWidth <= 0) return desiredCenter;

  const halfTooltip = tooltipWidth / 2;
  const minCenter = edgeGap + halfTooltip;
  const maxCenter = containerWidth - edgeGap - halfTooltip;

  if (maxCenter < minCenter) return containerWidth / 2;
  return Math.min(maxCenter, Math.max(minCenter, desiredCenter));
}
