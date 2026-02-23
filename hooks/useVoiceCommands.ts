import { useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus, Platform } from 'react-native';
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition';

/* -------------------------------------------------------------------------- */
/*                                TYPES                                       */
/* -------------------------------------------------------------------------- */

export interface VoiceCommand {
  command: string;
  action: () => void;
  aliases?: string[];
}

interface VoiceCommandsOptions {
  wakeWord?: string;
  continuousListening?: boolean;
  commandTimeout?: number;
  confidenceThreshold?: number;
}

/* -------------------------------------------------------------------------- */
/*  GLOBAL FLAG — prevents two instances starting at once                     */
/* -------------------------------------------------------------------------- */

let GLOBAL_MIC_ACTIVE = false;

/* -------------------------------------------------------------------------- */
/*                              MAIN HOOK                                     */
/* -------------------------------------------------------------------------- */

export function useVoiceCommands(
  commands: VoiceCommand[],
  options: VoiceCommandsOptions = {}
) {
  const {
    wakeWord = null,
    continuousListening = true,
    commandTimeout = 5000,
    confidenceThreshold = 0.55,
  } = options;

  const [isListening, setIsListening] = useState(false);
  const [isAwake, setIsAwake] = useState(false);
  const [recognizedText, setRecognizedText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const isListeningRef    = useRef(false);
  const isAwakeRef        = useRef(false);
  const appStateRef       = useRef<AppStateStatus>(AppState.currentState);
  const restartLockRef    = useRef(false);
  const shouldRestartRef  = useRef(false);

  const commandTimeoutRef     = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restartTimeoutRef     = useRef<ReturnType<typeof setTimeout> | null>(null);
  const watchdogRef           = useRef<ReturnType<typeof setTimeout> | null>(null);
  const safeRestartTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ----------------------------- HELPERS ---------------------------------- */

  const normalize = (t: string) => t.toLowerCase().trim();

  const clearRef = (ref: React.MutableRefObject<ReturnType<typeof setTimeout> | null>) => {
    if (ref.current) { clearTimeout(ref.current); ref.current = null; }
  };

  const containsWakeWord = (text: string) =>
    wakeWord ? normalize(text).includes(normalize(wakeWord)) : true;

  /* ------------------------ CONFIDENCE MATCHING --------------------------- */

  const similarity = (a: string, b: string) => {
    const A = normalize(a).split(' ');
    const B = normalize(b).split(' ');
    const matches = A.filter(w => B.includes(w)).length;
    return matches / Math.max(A.length, B.length);
  };

  const findBestCommand = (spoken: string) => {
    let bestScore = 0;
    let bestCmd: VoiceCommand | null = null;
    for (const cmd of commands) {
      for (const phrase of [cmd.command, ...(cmd.aliases || [])]) {
        const score = similarity(spoken, phrase);
        if (score > bestScore) { bestScore = score; bestCmd = cmd; }
      }
    }
    return bestScore >= confidenceThreshold ? bestCmd : null;
  };

  /* ----------------------------- WATCHDOG --------------------------------- */

  const startWatchdog = () => {
    clearRef(watchdogRef);
    watchdogRef.current = setTimeout(() => {
      if (continuousListening && shouldRestartRef.current && !isListeningRef.current && !isAwakeRef.current) {
        safeRestartListening();
      }
    }, 7000);
  };

  const stopWatchdog = () => clearRef(watchdogRef);

  /* --------------------------- SAFE RESTART ------------------------------- */

  const safeRestartListening = async (delay = 800) => {
    if (restartLockRef.current || GLOBAL_MIC_ACTIVE || !shouldRestartRef.current) return;

    restartLockRef.current = true;
    clearRef(safeRestartTimeoutRef);

    safeRestartTimeoutRef.current = setTimeout(async () => {
      try {
        if (!shouldRestartRef.current) {
          restartLockRef.current = false;
          return;
        }
        ExpoSpeechRecognitionModule.stop();
        GLOBAL_MIC_ACTIVE = false;
        if (shouldRestartRef.current) {
          await startListening();
        }
      } catch (err) {
        console.error('Failed to restart listening:', err);
        GLOBAL_MIC_ACTIVE = false;
      } finally {
        restartLockRef.current = false;
      }
    }, delay);
  };

  /* --------------------------- COMMAND FLOW ------------------------------- */

  const resetAwake = (retry: boolean) => {
    clearRef(commandTimeoutRef);
    setIsAwake(false);
    isAwakeRef.current = false;
    setTimeout(() => {
      setRecognizedText('');
      setError(null);
      if (retry && shouldRestartRef.current) safeRestartListening(500);
    }, 800);
  };

  const processCommand = (spoken: string) => {
    setRecognizedText(spoken);
    const cmd = findBestCommand(spoken);
    if (!cmd) { setError('Command not recognized'); resetAwake(true); return; }
    try { cmd.action(); resetAwake(true); }
    catch (err) { console.error('Error executing command:', err); setError('Command failed'); resetAwake(true); }
  };

  /* --------------------------- VOICE EVENTS ------------------------------- */

  useSpeechRecognitionEvent('start', () => {
    setIsListening(true);
    isListeningRef.current = true;
    setError(null);
    if (Platform.OS === 'android') startWatchdog();
  });

  useSpeechRecognitionEvent('end', () => {
    setIsListening(false);
    isListeningRef.current = false;
    stopWatchdog();

    if (continuousListening && !isAwakeRef.current) {
      clearRef(restartTimeoutRef);
      restartTimeoutRef.current = setTimeout(() => {
        if (shouldRestartRef.current) safeRestartListening();
      }, 1000);
    }
  });

  useSpeechRecognitionEvent('result', (event) => {
    if (!event.results || event.results.length === 0) return;
    const transcripts = event.results.map((r: any) => r.transcript);
    if (transcripts.length === 0) return;
    const spoken = normalize(transcripts[0]);

    if (!event.isFinal) { setRecognizedText(spoken); return; }

    if (wakeWord && !isAwakeRef.current && containsWakeWord(spoken)) {
      setIsAwake(true);
      isAwakeRef.current = true;
      setRecognizedText('Listening…');
      clearRef(commandTimeoutRef);
      const remainder = spoken.replace(normalize(wakeWord!), '').trim();
      if (remainder) processCommand(remainder);
      else { commandTimeoutRef.current = setTimeout(() => resetAwake(true), commandTimeout); }
      return;
    }

    processCommand(spoken);
  });

  useSpeechRecognitionEvent('error', (event: any) => {
    setError(event.error || 'Speech error');
    setIsListening(false);
    isListeningRef.current = false;
    GLOBAL_MIC_ACTIVE = false;
    stopWatchdog();
    if (continuousListening && !isAwakeRef.current) {
      setTimeout(() => {
        if (shouldRestartRef.current) safeRestartListening(1500);
      }, 0);
    }
  });

  /* ---------------------------- CLEANUP ----------------------------------- */

  useEffect(() => {
    return () => {
      shouldRestartRef.current = false;
      try { ExpoSpeechRecognitionModule.stop(); } catch { /* ignore */ }
      stopWatchdog();
      clearRef(commandTimeoutRef);
      clearRef(restartTimeoutRef);
      clearRef(safeRestartTimeoutRef);
      GLOBAL_MIC_ACTIVE = false;
    };
  }, []);

  /* ---------------------------- APP STATE --------------------------------- */

  useEffect(() => {
    const sub = AppState.addEventListener('change', next => {
      const prev = appStateRef.current;
      appStateRef.current = next;
      if (prev.match(/inactive|background/) && next === 'active' && continuousListening) {
        safeRestartListening(500);
      }
      if (next !== 'active') stopWatchdog();
    });
    return () => sub.remove();
  }, [continuousListening]);

  /* ---------------------------- CONTROLS ---------------------------------- */

  const startListening = async () => {
    if (isListeningRef.current || GLOBAL_MIC_ACTIVE) return;
    try {
      shouldRestartRef.current = true;

      const { granted } = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!granted) {
        setError('Microphone permission denied');
        shouldRestartRef.current = false;
        return;
      }

      GLOBAL_MIC_ACTIVE = true;
      // Minimal options — only what Android supports reliably
      GLOBAL_MIC_ACTIVE = true;
      ExpoSpeechRecognitionModule.start({
        lang: 'en-US',
        interimResults: true,
        maxAlternatives: 1,
        continuous: continuousListening,
      });
    } catch (err) {
      console.error('Failed to start listening:', err);
      GLOBAL_MIC_ACTIVE = false;
      shouldRestartRef.current = false;
      setError('Failed to start voice recognition');
      if (Platform.OS === 'android') {
        setTimeout(() => { if (shouldRestartRef.current) safeRestartListening(1200); }, 0);
      }
    }
  };

  const stopListening = async () => {
    shouldRestartRef.current = false;
    clearRef(commandTimeoutRef);
    clearRef(restartTimeoutRef);
    clearRef(safeRestartTimeoutRef);
    stopWatchdog();
    setIsAwake(false);
    isAwakeRef.current = false;
    setIsListening(false);
    isListeningRef.current = false;
    restartLockRef.current = false;
    try {
      ExpoSpeechRecognitionModule.stop();
    } catch (err) {
      console.error('Failed to stop listening:', err);
    } finally {
      GLOBAL_MIC_ACTIVE = false;
    }
  };

  const reset = () => {
    stopListening();
    setRecognizedText('');
    setError(null);
  };

  return { isListening, isAwake, recognizedText, error, startListening, stopListening, reset, wakeWord };
}