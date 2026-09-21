interface LivenessSource {
  checkLiveness(): Promise<boolean>
}

interface DetachedWindowSource {
  revealDetachedWindows(): Promise<boolean>
}

/** Runs one periodic sweep and publishes only a state the panel can observe changing. */
export async function runLivenessTick(
  source: LivenessSource,
  pushState: () => void,
): Promise<void> {
  const livenessChanged = await source.checkLiveness()
  if (livenessChanged) pushState()
}

/** Sweeps after a focus transition, when a browser popup may have opened or closed. */
export async function runDetachedWindowSweep(
  source: DetachedWindowSource,
  pushState: () => void,
): Promise<void> {
  if (await source.revealDetachedWindows()) pushState()
}
