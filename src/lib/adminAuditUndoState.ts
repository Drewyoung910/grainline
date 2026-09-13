export const ADMIN_AUDIT_UNDO_WINDOW_HOURS = 24;

export function canUndoAdminActionForActor({
  actionAdminId,
  actingAdminId,
}: {
  actionAdminId: string
  actingAdminId: string
}): boolean {
  return actionAdminId !== actingAdminId
}

export function adminUndoActorBlockReason({
  actionAdminId,
  actingAdminId,
}: {
  actionAdminId: string
  actingAdminId: string
}): string | null {
  if (!canUndoAdminActionForActor({ actionAdminId, actingAdminId })) {
    return 'Admins cannot undo their own actions'
  }
  return null
}

export function adminUndoWindowBlockReason({
  createdAt,
  now = new Date(),
}: {
  createdAt: Date
  now?: Date
}): string | null {
  const hoursAgo = (now.getTime() - createdAt.getTime()) / 3600000
  if (hoursAgo > ADMIN_AUDIT_UNDO_WINDOW_HOURS) return 'Undo window expired (24 hours)'
  return null
}
