import { useLocalSearchParams, useRouter } from "expo-router";
import { FC, useEffect, useState, useRef } from "react";
import { ScrollView, Text, View, TouchableOpacity, StyleSheet, Alert, TextInput, Modal } from "react-native";
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import {
  getWorkflows, getBatch, updateBatchStep, completeBatchStep,
  getDeviceName, wasteBatch, deductIngredientsForBatch,
  Workflow, Batch
} from "../../services/database";
import { createBatchCompletionReport, createWasteReport } from "../../services/reports";
import BatchTimer, { BatchTimerRef } from '../components/BatchTimer';
import YouTubeVideo from '../components/YouTubeVideo';
import { useTheme } from '../../contexts/ThemeContext';
import { useVoiceCommands, VoiceCommand } from '../../hooks/useVoiceCommands';
import { supabase } from '../../lib/supabase';

const haptics = {
  light: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
  medium: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium),
  heavy: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy),
  success: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
  warning: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning),
  error: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error),
  selection: () => Haptics.selectionAsync(),
};

export const StepScreen: FC = () => {
  const router = useRouter();
  const { colors } = useTheme();
  const { batchId } = useLocalSearchParams<{ batchId: string }>();

  const [batch, setBatch] = useState<Batch | null>(null);
  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [checkedItems, setCheckedItems] = useState<Set<string>>(new Set());
  const [wasteModalVisible, setWasteModalVisible] = useState(false);
  const [wasteNotes, setWasteNotes] = useState('');
  const [wasting, setWasting] = useState(false);

  const timerRef = useRef<BatchTimerRef>(null);

  const voiceCommands: VoiceCommand[] = [
    {
      command: 'next step',
      aliases: ['next', 'continue', 'move on', 'go on'],
      action: () => handleNext(),
    },
    {
      command: 'previous step',
      aliases: ['back', 'go back', 'last step', 'previous'],
      action: () => handlePrevious(),
    },
    {
      command: 'check',
      aliases: ['tick', 'mark', 'done with', 'finished', 'got it', 'check next'],
      action: () => {
        const uncheckedItem = checklistItems.find(item => !checkedItems.has(item));
        if (uncheckedItem) {
          toggleCheckbox(uncheckedItem);
        } else {
          Alert.alert('All checked', 'All items are already completed');
        }
      },
    },
    {
      command: 'check all',
      aliases: ['tick all', 'mark all', 'all done', 'check everything'],
      action: () => {
        const newChecked = new Set(checklistItems);
        setCheckedItems(newChecked);
      },
    },
    {
      command: 'clear checklist',
      aliases: ['clear', 'clear all', 'reset checklist', 'uncheck all'],
      action: () => handleClear(),
    },
    {
      command: 'finish batch',
      aliases: ['finish', 'complete', 'done', 'all done with batch', 'finish this'],
      action: () => {
        if (currentStepIndex === workflow!.steps.length - 1) {
          handleFinish();
        } else {
          Alert.alert('Not Ready', 'Complete all steps before finishing');
        }
      },
    },
    {
      command: 'start timer',
      aliases: ['timer start', 'begin timer', 'run timer', 'go timer'],
      action: () => timerRef.current?.start(),
    },
    {
      command: 'pause timer',
      aliases: ['timer pause', 'stop timer', 'timer stop', 'hold timer', 'hold'],
      action: () => timerRef.current?.pause(),
    },
    {
      command: 'add minute',
      aliases: ['plus one minute', 'one more minute', 'add a minute', 'extend timer', 'more time'],
      action: () => timerRef.current?.addMinute(),
    },
    {
      command: 'reset timer',
      aliases: ['timer reset', 'restart timer', 'clear timer'],
      action: () => timerRef.current?.reset(),
    },
  ];

  const { isListening, recognizedText, error: voiceError, startListening, stopListening } =
    useVoiceCommands(voiceCommands);

  useEffect(() => {
    const loadBatchData = async () => {
      if (!batchId) return;
      const b = getBatch(batchId);
      if (b) {
        setBatch(b);
        setCurrentStepIndex(b.currentStepIndex);
        const allWorkflows = await getWorkflows();
        const wf = allWorkflows.find(w => w.id === b.workflowId);
        if (wf) setWorkflow(wf);
      }
    };
    loadBatchData();
  }, [batchId, currentStepIndex]);

  if (!batch || !workflow) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.errorContainer}>
          <Text style={[styles.errorText, { color: colors.textSecondary }]}>
            {!batchId ? 'No batch ID provided' : !batch ? 'Batch not found' : 'Workflow not found'}
          </Text>
          <TouchableOpacity
            style={[styles.backButton, { backgroundColor: colors.primary }]}
            onPress={() => router.back()}
          >
            <Text style={styles.backButtonText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const currentStep = workflow.steps[currentStepIndex];

  if (!currentStep) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.errorContainer}>
          <Text style={[styles.errorText, { color: colors.textSecondary }]}>
            No step found at index {currentStepIndex}
          </Text>
          <TouchableOpacity
            style={[styles.backButton, { backgroundColor: colors.primary }]}
            onPress={() => router.back()}
          >
            <Text style={styles.backButtonText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const extractChecklistItems = (step: any): string[] => {
    if (step.ingredients && Array.isArray(step.ingredients) && step.ingredients.length > 0) {
      return step.ingredients;
    }
    if (step.checklistItems && Array.isArray(step.checklistItems) && step.checklistItems.length > 0) {
      return step.checklistItems;
    }
    const checklistMatch = step.description.match(/Checklist:\n([\s\S]*?)(?=\n\n|$)/);
    if (!checklistMatch) return [];
    return checklistMatch[1]
      .split('\n')
      .map((line: string) => line.replace(/^[\s\-\*]+/, '').trim())
      .filter(Boolean);
  };

  const extractYouTubeUrl = (description: string): string | null => {
    const match = description.match(/Video:\s*(https?:\/\/[^\s]+)/);
    return match ? match[1] : null;
  };

  const applyBatchMultiplier = (text: string, multiplier: number): string => {
    if (multiplier === 1) return text;
    return text.replace(/(\d+(?:\.\d+)?)\s*(g|kg|ml|L|oz|lb|cup|tbsp|tsp)/gi, (match, number, unit) => {
      const originalNum = parseFloat(number);
      const newNum = originalNum * multiplier;
      const rounded = Math.round(newNum * 10) / 10;
      return `${rounded}${unit}`;
    });
  };

  const checklistItems = extractChecklistItems(currentStep).map(item =>
    applyBatchMultiplier(item, batch.batchSizeMultiplier)
  );

  const youtubeUrl = extractYouTubeUrl(currentStep.description);

  const displayDescription = applyBatchMultiplier(
    currentStep.description
      .replace(/Checklist:\n[\s\S]*?(?=\n\n|$)/, '')
      .replace(/Video:\s*https?:\/\/[^\s]+/, '')
      .trim(),
    batch.batchSizeMultiplier
  );

  const allItemsChecked = checklistItems.length > 0 && checklistItems.every(item => checkedItems.has(item));
  const isLastStep = currentStepIndex === workflow.steps.length - 1;

  const handleNext = async () => {
    if (checklistItems.length > 0 && !allItemsChecked) {
      haptics.warning();
      Alert.alert('Incomplete', 'Please check all items before proceeding.');
      return;
    }
    haptics.success();
    await completeBatchStep(batchId!, currentStep.id);
    if (currentStepIndex < workflow.steps.length - 1) {
      const newIndex = currentStepIndex + 1;
      setCurrentStepIndex(newIndex);
      await updateBatchStep(batchId!, newIndex);
      setCheckedItems(new Set());
    }
  };

  const handleFinish = async () => {
    if (checklistItems.length > 0 && !allItemsChecked) {
      haptics.warning();
      Alert.alert('Incomplete', 'Please check all items before finishing.');
      return;
    }

    await completeBatchStep(batchId!, currentStep.id);

    try {
      const deviceName = await getDeviceName();
      const endTime = Date.now();
      const startTime = batch.createdAt;
      const actualDuration = Math.round((endTime - startTime) / 1000 / 60);

      let deductResult = { deducted: [] as any[], skipped: [] as string[] };
      try {
        deductResult = await deductIngredientsForBatch(
          batchId!,
          workflow,
          workflow.steps.length - 1,
          batch.batchSizeMultiplier,
          false
        );
      } catch (invErr) {
        console.warn('Inventory deduction failed (non-fatal):', invErr);
      }

      await createBatchCompletionReport(
        batchId!,
        batch.name,
        workflow.id,
        workflow.name,
        deviceName,
        batch.batchSizeMultiplier,
        actualDuration
      );

      try {
        const { data: { user: currentUser } } = await supabase.auth.getUser();
        if (currentUser) {
          const { data: activeEntry } = await supabase
            .from('time_entries')
            .select('location_id, owner_id')
            .eq('user_id', currentUser.id)
            .is('clock_out', null)
            .maybeSingle();

          if (activeEntry?.location_id) {
            const today = new Date().toISOString().split('T')[0];
            const endISO = new Date().toISOString();
            const startISO = new Date(batch.createdAt).toISOString();
            const durationMinutes = Math.round(
              (new Date(endISO).getTime() - batch.createdAt) / 60000
            );

            const { data: scheduledBatch } = await supabase
              .from('scheduled_batches')
              .select('id')
              .eq('workflow_id', workflow.id)
              .eq('location_id', activeEntry.location_id)
              .eq('scheduled_date', today)
              .eq('status', 'in_progress')
              .maybeSingle();

            await supabase.from('task_completions').insert({
              owner_id: activeEntry.owner_id,
              user_id: currentUser.id,
              location_id: activeEntry.location_id,
              task_date: today,
              task_type: 'scheduled_batch',
              source_id: scheduledBatch?.id ?? batchId,
              title: batch.name,
              completion_mode: 'guided',
              start_time: startISO,
              end_time: endISO,
              duration_minutes: durationMinutes,
              batch_completion_report_id: null,
              notes: null,
            });

            if (scheduledBatch?.id) {
              await supabase
                .from('scheduled_batches')
                .update({ status: 'completed', completed_at: endISO, updated_at: endISO })
                .eq('id', scheduledBatch.id);
            }
          }
        }
      } catch (taskErr) {
        console.warn('task_completions write failed (non-fatal):', taskErr);
      }

      haptics.success();

      const skippedMsg = deductResult.skipped.length > 0
        ? `\n\nNote: ${deductResult.skipped.length} ingredient(s) not found in inventory: ${deductResult.skipped.join(', ')}`
        : '';

      Alert.alert(
        'Batch Complete',
        `You have completed ${batch.name}\n\nReport saved!${skippedMsg}`,
        [{ text: 'Done', onPress: () => router.back() }]
      );
    } catch (error) {
      console.error('Error finishing batch:', error);
      haptics.success();
      Alert.alert('Batch Complete', `${batch.name} finished.`, [
        { text: 'Done', onPress: () => router.back() }
      ]);
    }
  };

  const handleWasteConfirm = async () => {
    if (!batchId || !workflow || wasting) return;
    setWasting(true);

    try {
      haptics.heavy();

      await wasteBatch(batchId, currentStepIndex, wasteNotes || undefined);

      let deductResult = { deducted: [] as any[], skipped: [] as string[] };
      try {
        deductResult = await deductIngredientsForBatch(
          batchId,
          workflow,
          currentStepIndex,
          batch.batchSizeMultiplier,
          true
        );
      } catch (invErr) {
        console.warn('Inventory deduction failed (non-fatal):', invErr);
      }

      const deviceName = await getDeviceName();
      const endTime = Date.now();
      const actualDuration = Math.round((endTime - batch.createdAt) / 1000 / 60);

      await createWasteReport(
        batchId,
        batch.name,
        workflow.id,
        workflow.name,
        deviceName,
        batch.batchSizeMultiplier,
        currentStepIndex,
        currentStep.title,
        wasteNotes || undefined,
        deductResult.deducted,
        deductResult.skipped,
        actualDuration,
      );

      setWasteModalVisible(false);

      const stepInfo = `Step ${currentStepIndex + 1} of ${workflow.steps.length}: "${currentStep.title}"`;
      const deductedMsg = deductResult.deducted.length > 0
        ? `\n\n${deductResult.deducted.length} ingredient(s) deducted from inventory.`
        : '';
      const skippedMsg = deductResult.skipped.length > 0
        ? `\n${deductResult.skipped.length} not found in inventory: ${deductResult.skipped.join(', ')}`
        : '';

      Alert.alert(
        'Batch Marked as Wasted',
        `${batch.name} wasted at ${stepInfo}.${deductedMsg}${skippedMsg}`,
        [{ text: 'OK', onPress: () => router.back() }]
      );
    } catch (error) {
      console.error('Error wasting batch:', error);
      haptics.error();
      Alert.alert('Error', 'Failed to mark batch as wasted. Please try again.');
      setWasting(false);
    }
  };

  const handlePrevious = async () => {
    if (currentStepIndex > 0) {
      const newIndex = currentStepIndex - 1;
      setCurrentStepIndex(newIndex);
      await updateBatchStep(batchId!, newIndex);
      setCheckedItems(new Set());
    }
  };

  const handleClear = () => {
    haptics.light();
    setCheckedItems(new Set());
  };

  const toggleCheckbox = (item: string) => {
    haptics.light();
    const newChecked = new Set(checkedItems);
    if (newChecked.has(item)) {
      newChecked.delete(item);
    } else {
      newChecked.add(item);
    }
    setCheckedItems(newChecked);
  };

  const isSubRecipeLink = (item: unknown): boolean => {
    return typeof item === 'string' && item.includes('*See') && item.includes('recipe');
  };

  const extractSubRecipeName = (item: unknown): string => {
    if (typeof item !== 'string') return '';
    const match = /\*See (.+?) recipe/.exec(item);
    return match?.[1] ?? '';
  };

  const handleSubRecipeClick = async (subRecipeName: string) => {
    const allWorkflows = await getWorkflows();
    const subWorkflow = allWorkflows.find(w =>
      w.name.toLowerCase().includes(subRecipeName.toLowerCase())
    );
    if (subWorkflow) {
      Alert.alert(
        subRecipeName,
        'Open this sub-recipe?',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Open',
            onPress: async () => {
              const { createBatch } = require('../../services/database');
              const subBatch = await createBatch(subWorkflow.id, batch.mode);
              router.push({ pathname: '/screens/StepScreen', params: { batchId: subBatch.id } });
            }
          }
        ]
      );
    }
  };

  return (
    <>
      <ScrollView
        style={[styles.container, { backgroundColor: colors.background }]}
        contentContainerStyle={styles.content}
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.progressContainer}>
            <Text style={[styles.progressText, { color: colors.textSecondary }]}>
              Step {currentStepIndex + 1} of {workflow.steps.length}
            </Text>
            <View style={[styles.progressBar, { backgroundColor: colors.border }]}>
              <View
                style={[
                  styles.progressFill,
                  {
                    width: `${((currentStepIndex + 1) / workflow.steps.length) * 100}%`,
                    backgroundColor: colors.primary
                  }
                ]}
              />
            </View>
          </View>

          <View style={styles.headerButtons}>
            <TouchableOpacity
              onPress={isListening ? stopListening : startListening}
              style={[styles.micButton, { backgroundColor: isListening ? colors.error : colors.success }]}
            >
              <Ionicons name={isListening ? "stop" : "mic"} size={24} color="white" />
            </TouchableOpacity>

            {checklistItems.length > 0 && (
              <TouchableOpacity
                onPress={handleClear}
                style={[styles.clearButton, { backgroundColor: colors.textSecondary }]}
              >
                <Text style={styles.clearButtonText}>Clear</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Voice status */}
        {recognizedText && !isListening && (
          <View style={[styles.voiceStatusBanner, { backgroundColor: colors.primary + '20', borderColor: colors.primary }]}>
            <Text style={[styles.voiceStatusText, { color: colors.text }]}>
              Heard: "{recognizedText}"
            </Text>
          </View>
        )}
        {voiceError && (
          <View style={[styles.voiceStatusBanner, { backgroundColor: colors.error + '20', borderColor: colors.error }]}>
            <Text style={[styles.voiceStatusText, { color: colors.error }]}>{voiceError}</Text>
          </View>
        )}

        {/* Step title */}
        <View style={styles.stepHeader}>
          <Text style={[styles.stepTitle, { color: colors.text }]}>{currentStep.title}</Text>
          {batch.batchSizeMultiplier !== 1 && (
            <View style={[styles.multiplierBadge, { backgroundColor: colors.primary }]}>
              <Text style={styles.multiplierText}>{batch.batchSizeMultiplier}x</Text>
            </View>
          )}
        </View>

        {/* Instructions */}
        {displayDescription ? (
          <View style={[styles.card, { backgroundColor: colors.surface, shadowColor: colors.shadow }]}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Instructions</Text>
            <Text style={[styles.description, { color: colors.textSecondary }]}>{displayDescription}</Text>
          </View>
        ) : null}

        {/* YouTube Video */}
        {youtubeUrl && (
          <View style={[styles.card, { backgroundColor: colors.surface, shadowColor: colors.shadow }]}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Video Tutorial</Text>
            <YouTubeVideo url={youtubeUrl} />
          </View>
        )}

        {/* Checklist */}
        {checklistItems.length > 0 && (
          <View style={[styles.card, { backgroundColor: colors.surface, shadowColor: colors.shadow }]}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              Checklist ({checkedItems.size}/{checklistItems.length})
            </Text>
            {checklistItems.map((item, index) => {
              const isLink = isSubRecipeLink(item);
              const isChecked = checkedItems.has(item);
              return (
                <View key={index} style={styles.checklistItem}>
                  <TouchableOpacity onPress={() => toggleCheckbox(item)} style={styles.checkbox}>
                    <View style={[
                      styles.checkboxBox,
                      { borderColor: colors.primary },
                      isChecked && { backgroundColor: colors.primary }
                    ]}>
                      {isChecked && <Text style={styles.checkmark}>✓</Text>}
                    </View>
                  </TouchableOpacity>
                  {isLink ? (
                    <TouchableOpacity
                      onPress={() => handleSubRecipeClick(extractSubRecipeName(item))}
                      style={styles.linkContainer}
                    >
                      <Text style={[styles.linkText, { color: colors.primary }]}>{item}</Text>
                    </TouchableOpacity>
                  ) : (
                    <Text style={[styles.checklistText, { color: colors.text }]}>{item}</Text>
                  )}
                </View>
              );
            })}
          </View>
        )}

        {/* Timer */}
        {currentStep.timerMinutes != null && (
          <View style={[styles.card, { backgroundColor: colors.surface, shadowColor: colors.shadow }]}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Timer</Text>
            <BatchTimer
              ref={timerRef}
              durationMinutes={currentStep.timerMinutes}
            />
          </View>
        )}

        {/* Voice help */}
        {isListening && (
          <View style={[styles.card, { backgroundColor: colors.surface + '80', shadowColor: colors.shadow }]}>
            <Text style={[styles.sectionTitle, { color: colors.text, fontSize: 14 }]}>Voice Commands:</Text>
            <Text style={[styles.voiceHelpText, { color: colors.textSecondary }]}>
              Next / Previous step{'\n'}
              Check / Check all / Clear checklist{'\n'}
              Start timer / Pause timer{'\n'}
              Add minute / Reset timer{'\n'}
              Finish batch (last step only)
            </Text>
          </View>
        )}

        {/* Navigation */}
        <View style={styles.navigationContainer}>
          <TouchableOpacity
            onPress={handlePrevious}
            style={[
              styles.navButton,
              { backgroundColor: colors.textSecondary },
              currentStepIndex === 0 && { backgroundColor: colors.disabled }
            ]}
            disabled={currentStepIndex === 0}
          >
            <Text style={styles.navButtonText}>Previous</Text>
          </TouchableOpacity>

          {isLastStep ? (
            <TouchableOpacity
              onPress={handleFinish}
              style={[
                styles.navButton,
                { backgroundColor: colors.success },
                (!allItemsChecked && checklistItems.length > 0) && { backgroundColor: colors.disabled }
              ]}
              disabled={!allItemsChecked && checklistItems.length > 0}
            >
              <Text style={styles.navButtonText}>Finish</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              onPress={handleNext}
              style={[
                styles.navButton,
                { backgroundColor: colors.primary },
                (!allItemsChecked && checklistItems.length > 0) && { backgroundColor: colors.disabled }
              ]}
              disabled={!allItemsChecked && checklistItems.length > 0}
            >
              <Text style={styles.navButtonText}>Next</Text>
            </TouchableOpacity>
          )}
        </View>

        {(!allItemsChecked && checklistItems.length > 0) && (
          <View style={[styles.warningContainer, { backgroundColor: colors.warning + '20', borderColor: colors.warning }]}>
            <Text style={[styles.warningText, { color: colors.warning }]}>
              Check all items to continue
            </Text>
          </View>
        )}

        <TouchableOpacity
          onPress={() => {
            haptics.warning();
            setWasteNotes('');
            setWasteModalVisible(true);
          }}
          style={[styles.wasteButton, { borderColor: colors.error }]}
        >
          <Text style={[styles.wasteButtonText, { color: colors.error }]}>
            Mark Batch as Wasted
          </Text>
        </TouchableOpacity>

      </ScrollView>

      {/* Waste Modal */}
      <Modal
        visible={wasteModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => !wasting && setWasteModalVisible(false)}
      >
        <View style={styles.wasteModalOverlay}>
          <View style={[styles.wasteModal, { backgroundColor: colors.surface }]}>
            <Text style={[styles.wasteModalTitle, { color: colors.error }]}>
              Mark Batch as Wasted
            </Text>
            <Text style={[styles.wasteModalBody, { color: colors.text }]}>
              {batch.name}
            </Text>
            <Text style={[styles.wasteModalMeta, { color: colors.textSecondary }]}>
              Wasted at: Step {currentStepIndex + 1} — "{currentStep.title}"
            </Text>
            <Text style={[styles.wasteModalMeta, { color: colors.textSecondary }]}>
              Ingredients from steps 1–{currentStepIndex + 1} will be deducted from inventory.
              {currentStepIndex < workflow.steps.length - 1
                ? ` Steps ${currentStepIndex + 2}–${workflow.steps.length} will NOT be deducted.`
                : ''}
            </Text>

            <Text style={[styles.wasteInputLabel, { color: colors.text }]}>
              Reason (optional):
            </Text>
            <TextInput
              style={[styles.wasteInput, {
                color: colors.text,
                borderColor: colors.border,
                backgroundColor: colors.background,
              }]}
              placeholder="e.g. dropped, contaminated, over-proofed..."
              placeholderTextColor={colors.textSecondary}
              value={wasteNotes}
              onChangeText={setWasteNotes}
              multiline
              numberOfLines={3}
              editable={!wasting}
            />

            <View style={styles.wasteModalButtons}>
              <TouchableOpacity
                onPress={() => setWasteModalVisible(false)}
                disabled={wasting}
                style={[styles.wasteModalCancel, { borderColor: colors.border }]}
              >
                <Text style={[styles.wasteModalCancelText, { color: colors.textSecondary }]}>
                  Cancel
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={handleWasteConfirm}
                disabled={wasting}
                style={[styles.wasteModalConfirm, { backgroundColor: wasting ? colors.disabled : colors.error }]}
              >
                <Text style={styles.wasteModalConfirmText}>
                  {wasting ? 'Saving...' : 'Confirm Waste'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 20, paddingBottom: 40 },
  errorContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  errorText: { fontSize: 16, textAlign: 'center', marginBottom: 20 },
  backButton: { paddingHorizontal: 24, paddingVertical: 12, borderRadius: 8 },
  backButtonText: { color: 'white', fontSize: 16, fontWeight: '600' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 },
  progressContainer: { flex: 1, marginRight: 12 },
  progressText: { fontSize: 14, marginBottom: 8, fontWeight: '600' },
  progressBar: { height: 8, borderRadius: 4, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 4 },
  headerButtons: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  micButton: { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 3, elevation: 3 },
  clearButton: { paddingHorizontal: 16, paddingVertical: 12, borderRadius: 8, height: 44, justifyContent: 'center' },
  clearButtonText: { color: 'white', fontSize: 14, fontWeight: '600' },
  voiceStatusBanner: { padding: 10, borderRadius: 8, marginBottom: 12, borderWidth: 1 },
  voiceStatusText: { fontSize: 13, fontWeight: '500', textAlign: 'center' },
  voiceHelpText: { fontSize: 13, lineHeight: 22 },
  stepHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 20, gap: 12 },
  stepTitle: { fontSize: 28, fontWeight: 'bold', flex: 1 },
  multiplierBadge: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  multiplierText: { color: 'white', fontSize: 16, fontWeight: 'bold' },
  card: { borderRadius: 12, padding: 16, marginBottom: 16, shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 3, elevation: 2 },
  sectionTitle: { fontSize: 18, fontWeight: '700', marginBottom: 12 },
  description: { fontSize: 16, lineHeight: 24 },
  checklistItem: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 12 },
  checkbox: { padding: 4 },
  checkboxBox: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  checkmark: { color: 'white', fontSize: 16, fontWeight: 'bold' },
  checklistText: { flex: 1, fontSize: 16, lineHeight: 24 },
  linkContainer: { flex: 1 },
  linkText: { fontSize: 16, lineHeight: 24, textDecorationLine: 'underline' },
  navigationContainer: { flexDirection: 'row', gap: 12, marginTop: 20 },
  navButton: { flex: 1, padding: 16, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  navButtonText: { color: 'white', fontSize: 16, fontWeight: '600' },
  warningContainer: { borderWidth: 1, borderRadius: 8, padding: 12, marginTop: 16 },
  warningText: { fontSize: 14, fontWeight: '600', textAlign: 'center' },
  wasteButton: { marginTop: 24, padding: 14, borderRadius: 12, borderWidth: 1.5, alignItems: 'center' },
  wasteButtonText: { fontSize: 15, fontWeight: '600' },
  wasteModalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  wasteModal: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40 },
  wasteModalTitle: { fontSize: 22, fontWeight: 'bold', marginBottom: 8 },
  wasteModalBody: { fontSize: 18, fontWeight: '600', marginBottom: 6 },
  wasteModalMeta: { fontSize: 14, lineHeight: 20, marginBottom: 8 },
  wasteInputLabel: { fontSize: 14, fontWeight: '600', marginTop: 12, marginBottom: 6 },
  wasteInput: { borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 15, minHeight: 80, textAlignVertical: 'top' },
  wasteModalButtons: { flexDirection: 'row', gap: 12, marginTop: 20 },
  wasteModalCancel: { flex: 1, padding: 14, borderRadius: 12, borderWidth: 1, alignItems: 'center' },
  wasteModalCancelText: { fontSize: 16, fontWeight: '600' },
  wasteModalConfirm: { flex: 1, padding: 14, borderRadius: 12, alignItems: 'center' },
  wasteModalConfirmText: { color: 'white', fontSize: 16, fontWeight: '700' },
});

export default StepScreen;