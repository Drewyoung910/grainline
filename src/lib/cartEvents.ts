"use client";

const CART_UPDATED_EVENT = "cart:updated";
const CART_CHANNEL = "grainline-cart";

export function notifyCartUpdated() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(CART_UPDATED_EVENT));
  if (!("BroadcastChannel" in window)) return;
  const channel = new BroadcastChannel(CART_CHANNEL);
  channel.postMessage({ type: CART_UPDATED_EVENT });
  channel.close();
}

export function subscribeCartUpdated(onUpdated: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(CART_UPDATED_EVENT, onUpdated);
  let channel: BroadcastChannel | null = null;
  if ("BroadcastChannel" in window) {
    channel = new BroadcastChannel(CART_CHANNEL);
    channel.onmessage = (event) => {
      if (event.data?.type === CART_UPDATED_EVENT) onUpdated();
    };
  }
  return () => {
    window.removeEventListener(CART_UPDATED_EVENT, onUpdated);
    channel?.close();
  };
}
