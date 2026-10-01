#!/bin/sh
set -eu

SCRIPT="/Users/drewyoung/grainline/recovery-checkpoints/order-zero-direct-authority-20260908/order-candidate-promotion-c7d956c2-20261001/promote-order-candidate-explicit-aliases.mjs"
PROMOTION_CONFIRM="promote-reviewed-order-candidate-c7d956c2-with-explicit-aliases"
RECOVERY_CONFIRM="restore-reviewed-order-predecessor-02f27a39"

recover_on_failure_or_interruption() {
  status=$?
  trap - EXIT HUP INT TERM
  if [ "$status" -ne 0 ]; then
    ORDER_CANDIDATE_PROMOTION_RECOVERY_CONFIRM="$RECOVERY_CONFIRM" \
      node "$SCRIPT" recover-predecessor || true
  fi
  exit "$status"
}

trap recover_on_failure_or_interruption EXIT HUP INT TERM
ORDER_CANDIDATE_PROMOTION_CONFIRM="$PROMOTION_CONFIRM" \
  node "$SCRIPT" execute
trap - EXIT HUP INT TERM
