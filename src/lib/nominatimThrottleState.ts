export const NOMINATIM_SHARED_THROTTLE_KEY = "reverse-geocode:nominatim:lock";
export const NOMINATIM_SHARED_THROTTLE_MS = 1100;
export const NOMINATIM_SHARED_THROTTLE_ATTEMPTS = 8;
export const NOMINATIM_SHARED_THROTTLE_RETRY_DELAY_MS = 200;

type NominatimThrottleDependencies = {
  setLock: (
    key: string,
    value: string,
    options: { nx: true; px: number },
  ) => Promise<unknown>;
  sleep: (ms: number) => Promise<void>;
  onError?: (error: unknown) => void;
  onContentionExceeded?: () => void;
};

export async function waitForNominatimSharedThrottle({
  setLock,
  sleep,
  onError,
  onContentionExceeded,
}: NominatimThrottleDependencies) {
  try {
    for (let attempt = 0; attempt < NOMINATIM_SHARED_THROTTLE_ATTEMPTS; attempt += 1) {
      const locked = await setLock(
        NOMINATIM_SHARED_THROTTLE_KEY,
        "1",
        { nx: true, px: NOMINATIM_SHARED_THROTTLE_MS },
      );
      if (locked) return true;
      if (attempt < NOMINATIM_SHARED_THROTTLE_ATTEMPTS - 1) {
        await sleep(NOMINATIM_SHARED_THROTTLE_RETRY_DELAY_MS);
      }
    }
  } catch (error) {
    onError?.(error);
    return false;
  }

  onContentionExceeded?.();
  return false;
}
