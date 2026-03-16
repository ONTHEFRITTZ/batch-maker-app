import { useRouter, useFocusEffect } from "expo-router";
import React, { FC, useEffect, useState, useCallback } from "react";
import {
  Text, View, TouchableOpacity, StyleSheet, Alert,
  TextInput, Modal, Animated, ScrollView, Switch, ActivityIndicator
} from "react-native";
import {
  getWorkflows, getBatches, createBatch, duplicateBatch,
  renameBatch, deleteBatch, batchHasProgress, getMostUrgentTimer,
  batchHasExpiredTimer, getTimerStatus, formatTimeRemaining,
  claimBatch, unclaimBatch, isBatchClaimedByMe,
  archiveWorkflow, unarchiveWorkflow, getDeviceId,
  Workflow, Batch
} from "../../services/database";
import SettingsModal from "../components/SettingsModal";
import { useTheme } from "../../contexts/ThemeContext";
import { supabase } from "../../lib/supabase";

// ─── Clock-in state ────────────────────────────────────────────────────────
interface ClockInState {
  isClockedIn: boolean;
  locationId: string | null;
  locationName: string | null;
}

async function getClockInState(userId: string): Promise<ClockInState> {
  const { data } = await supabase
    .from('time_entries')
    .select('location_id')
    .eq('user_id', userId)
    .is('clock_out', null)
    .maybeSingle();

  if (data?.location_id) {
    const { data: loc } = await supabase
      .from('locations')
      .select('name')
      .eq('id', data.location_id)
      .single();
    return {
      isClockedIn: true,
      locationId: data.location_id,
      locationName: loc?.name ?? null,
    };
  }
  return { isClockedIn: false, locationId: null, locationName: null };
}

// ─── Task board types ──────────────────────────────────────────────────────
interface ScheduledTask {
  id: string;
  name: string;
  workflowId: string;
  workflowName: string | null;
  scheduledTime: string | null;
  batchSizeMultiplier: number;
  assignedToName: string | null;
  notes: string | null;
}

interface RecurringTask {
  id: string;
  title: string;
  description: string | null;
  category: string;
}

