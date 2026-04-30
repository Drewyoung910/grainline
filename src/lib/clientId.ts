let fallbackCounter = 0;

export function createClientId(prefix = "client") {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === "function") {
    return cryptoApi.randomUUID();
  }
  if (typeof cryptoApi?.getRandomValues === "function") {
    const bytes = new Uint32Array(4);
    cryptoApi.getRandomValues(bytes);
    return `${prefix}-${Array.from(bytes, (value) => value.toString(36)).join("-")}`;
  }
  fallbackCounter += 1;
  return `${prefix}-${Date.now()}-${fallbackCounter}`;
}
