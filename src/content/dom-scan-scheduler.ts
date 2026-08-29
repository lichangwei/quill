type ScheduleFrame = (callback: FrameRequestCallback) => number;

export function createDomScanScheduler(
  scan: (root: Element) => void,
  scheduleFrame: ScheduleFrame = requestAnimationFrame,
): (root: Element) => void {
  let frame: number | null = null;
  const pendingRoots = new Set<Element>();

  return (root: Element) => {
    for (const pendingRoot of pendingRoots) {
      if (pendingRoot.contains(root)) return;
      if (root.contains(pendingRoot)) pendingRoots.delete(pendingRoot);
    }
    pendingRoots.add(root);
    if (frame !== null) return;

    frame = scheduleFrame(() => {
      frame = null;
      const roots = Array.from(pendingRoots);
      pendingRoots.clear();
      for (const pendingRoot of roots) scan(pendingRoot);
    });
  };
}
