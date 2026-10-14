// Abort saves work; generation checks also cover transports that ignore abort.
export function createLatestRequest() {
  let generation = 0, controller;
  return {
    start() {
      controller?.abort(); controller = new AbortController();
      const current = ++generation;
      return { signal: controller.signal, isCurrent: () => current === generation && !controller.signal.aborted };
    },
    cancel() { generation++; controller?.abort(); },
  };
}
export const serviceApplicationId = value => typeof value === 'string' && /^[0-9a-f]{24}$/i.test(value) ? value : null;
