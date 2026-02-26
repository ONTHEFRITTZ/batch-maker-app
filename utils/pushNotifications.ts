// utils/pushNotifications.ts
// Mobile-side only. Asks for permission, gets the Expo push token,
// and saves it to your backend so the server can send notifications.
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'https://batchmaker.app';
const EAS_PROJECT_ID = '221ac77d-8696-45c2-8466-d710dc857ab6';

export async function registerPushToken(
  accessToken: string,
  deviceName: string
): Promise<void> {
  try {
    // Push notifications only work on real devices, not simulators
    if (!Device.isDevice) {
      console.log('[Push] Skipping — not a real device');
      return;
    }

    // Ask the user for permission
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      console.log('[Push] Permission denied by user');
      return;
    }

    // Get this device's unique Expo push token
    // projectId is required for bare/local builds
    const tokenData = await Notifications.getExpoPushTokenAsync({
      projectId: EAS_PROJECT_ID,
    });
    const token = tokenData.data;
    console.log('[Push] Token:', token);

    // Send the token to your backend to be saved in the database
    try {
      const res = await fetch(`${API_URL}/api/push/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ token, deviceName }),
      });

      if (!res.ok) {
        console.error('[Push] Failed to register token:', await res.text());
      } else {
        console.log('[Push] Token registered successfully');
      }
    } catch (err) {
      console.error('[Push] Network error registering token:', err);
    }

  } catch (err) {
    // Silently fail — push notifications are non-critical.
    // This commonly happens on local builds without full FCM setup.
    console.warn('[Push] Could not initialize push notifications:', err);
  }
}