const OPEN_SIM_DOCK = "quickcart:open-sim-dock";

/** Ask the floating ControlDock to expand. No-op during SSR. */
export function openSimDock(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(OPEN_SIM_DOCK));
}

/** Listen for open requests. Returns an unsubscribe function. */
export function subscribe(onOpen: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = () => {
    onOpen();
  };
  window.addEventListener(OPEN_SIM_DOCK, handler);
  return () => window.removeEventListener(OPEN_SIM_DOCK, handler);
}
