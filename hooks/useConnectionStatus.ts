// ============================================
// FILE: hooks/useConnectionStatus.ts
// Tracks real-time connectivity state,
// last sync time, and exposes a manualRetry.
// pendingCount is always 0 — sync is now
// fire-and-forget via push() in database.ts
// ============================================

import { useCallback, useEffect, useRef, useState } from 'react';
import NetInfo from '@react-native-community/netinfo';
import { syncFromServer } from '../services/database';

export type ConnectionState = 'online' | 'offline' | 'checking';

export interface ConnectionStatus {
  state: ConnectionState;
  pendingCount: number;
  lastSyncedAt: Date | null;
  manualRetry: () => Promise<void>;
}

export function useConnectionStatus(): ConnectionStatus {
  const [state, setState] = useState<ConnectionState>('checking');
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const isSyncing = useRef(false);

  const performSync = useCallback(async () => {
    if (isSyncing.current) return;
    isSyncing.current = true;
    try {
      await syncFromServer();
      setLastSyncedAt(new Date());
    } catch (err) {
      console.warn('[useConnectionStatus] sync error:', err);
    } finally {
      isSyncing.current = false;
    }
  }, []);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener(netState => {
      const isConnected = netState.isConnected && netState.isInternetReachable !== false;
      if (isConnected) {
        setState('online');
        performSync();
      } else if (netState.isConnected === false) {
        setState('offline');
      } else {
        setState('checking');
      }
    });
    return () => unsubscribe();
  }, [performSync]);

  const manualRetry = useCallback(async () => {
    setState('checking');
    try {
      await performSync();
      setState('online');
    } catch {
      setState('offline');
    }
  }, [performSync]);

  return { state, pendingCount: 0, lastSyncedAt, manualRetry };
}