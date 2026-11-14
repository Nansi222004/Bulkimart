/**
 * Android shows one runtime-permission dialog at a time. A second PermissionsAndroid.request made while a
 * dialog is open is answered "denied" without any prompt, so on first launch the location request that raced
 * the notification prompt was lost. Every permission request goes through this queue and runs one at a time.
 */
let chain = Promise.resolve();

export function queuePermission(request) {
  const run = chain.then(request, request);
  chain = run.catch(() => {});
  return run;
}
