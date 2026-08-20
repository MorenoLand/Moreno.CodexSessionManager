let runtimePromise;
function desktopWindow() { return typeof window !== 'undefined' && Boolean(window.wails); }
function runtime() { if (!desktopWindow()) return Promise.resolve(null); runtimePromise ||= import('@wailsio/runtime'); return runtimePromise; }
export function hasDesktopWindow() { return desktopWindow(); }
export async function minimiseWindow() { const runtimeModule = await runtime(); if (runtimeModule) await runtimeModule.Window.Minimise(); }
export async function toggleMaximiseWindow() { const runtimeModule = await runtime(); if (runtimeModule) await runtimeModule.Window.ToggleMaximise(); }
export async function closeWindow() { const runtimeModule = await runtime(); if (runtimeModule) await runtimeModule.Window.Close(); }
export async function isWindowMaximised() { const runtimeModule = await runtime(); return runtimeModule ? runtimeModule.Window.IsMaximised() : false; }
export function subscribeWindowState(onMaximised) {
  if (!desktopWindow()) return () => {};
  let disposed = false;
  let unsubscribe = [];
  runtime().then(runtimeModule => {
    if (!runtimeModule || disposed) return;
    unsubscribe = [runtimeModule.Events.On('common:WindowMaximise', () => onMaximised(true)), runtimeModule.Events.On('common:WindowUnMaximise', () => onMaximised(false)), runtimeModule.Events.On('common:WindowRestore', () => onMaximised(false))];
  }).catch(() => {});
  return () => { disposed = true; unsubscribe.forEach(unsubscribeEvent => unsubscribeEvent()); };
}
