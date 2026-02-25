// utils/pushNotifications.ts
// Mobile-side only. Asks for permission, gets the Expo push token,
// and saves it to your backend so the server can send notifications.

import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'https://your-site.com'; // ← update this

export async function registerPushToken(
  accessToken: string,
  deviceName: string
): Promise<void> {
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
  const tokenData = await Notifications.getExpoPushTokenAsync();
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
}