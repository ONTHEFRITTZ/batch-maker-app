// ============================================
// FILE: app/_layout.tsx
// Root layout. Init is handled by useAppInit.
// Layout only handles report init on foreground.
// ============================================

import { Stack } from 'expo-router';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import * as Linking from 'expo-linking';
import * as Notifications from 'expo-notifications';        // ← ADDED
import CustomHeader from './components/CustomHeader';
import { initializeReports } from '../services/reports';
import { ThemeProvider } from '../contexts/ThemeContext';

// ── Tell Expo how to show notifications when the app is open ─────────────────
Notifications.setNotificationHandler({                      // ← ADDED
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

Linking.addEventListener('url', (event) => {
  console.log('GLOBAL deep link:', event.url);
});

export const unstable_settings = {
  initialRouteName: 'index',
};

export default function Layout() {
  useEffect(() => {
    initializeReports().catch(() => {});

    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        initializeReports().catch(() => {});
      }
    });

    return () => sub.remove();
  }, []);

  return (
    <ThemeProvider>
      <Stack
        screenOptions={{
          header: ({ navigation }: any) => (
            <CustomHeader canGoBack={navigation.canGoBack()} />
          ),
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="callback" options={{ headerShown: false }} />
        <Stack.Screen name="screens/WorkflowSelectScreen" options={{ headerShown: true }} />
        <Stack.Screen name="screens/StepScreen" options={{ headerShown: true }} />
        <Stack.Screen name="screens/ClockInScreen" options={{ headerShown: true, title: 'Clock In / Out' }} />
        <Stack.Screen name="screens/WorkflowBuilderScreen" options={{ headerShown: true, title: 'Create Workflow' }} />
        <Stack.Screen name="screens/RecipeParserScreen" options={{ headerShown: true, title: 'Import Recipe' }} />
        <Stack.Screen name="screens/WorkflowEditorScreen" options={{ headerShown: true, title: 'Edit Workflow' }} />
        <Stack.Screen name="screens/ReportsScreen" options={{ headerShown: true, title: 'Reports' }} />
        <Stack.Screen name="screens/EnvironmentalReportScreen" options={{ headerShown: true, title: 'Environmental Report' }} />
        <Stack.Screen name="screens/URLImportScreen" options={{ headerShown: true, title: 'Import from URL' }} />
      </Stack>
    </ThemeProvider>
  );
}