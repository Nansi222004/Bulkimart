import { createNavigationContainerRef } from '@react-navigation/native';

// Lets push-notification handlers navigate from outside a screen.
export const navigationRef = createNavigationContainerRef();

export function navigateTo(target) {
  if (!target || !navigationRef.isReady()) return false;
  navigationRef.navigate(target.screen, target.params);
  return true;
}
