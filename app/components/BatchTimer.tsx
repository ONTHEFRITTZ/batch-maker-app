// app/components/BatchTimer.tsx

import React, { useState, useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from 'react';
import { Text, TouchableOpacity, View, StyleSheet, TextInput, Modal, Vibration } from 'react-native';
import { Audio } from 'expo-av';
import { useTheme } from '../../contexts/ThemeContext';

export interface BatchTimerRef {
  start: () => void;
  pause: () => void;
  toggleStartPause: () => void;
  reset: () => void;
  addMinute: () => void;
}

interface BatchTimerProps {
  durationMinutes: number;
}

const BatchTimer = forwardRef<BatchTimerRef, BatchTimerProps>(function BatchTimer({ durationMinutes }, ref) {
  const { colors } = useTheme();

  // Total seconds this timer was set to (can grow with +1 min)
  const [targetSeconds, setTargetSeconds] = useState(durationMinutes * 60);
  // Seconds elapsed while running
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editInput, setEditInput] = useState('');

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const soundRef = useRef<Audio.Sound | null>(null);
  const hasAlertedRef = useRef(false);

  const remainingSeconds = targetSeconds - elapsedSeconds;
  const isExpired = remainingSeconds <= 0;
  // Once expired, count upward from 0
  const overSeconds = isExpired ? Math.abs(remainingSeconds) : 0;

  // Tick
  useEffect(() => {
    if (isRunning) {
      intervalRef.current = setInterval(() => {
        setElapsedSeconds(prev => prev + 1);
      }, 1000);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [isRunning]);

  // Alert on expiry — fire once
  useEffect(() => {
    if (isExpired && isRunning && !hasAlertedRef.current) {
      hasAlertedRef.current = true;
      fireExpiryAlert();
    }
  }, [isExpired, isRunning]);

  async function fireExpiryAlert() {
    Vibration.vibrate([0, 500, 200, 500, 200, 500]);
    try {
      await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });
      const { sound } = await Audio.Sound.createAsync(
        require('../../assets/sounds/timer-alert.mp3'),
        { shouldPlay: true, volume: 1.0 }
      );
      soundRef.current = sound;
      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.isLoaded && status.didJustFinish) {
          sound.unloadAsync();
        }
      });
    } catch {
      // Audio file missing or permission denied — vibration already fired, continue silently
    }
  }

  // Cleanup sound on unmount
  useEffect(() => {
    return () => {
      if (soundRef.current) soundRef.current.unloadAsync();
    };
  }, []);

  function handleStartPause() {
    setIsRunning(prev => !prev);
  }

  function handleReset() {
    setIsRunning(false);
    setElapsedSeconds(0);
    setTargetSeconds(durationMinutes * 60);
    hasAlertedRef.current = false;
  }

  function handleAddMinute() {
    // Always additive — works whether running or paused
    setTargetSeconds(prev => prev + 60);
    // If already expired, reset the alert so the new expiry fires again
    if (isExpired) hasAlertedRef.current = false;
  }

  // Expose controls to parent for voice commands
  useImperativeHandle(ref, () => ({
    start: () => { if (!isRunning) setIsRunning(true); },
    pause: () => { if (isRunning) setIsRunning(false); },
    toggleStartPause: handleStartPause,
    reset: handleReset,
    addMinute: handleAddMinute,
  }));

  function openEdit() {
    const totalMins = Math.floor(targetSeconds / 60);
    const secs = targetSeconds % 60;
    setEditInput(secs > 0 ? `${totalMins}:${secs.toString().padStart(2, '0')}` : `${totalMins}`);
    setEditModalVisible(true);
  }

  function handleEditSave() {
    const input = editInput.trim();
    let newSeconds = 0;

    if (input.includes(':')) {
      const [minsStr, secsStr] = input.split(':');
      const mins = parseInt(minsStr) || 0;
      const secs = parseInt(secsStr) || 0;
      newSeconds = mins * 60 + secs;
    } else {
      newSeconds = (parseInt(input) || 0) * 60;
    }

    if (newSeconds > 0) {
      setTargetSeconds(newSeconds);
      setElapsedSeconds(0);
      hasAlertedRef.current = false;
    }
    setEditModalVisible(false);
  }

  function formatCountdown(seconds: number): string {
    const absSeconds = Math.abs(seconds);
    const mins = Math.floor(absSeconds / 60);
    const secs = absSeconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  const progress = isExpired
    ? 0
    : Math.max(0, (remainingSeconds / targetSeconds) * 100);

  const displayTime = isExpired
    ? `+${formatCountdown(overSeconds)}`
    : formatCountdown(remainingSeconds);

  const timerColor = isExpired
    ? colors.error
    : isRunning
    ? colors.primary
    : colors.text;

  return (
    <View style={styles.container}>

      {/* Time display — tap to edit */}
      <TouchableOpacity onPress={openEdit} style={styles.timerDisplay} activeOpacity={0.7}>
        <Text style={[styles.timerText, { color: timerColor }]}>
          {displayTime}
        </Text>
        <Text style={[styles.timerLabel, { color: colors.textSecondary }]}>
          {isExpired
            ? 'Time past expiry'
            : isRunning
            ? 'Running — tap to edit'
            : 'Paused — tap to edit'}
        </Text>
      </TouchableOpacity>

      {/* Progress bar */}
      <View style={[styles.progressTrack, { backgroundColor: colors.border }]}>
        <View style={[
          styles.progressFill,
          {
            width: `${progress}%`,
            backgroundColor: isExpired ? colors.error : isRunning ? colors.primary : colors.textSecondary,
          }
        ]} />
      </View>

      {/* Controls */}
      <View style={styles.controls}>
        <TouchableOpacity
          onPress={handleStartPause}
          style={[styles.btn, { backgroundColor: isRunning ? '#f59e0b' : '#10b981' }]}
        >
          <Text style={styles.btnText}>{isRunning ? 'Pause' : 'Start'}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={handleAddMinute}
          style={[styles.btn, { backgroundColor: colors.primary }]}
        >
          <Text style={styles.btnText}>+1 Min</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={handleReset}
          style={[styles.btn, { backgroundColor: colors.textSecondary }]}
        >
          <Text style={styles.btnText}>Reset</Text>
        </TouchableOpacity>
      </View>

      {/* Edit Modal */}
      <Modal
        visible={editModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setEditModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalBox, { backgroundColor: colors.surface }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Set Timer</Text>
            <Text style={[styles.modalHint, { color: colors.textSecondary }]}>
              Enter minutes (e.g. 30) or minutes:seconds (e.g. 1:30)
            </Text>
            <TextInput
              style={[styles.modalInput, { color: colors.text, borderColor: colors.border }]}
              value={editInput}
              onChangeText={setEditInput}
              keyboardType="numbers-and-punctuation"
              autoFocus
              selectTextOnFocus
              onSubmitEditing={handleEditSave}
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity
                onPress={() => setEditModalVisible(false)}
                style={[styles.modalBtn, { backgroundColor: colors.border }]}
              >
                <Text style={[styles.modalBtnText, { color: colors.text }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleEditSave}
                style={[styles.modalBtn, { backgroundColor: colors.primary }]}
              >
                <Text style={[styles.modalBtnText, { color: '#fff' }]}>Set</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
});

export default BatchTimer;

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  timerDisplay: {
    alignItems: 'center',
    paddingVertical: 8,
    marginBottom: 12,
  },
  timerText: {
    fontSize: 56,
    fontWeight: 'bold',
    fontVariant: ['tabular-nums'],
    letterSpacing: 2,
  },
  timerLabel: {
    fontSize: 13,
    marginTop: 4,
  },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: 16,
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
  },
  controls: {
    flexDirection: 'row',
    gap: 8,
  },
  btn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  btnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  modalBox: {
    width: '100%',
    borderRadius: 16,
    padding: 24,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 6,
  },
  modalHint: {
    fontSize: 13,
    marginBottom: 16,
  },
  modalInput: {
    fontSize: 32,
    fontWeight: '600',
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    textAlign: 'center',
    marginBottom: 16,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 10,
  },
  modalBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  modalBtnText: {
    fontSize: 16,
    fontWeight: '600',
  },
});