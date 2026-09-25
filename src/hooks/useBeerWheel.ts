import { useState, useSyncExternalStore } from "react";
import type { SessionController } from "../sessions/SessionController";
/** UI adapter only: no source, local storage, clocks, or winner selection. */
export function useBeerWheel(controller: SessionController) {
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  async function run(command: () => Promise<void>) {
    setPending(true);
    setError("");
    try {
      await command();
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Deze actie is niet gelukt. Probeer opnieuw.",
      );
    } finally {
      setPending(false);
    }
  }
  return { ...snapshot, pending, error, run };
}
