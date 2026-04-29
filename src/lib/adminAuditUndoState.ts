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
