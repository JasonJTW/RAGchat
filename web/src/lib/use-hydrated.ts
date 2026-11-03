import { useSyncExternalStore } from "react";

const noopSubscribe = () => () => {};

/**
 * False in the server-rendered HTML, true once React has hydrated. Until then
 * buttons have no handlers, so keep them disabled instead of ignoring clicks.
 */
export function useHydrated() {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}