// ─── BatchItem ─────────────────────────────────────────────────────────────
const BatchItem: FC<{
  item: Batch;
  workflows: Workflow[];
  contextMenuBatch: string | null;
  renamingBatch: string | null;
  renameText: string;
  colors: any;
  isClaimed: boolean;
  setContextMenuBatch: (id: string | null) => void;
  setRenamingBatch: (id: string | null) => void;
  setRenameText: (text: string) => void;
  onRename: (id: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onClaim: (id: string) => void;
  onPress: (id: string) => void;
}> = ({
  item, workflows, contextMenuBatch, renamingBatch, renameText,
  colors, isClaimed, setContextMenuBatch, setRenamingBatch, setRenameText,
  onRename, onDuplicate, onDelete, onClaim, onPress,
}) => {
  const workflow = workflows.find(w => w.id === item.workflowId);
  if (!workflow) return null;

  const hasExpired = batchHasExpiredTimer(item);
  const isContextMenuOpen = contextMenuBatch === item.id;
  const isRenaming = renamingBatch === item.id;

  let timerDisplay = "—";
  if (item.activeTimers.length > 0) {
    const urgentTimer = getMostUrgentTimer(item);
    if (urgentTimer) {
      const status = getTimerStatus(urgentTimer);
      timerDisplay = status.isExpired ? "EXPIRED" : formatTimeRemaining(status.remainingSeconds);
    }
  }

  const modeIcon = item.mode === 'bake-today' ? '[green]' : '[blue]';
  const modeText = item.mode === 'bake-today' ? 'Make Today' : 'Cold Ferment';
  const flashAnim = React.useRef(new Animated.Value(1)).current;

  React.useEffect(() => {
    if (hasExpired) {
      const animation = Animated.loop(
        Animated.sequence([
          Animated.timing(flashAnim, { toValue: 0.3, duration: 500, useNativeDriver: true }),
          Animated.timing(flashAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
        ])
      );
      animation.start();
      return () => animation.stop();
    } else {
      flashAnim.setValue(1);
    }
  }, [hasExpired]);

  return (
    <View style={styles.batchContainer}>
      <Animated.View style={{ opacity: flashAnim }}>
        <TouchableOpacity
          style={[
            styles.batchCard,
            { backgroundColor: colors.surface, borderColor: colors.border },
            hasExpired && { backgroundColor: colors.error + '20', borderColor: colors.error, borderWidth: 2 }
          ]}
          onPress={() => onPress(item.id)}
          onLongPress={() => setContextMenuBatch(item.id)}
          delayLongPress={500}
        >
          <View style={styles.batchHeader}>
            {isRenaming ? (
              <TextInput
                style={[styles.renameInput, { color: colors.text, borderBottomColor: colors.primary }]}
                value={renameText}
                onChangeText={setRenameText}
                onBlur={() => onRename(item.id)}
                onSubmitEditing={() => onRename(item.id)}
                autoFocus
                selectTextOnFocus
              />
            ) : (
              <View>
                <Text style={[styles.batchName, { color: colors.text }]}>{item.name}</Text>
                {item.claimed_by_name && (
                  <Text style={[styles.claimedByLabel, { color: isClaimed ? colors.success : colors.warning }]}>
                    {isClaimed ? 'Your batch' : `Claimed by ${item.claimed_by_name}`}
                  </Text>
                )}
              </View>
            )}
          </View>
          <View style={styles.batchInfo}>
            <Text style={[styles.batchMode, { color: colors.textSecondary }]}>{modeIcon} {modeText}</Text>
            <Text style={[styles.batchTimer, { color: hasExpired ? colors.error : colors.primary }]}>
              {timerDisplay}
            </Text>
          </View>
          {item.activeTimers.length > 1 && (
            <Text style={[styles.timerCount, { color: colors.textSecondary }]}>
              ({item.activeTimers.length} timers active)
            </Text>
          )}
        </TouchableOpacity>
      </Animated.View>

      {isContextMenuOpen && (
        <View style={[styles.contextMenu, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <TouchableOpacity
            style={[styles.contextMenuItem, { borderBottomColor: colors.border }]}
            onPress={() => { setRenamingBatch(item.id); setRenameText(item.name); setContextMenuBatch(null); }}
          >
            <Text style={[styles.contextMenuText, { color: colors.text }]}>Rename</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.contextMenuItem, { borderBottomColor: colors.border }]}
            onPress={() => onDuplicate(item.id)}
          >
            <Text style={[styles.contextMenuText, { color: colors.text }]}>Duplicate</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.contextMenuItem, { borderBottomColor: colors.border }]}
            onPress={() => onClaim(item.id)}
          >
            <Text style={[styles.contextMenuText, { color: isClaimed ? colors.error : colors.primary }]}>
              {isClaimed ? 'Release' : 'Claim'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.contextMenuItem, { borderBottomColor: colors.border, backgroundColor: colors.error + '15' }]}
            onPress={() => onDelete(item.id)}
          >
            <Text style={[styles.contextMenuText, { color: colors.error }]}>Delete</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.contextMenuItem} onPress={() => setContextMenuBatch(null)}>
            <Text style={[styles.contextMenuText, { color: colors.textSecondary }]}>Cancel</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
};

// ─── WorkflowItem ──────────────────────────────────────────────────────────
const WorkflowItem: FC<{
  item: Workflow;
  colors: any;
  hasActiveBatches: boolean;
  isClaimed: boolean;
  contextMenuOpen: boolean;
  onSelectWorkflow: (id: string) => void;
  onLongPress: (id: string) => void;
}> = ({ item, colors, hasActiveBatches, isClaimed, contextMenuOpen, onSelectWorkflow, onLongPress }) => {
  return (
    <View style={styles.workflowContainer}>
      <TouchableOpacity
        style={[styles.workflowCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
        onPress={() => onSelectWorkflow(item.id)}
        onLongPress={() => onLongPress(item.id)}
        delayLongPress={500}
      >
        <View style={styles.workflowHeader}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.workflowName, { color: colors.text }]}>{item.name}</Text>
            <Text style={[styles.workflowSteps, { color: colors.textSecondary }]}>{item.steps.length} steps</Text>
            {item.claimedBy && !isClaimed && (
              <Text style={[styles.claimedLabel, { color: colors.warning }]}>
                {item.claimedByName || 'Another station'}
              </Text>
            )}
            {isClaimed && hasActiveBatches && (
              <Text style={[styles.claimedLabel, { color: colors.success }]}>
                You have active batches for this
              </Text>
            )}
          </View>
        </View>
      </TouchableOpacity>

      {contextMenuOpen && (
        <View style={[styles.contextMenu, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <TouchableOpacity
            style={[styles.contextMenuItem, { borderBottomColor: colors.border }]}
            onPress={() => onSelectWorkflow(item.id)}
          >
            <Text style={[styles.contextMenuText, { color: colors.text }]}>Create Batch</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.contextMenuItem} onPress={() => onLongPress('')}>
            <Text style={[styles.contextMenuText, { color: colors.textSecondary }]}>Cancel</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
};

// ─── Main screen ───────────────────────────────────────────────────────────
export const WorkflowSelectScreen: FC = () => {
  const router = useRouter();
  const { colors } = useTheme();
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [contextMenuBatch, setContextMenuBatch] = useState<string | null>(null);
  const [contextMenuWorkflow, setContextMenuWorkflow] = useState<string | null>(null);
  const [renamingBatch, setRenamingBatch] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");
  const [showNewBatchModal, setShowNewBatchModal] = useState(false);
  const [selectedWorkflow, setSelectedWorkflow] = useState<string | null>(null);
  const [showMyWorkflows, setShowMyWorkflows] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [displayedWorkflows, setDisplayedWorkflows] = useState<Workflow[]>([]);
  const [batchSizeMultiplier, setBatchSizeMultiplier] = useState(1);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [displayedBatches, setDisplayedBatches] = useState<Batch[]>([]);
  const [clockInState, setClockInState] = useState<ClockInState>({
    isClockedIn: false,
    locationId: null,
    locationName: null,
  });

  // ── Task board state ───────────────────────────────────────────────────────
  const [taskBoardVisible, setTaskBoardVisible] = useState(false);
  const [scheduledTasks, setScheduledTasks] = useState<ScheduledTask[]>([]);
  const [recurringTasks, setRecurringTasks] = useState<RecurringTask[]>([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [claimingTaskId, setClaimingTaskId] = useState<string | null>(null);

  // ── Quick complete state ───────────────────────────────────────────────────
  const [quickCompleteTask, setQuickCompleteTask] = useState<RecurringTask | null>(null);
  const [quickCompleteVisible, setQuickCompleteVisible] = useState(false);
  const [quickStartTime, setQuickStartTime] = useState('');
  const [quickEndTime, setQuickEndTime] = useState('');
  const [quickNotes, setQuickNotes] = useState('');
  const [quickSubmitting, setQuickSubmitting] = useState(false);

  // Timer tick
  useEffect(() => {
    const interval = setInterval(() => {
      setBatches([...getBatches()]);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Reload on focus
  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [])
  );

  const loadData = async () => {
    const userId = await getDeviceId();
    if (userId) {
      setCurrentUserId(userId);
      const clockState = await getClockInState(userId);
      setClockInState(clockState);
    }
    const allWorkflows = await getWorkflows();
    setWorkflows(allWorkflows);
    setBatches(getBatches());
  };

  // ── Filter workflows based on clock-in state ───────────────────────────────
  useEffect(() => {
    let filtered = workflows;
    if (clockInState.isClockedIn && clockInState.locationId) {
      filtered = filtered.filter(w => w.location_id === clockInState.locationId);
    } else {
      filtered = filtered.filter(w => !w.location_id);
    }
    if (!showArchived) {
      filtered = filtered.filter(w => !w.archived);
    }
    setDisplayedWorkflows(filtered);
  }, [showArchived, workflows, clockInState]);

  // ── Filter batches for My Workflows tab ───────────────────────────────────
  useEffect(() => {
    if (showMyWorkflows && currentUserId) {
      setDisplayedBatches(batches.filter(b => b.claimed_by === currentUserId));
    } else {
      setDisplayedBatches(batches);
    }
  }, [showMyWorkflows, batches, currentUserId]);

  // ── Helper — get owner_id for a location ──────────────────────────────────
  async function getOwnerIdForLocation(locationId: string): Promise<string> {
    const { data } = await supabase
      .from('locations')
      .select('user_id')
      .eq('id', locationId)
      .single();
    return data?.user_id ?? '';
  }

  // ── Load and open task board ───────────────────────────────────────────────
  async function openTaskBoard() {
    if (!clockInState.locationId || !currentUserId) {
      Alert.alert(
        'Not Clocked In',
        "You need to be clocked in at a location to view today's tasks."
      );
      return;
    }

    setTasksLoading(true);
    setTaskBoardVisible(true);

    try {
      const today = new Date().toISOString().split('T')[0];
      const dayOfWeek = new Date().getDay();

      // Fetch today's scheduled batches for this location
      const { data: scheduled } = await supabase
        .from('scheduled_batches')
        .select('*')
        .eq('location_id', clockInState.locationId)
        .eq('scheduled_date', today)
        .eq('status', 'scheduled')
        .order('scheduled_time', { ascending: true, nullsFirst: true });

      // Resolve workflow names
      const allWorkflows = await getWorkflows();
      const workflowMap: Record<string, string> = {};
      allWorkflows.forEach(w => { workflowMap[w.id] = w.name; });

      const mappedScheduled: ScheduledTask[] = (scheduled ?? []).map((sb: any) => ({
        id: sb.id,
        name: sb.name,
        workflowId: sb.workflow_id,
        workflowName: workflowMap[sb.workflow_id] ?? null,
        scheduledTime: sb.scheduled_time ?? null,
        batchSizeMultiplier: sb.batch_size_multiplier ?? 1,
        assignedToName: sb.assigned_to_name ?? null,
        notes: sb.notes ?? null,
      }));

      // Fetch recurring tasks for this location and owner
      const ownerId = await getOwnerIdForLocation(clockInState.locationId);
      const { data: recurring } = await supabase
        .from('recurring_tasks')
        .select('*')
        .eq('owner_id', ownerId)
        .eq('active', true)
        .or(`location_id.is.null,location_id.eq.${clockInState.locationId}`);

      const filteredRecurring: RecurringTask[] = (recurring ?? [])
        .filter((rt: any) => {
          if (rt.frequency === 'daily') return true;
          if (rt.frequency === 'weekly' && rt.days_of_week?.includes(dayOfWeek)) return true;
          if (rt.frequency === 'specific_days' && rt.days_of_week?.includes(dayOfWeek)) return true;
          return false;
        })
        .map((rt: any) => ({
          id: rt.id,
          title: rt.title,
          description: rt.description ?? null,
          category: rt.category ?? 'General',
        }));

      setScheduledTasks(mappedScheduled);
      setRecurringTasks(filteredRecurring);
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to load tasks');
    } finally {
      setTasksLoading(false);
    }
  }

  // ── Claim a scheduled batch from the task board ────────────────────────────
  async function handleClaimScheduledTask(task: ScheduledTask) {
    if (!currentUserId || !clockInState.locationId) return;
    setClaimingTaskId(task.id);
    try {
      const allWorkflows = await getWorkflows();
      const workflow = allWorkflows.find(w => w.id === task.workflowId);
      if (!workflow) {
        Alert.alert('Error', 'Workflow not found. Ask your manager to check the scheduled batch.');
        return;
      }

      // Create the batch in local state
      await createBatch(task.workflowId, 'bake-today', 1, task.batchSizeMultiplier);

      // Mark scheduled batch as in progress
      await supabase
        .from('scheduled_batches')
        .update({ status: 'in_progress', updated_at: new Date().toISOString() })
        .eq('id', task.id);

      // Write initial task_completions row — end_time updated when batch finishes
      const ownerId = await getOwnerIdForLocation(clockInState.locationId);
      const now = new Date().toISOString();
      await supabase.from('task_completions').insert({
        owner_id: ownerId,
        user_id: currentUserId,
        location_id: clockInState.locationId,
        task_date: new Date().toISOString().split('T')[0],
        task_type: 'scheduled_batch',
        source_id: task.id,
        title: task.name,
        completion_mode: 'guided',
        start_time: now,
        end_time: now,
        duration_minutes: 0,
        notes: null,
      });

      setTaskBoardVisible(false);
      await loadData();
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to claim task');
    } finally {
      setClaimingTaskId(null);
    }
  }

  // ── Quick complete a recurring task ────────────────────────────────────────
  async function handleQuickComplete() {
    if (!quickCompleteTask || !currentUserId || !clockInState.locationId) return;
    if (!quickStartTime || !quickEndTime) {
      Alert.alert('Missing Info', 'Please enter both a start time and an end time.');
      return;
    }
    setQuickSubmitting(true);
    try {
      const today = new Date().toISOString().split('T')[0];
      const startISO = new Date(`${today}T${quickStartTime}:00`).toISOString();
      const endISO = new Date(`${today}T${quickEndTime}:00`).toISOString();
      const durationMinutes = Math.max(
        0,
        Math.round((new Date(endISO).getTime() - new Date(startISO).getTime()) / 60000)
      );
      const ownerId = await getOwnerIdForLocation(clockInState.locationId);

      await supabase.from('task_completions').insert({
        owner_id: ownerId,
        user_id: currentUserId,
        location_id: clockInState.locationId,
        task_date: today,
        task_type: 'recurring_task',
        source_id: quickCompleteTask.id,
        title: quickCompleteTask.title,
        completion_mode: 'quick',
        start_time: startISO,
        end_time: endISO,
        duration_minutes: durationMinutes,
        notes: quickNotes.trim() || null,
      });

      // Remove from list so it shows as done
      setRecurringTasks(prev => prev.filter(t => t.id !== quickCompleteTask.id));
      setQuickCompleteVisible(false);
      setQuickCompleteTask(null);
      setQuickStartTime('');
      setQuickEndTime('');
      setQuickNotes('');

      Alert.alert('Task Complete', `${quickCompleteTask.title} marked as done.`);
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to complete task');
    } finally {
      setQuickSubmitting(false);
    }
  }

  // ── All existing batch/workflow handlers unchanged ─────────────────────────

  const handleCreateBatch = async (mode: 'bake-today' | 'cold-ferment') => {
    if (!selectedWorkflow) return;
    await createBatch(selectedWorkflow, mode, 1, batchSizeMultiplier);
    setShowNewBatchModal(false);
    setSelectedWorkflow(null);
    setBatchSizeMultiplier(1);
    await loadData();
  };

  const handleDuplicateBatch = async (batchId: string) => {
    await duplicateBatch(batchId);
    setContextMenuBatch(null);
    await loadData();
  };

  const handleDeleteBatch = async (batchId: string) => {
    const hasProgress = batchHasProgress(batchId);
    if (hasProgress) {
      Alert.alert('Delete Batch?', 'This batch has progress. Are you sure?', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: async () => { await deleteBatch(batchId); setContextMenuBatch(null); await loadData(); } }
      ]);
    } else {
      await deleteBatch(batchId);
      setContextMenuBatch(null);
      await loadData();
    }
  };

  const handleRenameBatch = async (batchId: string) => {
    if (renameText.trim()) {
      await renameBatch(batchId, renameText.trim());
      setRenamingBatch(null);
      setRenameText("");
      await loadData();
    }
  };

  const handleBatchPress = (batchId: string) => {
    router.push({ pathname: '/screens/StepScreen', params: { batchId } });
  };

  const handleClaimBatch = async (batchId: string) => {
    if (!currentUserId) return;
    try {
      const alreadyClaimed = isBatchClaimedByMe(batchId, currentUserId);
      if (alreadyClaimed) {
        await unclaimBatch(batchId);
      } else {
        await claimBatch(batchId);
      }
      setContextMenuBatch(null);
      await loadData();
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to update batch claim');
    }
  };

  const handleSelectWorkflow = (workflowId: string) => {
    const workflow = workflows.find(w => w.id === workflowId);
    if (!workflow) return;
    setSelectedWorkflow(workflowId);
    setShowNewBatchModal(true);
  };

  const handleArchiveWorkflow = async (workflowId: string) => {
    const workflow = workflows.find(w => w.id === workflowId);
    if (!workflow) return;
    try {
      if (workflow.archived) {
        await unarchiveWorkflow(workflowId);
      } else {
        await archiveWorkflow(workflowId);
      }
      setContextMenuWorkflow(null);
      await loadData();
    } catch (error) {
      Alert.alert('Error', 'Failed to update workflow');
    }
  };

  const handleEditWorkflow = (workflowId: string) => {
    setContextMenuWorkflow(null);
    router.push({ pathname: '/screens/WorkflowEditorScreen', params: { workflowId } });
  };

  const renderBatch = ({ item }: { item: Batch }) => {
    const isClaimed = item.claimed_by === currentUserId;
    return (
      <BatchItem
        item={item}
        workflows={workflows}
        contextMenuBatch={contextMenuBatch}
        renamingBatch={renamingBatch}
        renameText={renameText}
        colors={colors}
        isClaimed={isClaimed}
        setContextMenuBatch={setContextMenuBatch}
        setRenamingBatch={setRenamingBatch}
        setRenameText={setRenameText}
        onRename={handleRenameBatch}
        onDuplicate={handleDuplicateBatch}
        onDelete={handleDeleteBatch}
        onClaim={handleClaimBatch}
        onPress={handleBatchPress}
      />
    );
  };

  function getEmptyMessage() {
    if (clockInState.isClockedIn) {
      return { main: 'No workflows at this location', sub: 'Ask your manager to add workflows for this location' };
    }
    return { main: 'No personal workflows', sub: 'Create a workflow or clock in to see workplace workflows' };
  }

  const emptyMsg = getEmptyMessage();

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>

      {/* Clock-in status banner */}
      <View style={[
        styles.clockInBanner,
        {
          backgroundColor: clockInState.isClockedIn ? colors.success + '18' : colors.surface,
          borderBottomColor: clockInState.isClockedIn ? colors.success + '40' : colors.border,
        }
      ]}>
        <Text style={[styles.clockInBannerText, { color: clockInState.isClockedIn ? colors.success : colors.textSecondary }]}>
          {clockInState.isClockedIn
            ? `Clocked in${clockInState.locationName ? ` at ${clockInState.locationName}` : ''} — showing workplace workflows`
            : 'Not clocked in — showing personal workflows'}
        </Text>
      </View>

      {/* Tab bar */}
      <View style={[styles.toggleBar, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
        <TouchableOpacity
          style={[styles.toggleOption, !showMyWorkflows && { borderBottomColor: colors.primary, borderBottomWidth: 3 }]}
          onPress={() => setShowMyWorkflows(false)}
        >
          <Text style={[styles.toggleText, { color: !showMyWorkflows ? colors.primary : colors.textSecondary }]}>
            All Workflows
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.toggleOption, showMyWorkflows && { borderBottomColor: colors.primary, borderBottomWidth: 3 }]}
          onPress={() => setShowMyWorkflows(true)}
        >
          <Text style={[styles.toggleText, { color: showMyWorkflows ? colors.primary : colors.textSecondary }]}>
            My Workflows
          </Text>
        </TouchableOpacity>

        {/* Tasks button — only shown when clocked in */}
        {clockInState.isClockedIn && (
          <TouchableOpacity
            style={[styles.tasksButton, { borderColor: colors.primary, backgroundColor: colors.primary + '15' }]}
            onPress={openTaskBoard}
          >
            <Text style={[styles.tasksButtonText, { color: colors.primary }]}>Tasks</Text>
          </TouchableOpacity>
        )}
      </View>

      <ScrollView style={{ flex: 1 }}>
        {displayedBatches.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Active Batches</Text>
            <View style={styles.listContent}>
              {displayedBatches.map(item => (
                <View key={item.id}>{renderBatch({ item })}</View>
              ))}
            </View>
          </View>
        )}

        {!showMyWorkflows && (
          <View style={styles.section}>
            <View style={styles.sectionTitleRow}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>Start New Batch</Text>
              <View style={styles.archiveToggleContainer}>
                <Text style={[styles.archiveToggleLabel, { color: colors.textSecondary }]}>Show Archived</Text>
                <Switch
                  value={showArchived}
                  onValueChange={setShowArchived}
                  trackColor={{ false: colors.border, true: colors.primary }}
                  thumbColor={colors.surface}
                />
              </View>
            </View>

            {displayedWorkflows.length === 0 ? (
              <View style={styles.emptyState}>
                <Text style={[styles.emptyText, { color: colors.textSecondary }]}>{emptyMsg.main}</Text>
                <Text style={[styles.emptySubtext, { color: colors.textSecondary }]}>{emptyMsg.sub}</Text>
              </View>
            ) : (
              <View style={styles.listContent}>
                {displayedWorkflows.map(item => (
                  <View key={item.id}>
                    <WorkflowItem
                      item={item}
                      colors={colors}
                      hasActiveBatches={batches.some(b => b.workflowId === item.id)}
                      isClaimed={item.claimedBy === currentUserId}
                      contextMenuOpen={contextMenuWorkflow === item.id}
                      onSelectWorkflow={handleSelectWorkflow}
                      onLongPress={(id) => setContextMenuWorkflow(id === '' ? null : id)}
                    />
                    {contextMenuWorkflow === item.id && (
                      <View style={[styles.contextMenu, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                        <TouchableOpacity
                          style={[styles.contextMenuItem, { borderBottomColor: colors.border }]}
                          onPress={() => handleEditWorkflow(item.id)}
                        >
                          <Text style={[styles.contextMenuText, { color: colors.text }]}>Edit Workflow</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.contextMenuItem, { borderBottomColor: colors.border }]}
                          onPress={() => handleArchiveWorkflow(item.id)}
                        >
                          <Text style={[styles.contextMenuText, { color: colors.text }]}>
                            {item.archived ? 'Unarchive' : 'Archive'}
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.contextMenuItem}
                          onPress={() => setContextMenuWorkflow(null)}
                        >
                          <Text style={[styles.contextMenuText, { color: colors.textSecondary }]}>Cancel</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                ))}
              </View>
            )}
          </View>
        )}

        {showMyWorkflows && displayedBatches.length === 0 && (
          <View style={styles.emptyState}>
            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>No claimed batches</Text>
            <Text style={[styles.emptySubtext, { color: colors.textSecondary }]}>
              Long-press a batch and tap Claim to see it here
            </Text>
          </View>
        )}
      </ScrollView>

      {/* Settings FAB */}
      <TouchableOpacity
        style={[styles.settingsButton, { backgroundColor: colors.primary }]}
        onPress={() => setSettingsVisible(true)}
      >
        <View style={styles.line} />
        <View style={styles.line} />
        <View style={styles.line} />
      </TouchableOpacity>

      <SettingsModal
        visible={settingsVisible}
        onClose={() => { setSettingsVisible(false); loadData(); }}
        onWorkflowsUpdated={loadData}
      />

      {/* ── Create New Batch Modal (unchanged) ── */}
      <Modal
        visible={showNewBatchModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowNewBatchModal(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowNewBatchModal(false)}
        >
          <View style={[styles.modeModal, { backgroundColor: colors.surface }]}>
            <Text style={[styles.modeModalTitle, { color: colors.text }]}>Create New Batch</Text>

            <View style={styles.sizeSection}>
              <Text style={[styles.sizeSectionLabel, { color: colors.textSecondary }]}>Batch Size</Text>
              <View style={styles.sizeOptions}>
                {[0.5, 1, 2, 3].map(size => (
                  <TouchableOpacity
                    key={size}
                    style={[
                      styles.sizeButton,
                      { borderColor: colors.border },
                      batchSizeMultiplier === size && { backgroundColor: colors.primary, borderColor: colors.primary }
                    ]}
                    onPress={() => setBatchSizeMultiplier(size)}
                  >
                    <Text style={[styles.sizeButtonText, { color: batchSizeMultiplier === size ? 'white' : colors.text }]}>
                      {size}x
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {selectedWorkflow && workflows.find(w => w.id === selectedWorkflow)?.show_ferment_prompt !== false && (
              <>
                <Text style={[styles.modeSectionLabel, { color: colors.textSecondary }]}>Select Mode</Text>
                <TouchableOpacity
                  style={[styles.modeButton, { backgroundColor: colors.success + '20', borderColor: colors.success }]}
                  onPress={() => handleCreateBatch('bake-today')}
                >
                  <Text style={[styles.modeButtonText, { color: colors.text }]}>Make Today</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modeButton, { backgroundColor: colors.primary + '20', borderColor: colors.primary }]}
                  onPress={() => handleCreateBatch('cold-ferment')}
                >
                  <Text style={[styles.modeButtonText, { color: colors.text }]}>Cold Ferment</Text>
                </TouchableOpacity>
              </>
            )}

            {selectedWorkflow && workflows.find(w => w.id === selectedWorkflow)?.show_ferment_prompt === false && (
              <TouchableOpacity
                style={[styles.modeButton, { backgroundColor: colors.primary + '20', borderColor: colors.primary, marginTop: 12 }]}
                onPress={() => handleCreateBatch('bake-today')}
              >
                <Text style={[styles.modeButtonText, { color: colors.text }]}>Create Batch</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={styles.modeCancelButton}
              onPress={() => { setShowNewBatchModal(false); setSelectedWorkflow(null); setBatchSizeMultiplier(1); }}
            >
              <Text style={[styles.modeCancelText, { color: colors.textSecondary }]}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* ── Task Board Bottom Sheet ── */}
      <Modal
        visible={taskBoardVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setTaskBoardVisible(false)}
      >
        <View style={styles.taskBoardOverlay}>
          <View style={[styles.taskBoardSheet, { backgroundColor: colors.background }]}>

            {/* Header */}
            <View style={[styles.taskBoardHeader, { borderBottomColor: colors.border }]}>
              <View>
                <Text style={[styles.taskBoardTitle, { color: colors.text }]}>Today's Tasks</Text>
                {clockInState.locationName && (
                  <Text style={[styles.taskBoardSubtitle, { color: colors.textSecondary }]}>
                    {clockInState.locationName}
                  </Text>
                )}
              </View>
              <TouchableOpacity
                onPress={() => setTaskBoardVisible(false)}
                style={[styles.taskBoardCloseButton, { backgroundColor: colors.surface }]}
              >
                <Text style={[styles.taskBoardCloseText, { color: colors.textSecondary }]}>X</Text>
              </TouchableOpacity>
            </View>

            {tasksLoading ? (
              <View style={styles.taskBoardLoading}>
                <ActivityIndicator size="large" color={colors.primary} />
                <Text style={[styles.taskBoardLoadingText, { color: colors.textSecondary }]}>
                  Loading tasks...
                </Text>
              </View>
            ) : (
              <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>

                {/* Scheduled batches */}
                {scheduledTasks.length > 0 && (
                  <View style={styles.taskSection}>
                    <Text style={[styles.taskSectionLabel, { color: colors.textSecondary }]}>
                      SCHEDULED BATCHES
                    </Text>
                    {scheduledTasks.map(task => (
                      <View
                        key={task.id}
                        style={[
                          styles.taskCard,
                          { backgroundColor: colors.surface, borderLeftColor: '#0d9488' },
                        ]}
                      >
                        <View style={styles.taskCardContent}>
                          <View style={{ flex: 1 }}>
                            <Text style={[styles.taskCardTitle, { color: colors.text }]}>
                              {task.name}
                            </Text>
                            {task.workflowName && task.workflowName !== task.name && (
                              <Text style={[styles.taskCardMeta, { color: colors.textSecondary }]}>
                                {task.workflowName}
                              </Text>
                            )}
                            {task.scheduledTime && (
                              <Text style={[styles.taskCardMeta, { color: colors.textSecondary }]}>
                                {task.scheduledTime.slice(0, 5)}
                              </Text>
                            )}
                            {task.batchSizeMultiplier !== 1 && (
                              <Text style={[styles.taskCardMeta, { color: colors.textSecondary }]}>
                                {task.batchSizeMultiplier}x batch
                              </Text>
                            )}
                            {task.notes && (
                              <Text style={[styles.taskCardMeta, { color: colors.textSecondary, fontStyle: 'italic' }]}>
                                {task.notes}
                              </Text>
                            )}
                          </View>
                          <TouchableOpacity
                            style={[styles.taskActionButton, { backgroundColor: '#0d9488' }]}
                            onPress={() => handleClaimScheduledTask(task)}
                            disabled={claimingTaskId === task.id}
                          >
                            {claimingTaskId === task.id
                              ? <ActivityIndicator size="small" color="#fff" />
                              : <Text style={styles.taskActionButtonText}>Start</Text>
                            }
                          </TouchableOpacity>
                        </View>
                      </View>
                    ))}
                  </View>
                )}

                {/* Recurring tasks */}
                {recurringTasks.length > 0 && (
                  <View style={styles.taskSection}>
                    <Text style={[styles.taskSectionLabel, { color: colors.textSecondary }]}>
                      RECURRING TASKS
                    </Text>
                    {recurringTasks.map(task => (
                      <View
                        key={task.id}
                        style={[
                          styles.taskCard,
                          { backgroundColor: colors.surface, borderLeftColor: '#0891b2' },
                        ]}
                      >
                        <View style={styles.taskCardContent}>
                          <View style={{ flex: 1 }}>
                            <Text style={[styles.taskCardTitle, { color: colors.text }]}>
                              {task.title}
                            </Text>
                            {task.category !== 'General' && (
                              <Text style={[styles.taskCardMeta, { color: colors.textSecondary }]}>
                                {task.category}
                              </Text>
                            )}
                            {task.description && (
                              <Text style={[styles.taskCardMeta, { color: colors.textSecondary }]}>
                                {task.description}
                              </Text>
                            )}
                          </View>
                          <TouchableOpacity
                            style={[styles.taskActionButton, { backgroundColor: '#0891b2' }]}
                            onPress={() => {
                              const now = new Date();
                              const hh = now.getHours().toString().padStart(2, '0');
                              const mm = now.getMinutes().toString().padStart(2, '0');
                              setQuickStartTime(`${hh}:${mm}`);
                              setQuickEndTime(`${hh}:${mm}`);
                              setQuickNotes('');
                              setQuickCompleteTask(task);
                              setQuickCompleteVisible(true);
                            }}
                          >
                            <Text style={styles.taskActionButtonText}>Done</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    ))}
                  </View>
                )}

                {scheduledTasks.length === 0 && recurringTasks.length === 0 && (
                  <View style={styles.taskBoardEmpty}>
                    <Text style={[styles.taskBoardEmptyText, { color: colors.textSecondary }]}>
                      No tasks scheduled for today at this location.
                    </Text>
                  </View>
                )}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* ── Quick Complete Modal ── */}
      <Modal
        visible={quickCompleteVisible}
        transparent
        animationType="fade"
        onRequestClose={() => { if (!quickSubmitting) setQuickCompleteVisible(false); }}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.quickCompleteModal, { backgroundColor: colors.surface }]}>
            <Text style={[styles.quickCompleteTitle, { color: colors.text }]}>
              Quick Complete
            </Text>
            {quickCompleteTask && (
              <Text style={[styles.quickCompleteSubtitle, { color: colors.textSecondary }]}>
                {quickCompleteTask.title}
              </Text>
            )}

            <Text style={[styles.quickCompleteLabel, { color: colors.text }]}>Start Time (HH:MM)</Text>
            <TextInput
              style={[styles.quickCompleteInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
              value={quickStartTime}
              onChangeText={setQuickStartTime}
              placeholder="09:00"
              placeholderTextColor={colors.textSecondary}
              keyboardType="numbers-and-punctuation"
              editable={!quickSubmitting}
            />

            <Text style={[styles.quickCompleteLabel, { color: colors.text }]}>End Time (HH:MM)</Text>
            <TextInput
              style={[styles.quickCompleteInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
              value={quickEndTime}
              onChangeText={setQuickEndTime}
              placeholder="09:30"
              placeholderTextColor={colors.textSecondary}
              keyboardType="numbers-and-punctuation"
              editable={!quickSubmitting}
            />

            <Text style={[styles.quickCompleteLabel, { color: colors.text }]}>Notes (optional)</Text>
            <TextInput
              style={[
                styles.quickCompleteInput,
                styles.quickCompleteTextArea,
                { color: colors.text, borderColor: colors.border, backgroundColor: colors.background },
              ]}
              value={quickNotes}
              onChangeText={setQuickNotes}
              placeholder="Any notes..."
              placeholderTextColor={colors.textSecondary}
              multiline
              numberOfLines={3}
              editable={!quickSubmitting}
            />

            <View style={styles.quickCompleteButtons}>
              <TouchableOpacity
                style={[styles.quickCompleteCancelButton, { borderColor: colors.border }]}
                onPress={() => setQuickCompleteVisible(false)}
                disabled={quickSubmitting}
              >
                <Text style={[styles.quickCompleteCancelText, { color: colors.textSecondary }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.quickCompleteConfirmButton,
                  { backgroundColor: quickSubmitting ? colors.disabled : '#0891b2' },
                ]}
                onPress={handleQuickComplete}
                disabled={quickSubmitting}
              >
                {quickSubmitting
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Text style={styles.quickCompleteConfirmText}>Mark Done</Text>
                }
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  clockInBanner: { paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: 1 },
  clockInBannerText: { fontSize: 13, fontWeight: '600', textAlign: 'center' },
  toggleBar: { flexDirection: 'row', borderBottomWidth: 1, alignItems: 'center' },
  toggleOption: { flex: 1, paddingVertical: 16, alignItems: 'center' },
  toggleText: { fontSize: 16, fontWeight: '600' },
  tasksButton: {
    marginRight: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1.5,
  },
  tasksButtonText: { fontSize: 13, fontWeight: '700' },
  section: { marginBottom: 24 },
  sectionTitle: { fontSize: 22, fontWeight: 'bold', paddingHorizontal: 20, paddingTop: 20, paddingBottom: 12 },
  sectionTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 20, paddingBottom: 12 },
  archiveToggleContainer: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  archiveToggleLabel: { fontSize: 14, fontWeight: '600' },
  listContent: { paddingHorizontal: 20 },
  emptyState: { padding: 40, alignItems: 'center' },
  emptyText: { fontSize: 18, fontWeight: '600', marginBottom: 8 },
  emptySubtext: { fontSize: 14, textAlign: 'center' },
  batchContainer: { marginBottom: 12 },
  batchCard: { borderRadius: 12, padding: 16, elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 3, borderWidth: 1 },
  batchHeader: { marginBottom: 8 },
  batchName: { fontSize: 18, fontWeight: '700' },
  claimedByLabel: { fontSize: 12, marginTop: 4, fontWeight: '600' },
  batchInfo: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  batchMode: { fontSize: 14 },
  batchTimer: { fontSize: 16, fontWeight: '600' },
  timerCount: { fontSize: 12, marginTop: 4, fontStyle: 'italic' },
  renameInput: { fontSize: 18, fontWeight: '700', borderBottomWidth: 2, paddingVertical: 4 },
  contextMenu: { position: 'absolute', top: 0, right: 0, left: 0, borderRadius: 12, elevation: 999, shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.5, shadowRadius: 12, zIndex: 99999, borderWidth: 2 },
  contextMenuItem: { padding: 16, borderBottomWidth: 1 },
  contextMenuText: { fontSize: 16, fontWeight: '600' },
  workflowCard: { padding: 20, borderRadius: 12, marginBottom: 12, elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 3, borderWidth: 1 },
  workflowHeader: { flexDirection: 'row', alignItems: 'center' },
  workflowName: { fontSize: 18, fontWeight: '600', marginBottom: 4 },
  workflowSteps: { fontSize: 14 },
  claimedLabel: { fontSize: 12, marginTop: 4, fontWeight: '600' },
  workflowContainer: { marginBottom: 12 },
  settingsButton: { position: 'absolute', bottom: 30, right: 30, width: 70, height: 70, borderRadius: 35, justifyContent: 'center', alignItems: 'center', elevation: 8, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 5, zIndex: 9999 },
  line: { width: 30, height: 4, backgroundColor: 'white', marginVertical: 3, borderRadius: 2 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
  modeModal: { borderRadius: 20, padding: 24, width: '80%', maxWidth: 300 },
  modeModalTitle: { fontSize: 24, fontWeight: 'bold', textAlign: 'center', marginBottom: 24 },
  sizeSection: { marginBottom: 20 },
  sizeSectionLabel: { fontSize: 14, marginBottom: 8, fontWeight: '600' },
  sizeOptions: { flexDirection: 'row', gap: 8 },
  sizeButton: { flex: 1, padding: 12, borderRadius: 8, borderWidth: 2, alignItems: 'center' },
  sizeButtonText: { fontSize: 16, fontWeight: '600' },
  modeSectionLabel: { fontSize: 14, marginBottom: 12, fontWeight: '600' },
  modeButton: { padding: 16, borderRadius: 12, borderWidth: 2, marginBottom: 12, alignItems: 'center' },
  modeButtonText: { fontSize: 18, fontWeight: '600' },
  modeCancelButton: { padding: 12, marginTop: 8 },
  modeCancelText: { fontSize: 16, textAlign: 'center' },

  // Task board
  taskBoardOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  taskBoardSheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '85%', minHeight: '40%' },
  taskBoardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, borderBottomWidth: 1 },
  taskBoardTitle: { fontSize: 20, fontWeight: '700' },
  taskBoardSubtitle: { fontSize: 13, marginTop: 2 },
  taskBoardCloseButton: { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center' },
  taskBoardCloseText: { fontSize: 14, fontWeight: '700' },
  taskBoardLoading: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  taskBoardLoadingText: { marginTop: 12, fontSize: 14 },
  taskBoardEmpty: { padding: 40, alignItems: 'center' },
  taskBoardEmptyText: { fontSize: 15, textAlign: 'center' },
  taskSection: { paddingHorizontal: 16, paddingTop: 20 },
  taskSectionLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.8, marginBottom: 10 },
  taskCard: { borderRadius: 12, marginBottom: 10, padding: 14, borderLeftWidth: 4, elevation: 1, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 2 },
  taskCardContent: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  taskCardTitle: { fontSize: 15, fontWeight: '600', marginBottom: 2 },
  taskCardMeta: { fontSize: 12, marginTop: 1 },
  taskActionButton: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, minWidth: 64, alignItems: 'center', justifyContent: 'center' },
  taskActionButtonText: { color: '#fff', fontSize: 14, fontWeight: '700' },

  // Quick complete
  quickCompleteModal: { borderRadius: 20, padding: 24, width: '85%', maxWidth: 340 },
  quickCompleteTitle: { fontSize: 20, fontWeight: '700', marginBottom: 4 },
  quickCompleteSubtitle: { fontSize: 14, marginBottom: 16 },
  quickCompleteLabel: { fontSize: 13, fontWeight: '600', marginTop: 12, marginBottom: 6 },
  quickCompleteInput: { borderWidth: 1, borderRadius: 8, padding: 10, fontSize: 15 },
  quickCompleteTextArea: { minHeight: 72, textAlignVertical: 'top' },
  quickCompleteButtons: { flexDirection: 'row', gap: 10, marginTop: 20 },
  quickCompleteCancelButton: { flex: 1, padding: 14, borderRadius: 12, borderWidth: 1, alignItems: 'center' },
  quickCompleteCancelText: { fontSize: 15, fontWeight: '600' },
  quickCompleteConfirmButton: { flex: 1, padding: 14, borderRadius: 12, alignItems: 'center' },
  quickCompleteConfirmText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});

export default WorkflowSelectScreen;