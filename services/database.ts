// ============================================
// FILE: services/database.ts
// LOCAL-FIRST ARCHITECTURE
//
// Source of truth: in-memory cache + AsyncStorage
// Supabase: fire-and-forget background sync only
// The UI never waits on Supabase for anything.
// ============================================

import { supabase } from '../lib/supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ============================================
// INTERFACES
// ============================================

export interface Step {
  id: string;
  title: string;
  description: string;
  timerMinutes?: number;
  completed?: boolean;
  ingredients?: string[];
}

export interface Workflow {
  id: string;
  name: string;
  steps: Step[];
  claimedBy?: string;
  claimedByName?: string;
  user_id?: string;
  location_id?: string;
  description?: string;
  ingredients?: any[];
  servings?: string;
  source_url?: string;
  total_time_minutes?: number;
  created_at?: string;
  updated_at?: string;
  archived?: boolean;
  archived_at?: string;
  show_ferment_prompt?: boolean;
  yield_amount?: number | null;
  yield_unit?: string | null;
}

export interface Timer {
  id: string;
  stepId: string;
  startedAt: number;
  duration: number; // seconds
  acknowledged: boolean;
}

export interface Batch {
  id: string;
  workflowId: string;
  name: string;
  mode: 'bake-today' | 'cold-ferment';
  unitsPerBatch: number;
  batchSizeMultiplier: number;
  currentStepIndex: number;
  completedSteps: string[];
  activeTimers: Timer[];
  createdAt: number;
  user_id?: string;
  owner_id?: string;
  claimed_by?: string;
  claimed_by_name?: string;
  location_id?: string;
  created_at?: string;
  updated_at?: string;
  // Waste tracking
  wasted_at?: string;
  wasted_at_step?: number;
  waste_notes?: string;
}

// ============================================
// IN-MEMORY CACHE — runtime source of truth
// ============================================

let cachedWorkflows: Workflow[] = [];
let cachedBatches: Batch[] = [];
let cachedUserId: string | null = null;
let cachedDeviceName: string | null = null;

// ============================================
// ASYNCSTORAGE — persists cache across launches
// ============================================

const STORAGE_KEY_WORKFLOWS = '@db_workflows_v2';
const STORAGE_KEY_BATCHES   = '@db_batches_v2';

async function persistWorkflows(w: Workflow[]): Promise<void> {
  try { await AsyncStorage.setItem(STORAGE_KEY_WORKFLOWS, JSON.stringify(w)); } catch {}
}

async function persistBatches(b: Batch[]): Promise<void> {
  try { await AsyncStorage.setItem(STORAGE_KEY_BATCHES, JSON.stringify(b)); } catch {}
}

async function loadPersistedWorkflows(): Promise<Workflow[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY_WORKFLOWS);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

async function loadPersistedBatches(): Promise<Batch[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY_BATCHES);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

// ============================================
// FIRE-AND-FORGET — never blocks the UI
// ============================================

function push(fn: () => Promise<void>): void {
  fn().catch(err => console.warn('[DB sync]', err?.message || err));
}

// ============================================
// DEVICE / USER
// ============================================

export async function getDeviceId(): Promise<string> {
  if (cachedUserId) return cachedUserId;
  const { data: { user } } = await supabase.auth.getUser();
  cachedUserId = user?.id || '';
  return cachedUserId!;
}

export async function getDeviceName(): Promise<string> {
  if (cachedDeviceName) return cachedDeviceName;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return 'Unnamed Station';
  const { data: profile } = await supabase
    .from('profiles').select('device_name').eq('id', user.id).single();
  cachedDeviceName = profile?.device_name || user.email || 'Unnamed Station';
  return cachedDeviceName!;
}

export async function setDeviceName(name: string): Promise<void> {
  cachedDeviceName = name;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  await supabase.from('profiles').upsert({
    id: user.id, device_name: name, updated_at: new Date().toISOString(),
  });
}

// ============================================
// INITIALIZATION
// Shows persisted data instantly, syncs in bg
// ============================================

export async function initializeDatabase(): Promise<void> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { cachedWorkflows = []; cachedBatches = []; return; }

    cachedUserId = user.id;

    // Load from AsyncStorage immediately — no network, instant UI
    const [pw, pb] = await Promise.all([
      loadPersistedWorkflows(),
      loadPersistedBatches(),
    ]);
    if (pw.length > 0) cachedWorkflows = pw;
    if (pb.length > 0) cachedBatches   = pb;

    console.log(`[DB] Cache loaded: ${cachedWorkflows.length} workflows, ${cachedBatches.length} batches`);

    // Sync from Supabase in background — never blocks startup
    _bgSync(user.id);
  } catch (err) {
    console.error('[DB] initializeDatabase error:', err);
  }
}

async function _bgSync(userId: string): Promise<void> {
  try {
    const [workflows, batches] = await Promise.all([
      _fetchWorkflows(userId),
      _fetchBatches(userId),
    ]);
    if (workflows) { cachedWorkflows = workflows; persistWorkflows(cachedWorkflows); }
    if (batches)   { cachedBatches   = batches;   persistBatches(cachedBatches); }
    console.log(`[DB] Synced: ${cachedWorkflows.length} workflows, ${cachedBatches.length} batches`);
  } catch (err) {
    console.warn('[DB] Background sync failed (offline?):', err);
  }
}

async function _fetchWorkflows(userId: string): Promise<Workflow[] | null> {
  const { data, error } = await supabase
    .from('workflows').select('*')
    .eq('user_id', userId).is('deleted_at', null)
    .order('created_at', { ascending: false });
  if (error) { console.warn('[DB] workflow fetch:', error.message); return null; }
  return data || [];
}

async function _fetchBatches(userId: string): Promise<Batch[] | null> {
  const { data, error } = await supabase
    .from('batches').select('*')
    .or(`user_id.eq.${userId},owner_id.eq.${userId}`)
    .order('created_at', { ascending: false });
  if (error) { console.warn('[DB] batch fetch:', error.message); return null; }
  return (data || []).map(dbBatchToApp);
}

// ============================================
// WORKFLOW MANAGEMENT
// ============================================

export async function getWorkflows(): Promise<Workflow[]> {
  if (cachedWorkflows.length > 0) return [...cachedWorkflows];
  const persisted = await loadPersistedWorkflows();
  if (persisted.length > 0) { cachedWorkflows = persisted; return [...cachedWorkflows]; }
  const userId = await getDeviceId();
  if (!userId) return [];
  const workflows = await _fetchWorkflows(userId);
  if (workflows) { cachedWorkflows = workflows; persistWorkflows(cachedWorkflows); }
  return [...cachedWorkflows];
}

export async function setWorkflows(newWorkflows: Workflow[]): Promise<void> {
  const userId = await getDeviceId();
  if (!userId) throw new Error('Must be signed in');

  cachedWorkflows = newWorkflows;
  persistWorkflows(cachedWorkflows);

  push(async () => {
    const existing = await _fetchWorkflows(userId);
    const newIds = new Set(newWorkflows.map(w => w.id));
    for (const w of (existing || [])) {
      if (!newIds.has(w.id)) {
        await supabase.from('workflows').delete().eq('id', w.id).eq('user_id', userId);
      }
    }
    for (const workflow of newWorkflows) {
      const { error } = await supabase.from('workflows').upsert({
        id: workflow.id, name: workflow.name, steps: workflow.steps,
        user_id: userId,
        claimed_by: workflow.claimedBy || null,
        claimed_by_name: workflow.claimedByName || null,
        archived: workflow.archived || false,
        archived_at: workflow.archived_at || null,
        show_ferment_prompt: workflow.show_ferment_prompt ?? true,
        yield_amount: workflow.yield_amount ?? null,
        yield_unit: workflow.yield_unit ?? null,
        updated_at: new Date().toISOString(),
      });
      if (error) throw error;
    }
  });
}

export async function addWorkflow(newWorkflow: Workflow): Promise<void> {
  const userId = await getDeviceId();
  if (!userId) throw new Error('Must be signed in');

  cachedWorkflows.push({ ...newWorkflow, user_id: userId });
  persistWorkflows(cachedWorkflows);

  console.log('📥 addWorkflow:', newWorkflow.name);

  push(async () => {
    const { error } = await supabase.from('workflows').insert({
      id: newWorkflow.id, name: newWorkflow.name, steps: newWorkflow.steps,
      user_id: userId,
      claimed_by: newWorkflow.claimedBy || null,
      claimed_by_name: newWorkflow.claimedByName || null,
      archived: newWorkflow.archived || false,
      archived_at: newWorkflow.archived_at || null,
      show_ferment_prompt: newWorkflow.show_ferment_prompt ?? true,
      yield_amount: newWorkflow.yield_amount ?? null,
      yield_unit: newWorkflow.yield_unit ?? null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    if (error) throw error;
    console.log('✅ Workflow synced to Supabase');
  });
}

export async function resetWorkflows(): Promise<void> {
  const userId = await getDeviceId();
  cachedWorkflows = [];
  await AsyncStorage.removeItem(STORAGE_KEY_WORKFLOWS);

  push(async () => {
    const { error } = await supabase.from('workflows')
      .update({ deleted_at: new Date().toISOString() })
      .eq('user_id', userId).is('deleted_at', null);
    if (error) throw error;
  });
}

export async function markStepCompleted(workflowId: string, stepId: string, completed: boolean): Promise<void> {
  const workflow = cachedWorkflows.find(w => w.id === workflowId);
  if (!workflow) return;
  const step = workflow.steps.find(s => s.id === stepId);
  if (!step) return;
  step.completed = completed;
  persistWorkflows(cachedWorkflows);

  push(async () => {
    const { error } = await supabase.from('workflows')
      .update({ steps: workflow.steps, updated_at: new Date().toISOString() })
      .eq('id', workflowId);
    if (error) throw error;
  });
}

export async function archiveWorkflow(workflowId: string): Promise<void> {
  const workflow = cachedWorkflows.find(w => w.id === workflowId);
  if (!workflow) return;
  workflow.archived = true;
  workflow.archived_at = new Date().toISOString();
  persistWorkflows(cachedWorkflows);

  push(async () => {
    const { error } = await supabase.from('workflows').update({
      archived: true, archived_at: workflow.archived_at,
      updated_at: new Date().toISOString(),
    }).eq('id', workflowId);
    if (error) throw error;
  });
}

export async function unarchiveWorkflow(workflowId: string): Promise<void> {
  const workflow = cachedWorkflows.find(w => w.id === workflowId);
  if (!workflow) return;
  workflow.archived = false;
  workflow.archived_at = undefined;
  persistWorkflows(cachedWorkflows);

  push(async () => {
    const { error } = await supabase.from('workflows').update({
      archived: false, archived_at: null, updated_at: new Date().toISOString(),
    }).eq('id', workflowId);
    if (error) throw error;
  });
}

// ============================================
// WORKFLOW CLAIMS
// ============================================

export async function claimWorkflow(workflowId: string): Promise<void> {
  const userId = await getDeviceId();
  const deviceName = await getDeviceName();
  const workflow = cachedWorkflows.find(w => w.id === workflowId);
  if (workflow) { workflow.claimedBy = userId; workflow.claimedByName = deviceName; }
  persistWorkflows(cachedWorkflows);

  push(async () => {
    const { error } = await supabase.from('workflows').update({
      claimed_by: userId, claimed_by_name: deviceName,
      updated_at: new Date().toISOString(),
    }).eq('id', workflowId);
    if (error) throw error;
  });
}

export async function unclaimWorkflow(workflowId: string): Promise<void> {
  const userId = await getDeviceId();
  const workflow = cachedWorkflows.find(w => w.id === workflowId);
  if (workflow) { workflow.claimedBy = undefined; workflow.claimedByName = undefined; }
  persistWorkflows(cachedWorkflows);

  push(async () => {
    const { error } = await supabase.from('workflows').update({
      claimed_by: null, claimed_by_name: null, updated_at: new Date().toISOString(),
    }).eq('id', workflowId).eq('claimed_by', userId);
    if (error) throw error;
  });
}

export async function getClaimedWorkflows(): Promise<Workflow[]> {
  const userId = await getDeviceId();
  return cachedWorkflows.filter(w => w.claimedBy === userId);
}

export async function getUnclaimedWorkflows(): Promise<Workflow[]> {
  return cachedWorkflows.filter(w => !w.claimedBy);
}

export async function isWorkflowClaimedByMe(workflowId: string): Promise<boolean> {
  const userId = await getDeviceId();
  return cachedWorkflows.find(w => w.id === workflowId)?.claimedBy === userId;
}

// ============================================
// BATCH CLAIMS
// ============================================

export async function claimBatch(batchId: string): Promise<void> {
  const userId = await getDeviceId();
  const deviceName = await getDeviceName();
  const batch = cachedBatches.find(b => b.id === batchId);
  if (batch) { batch.claimed_by = userId; batch.claimed_by_name = deviceName; }
  persistBatches(cachedBatches);

  push(async () => {
    const { error } = await supabase.from('batches').update({
      claimed_by: userId, claimed_by_name: deviceName,
      updated_at: new Date().toISOString(),
    }).eq('id', batchId);
    if (error) throw error;
  });
}

export async function unclaimBatch(batchId: string): Promise<void> {
  const userId = await getDeviceId();
  const batch = cachedBatches.find(b => b.id === batchId);
  if (batch) { batch.claimed_by = undefined; batch.claimed_by_name = undefined; }
  persistBatches(cachedBatches);

  push(async () => {
    const { error } = await supabase.from('batches').update({
      claimed_by: null, claimed_by_name: null, updated_at: new Date().toISOString(),
    }).eq('id', batchId).eq('claimed_by', userId);
    if (error) throw error;
  });
}

export function isBatchClaimedByMe(batchId: string, userId: string): boolean {
  return cachedBatches.find(b => b.id === batchId)?.claimed_by === userId;
}

// ============================================
// BATCH MANAGEMENT
// ============================================

function dbBatchToApp(db: any): Batch {
  return {
    id: db.id,
    workflowId: db.workflow_id,
    name: db.name,
    mode: db.mode,
    unitsPerBatch: db.units_per_batch || 1,
    batchSizeMultiplier: db.batch_size_multiplier || 1,
    currentStepIndex: db.current_step_index || 0,
    completedSteps: db.completed_steps || [],
    activeTimers: db.active_timers || [],
    createdAt: new Date(db.created_at).getTime(),
    user_id: db.user_id,
    owner_id: db.owner_id,
    claimed_by: db.claimed_by,
    claimed_by_name: db.claimed_by_name,
    location_id: db.location_id,
    created_at: db.created_at,
    updated_at: db.updated_at,
    wasted_at: db.wasted_at || undefined,
    wasted_at_step: db.wasted_at_step ?? undefined,
    waste_notes: db.waste_notes || undefined,
  };
}

export function getBatches(): Batch[] {
  return JSON.parse(JSON.stringify(cachedBatches));
}

export function getBatch(batchId: string): Batch | undefined {
  const b = cachedBatches.find(b => b.id === batchId);
  return b ? JSON.parse(JSON.stringify(b)) : undefined;
}

export async function _refreshBatches(): Promise<Batch[]> {
  const userId = await getDeviceId();
  if (!userId) return cachedBatches;
  const batches = await _fetchBatches(userId);
  if (batches) { cachedBatches = batches; persistBatches(cachedBatches); }
  return cachedBatches;
}

export async function createBatch(
  workflowId: string,
  mode: 'bake-today' | 'cold-ferment',
  unitsPerBatch: number = 1,
  batchSizeMultiplier: number = 1
): Promise<Batch> {
  const userId = await getDeviceId();
  if (!userId) throw new Error('Must be signed in');

  const workflow = cachedWorkflows.find(w => w.id === workflowId);
  if (!workflow) throw new Error('Workflow not found');

  const batch: Batch = {
    id: `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    workflowId, name: workflow.name, mode, unitsPerBatch, batchSizeMultiplier,
    currentStepIndex: 0, completedSteps: [], activeTimers: [],
    createdAt: Date.now(), user_id: userId, owner_id: userId,
  };

  cachedBatches.push({ ...batch });
  persistBatches(cachedBatches);

  push(async () => {
    const { error } = await supabase.from('batches').insert({
      id: batch.id, workflow_id: batch.workflowId, name: batch.name,
      mode: batch.mode, units_per_batch: batch.unitsPerBatch,
      batch_size_multiplier: batch.batchSizeMultiplier,
      current_step_index: 0, completed_steps: [], active_timers: [],
      user_id: userId, owner_id: userId,
      location_id: workflow.location_id || null,
      created_at: new Date(batch.createdAt).toISOString(),
      updated_at: new Date().toISOString(),
    });
    if (error) throw error;
  });

  return batch;
}

export async function duplicateBatch(batchId: string): Promise<Batch> {
  const userId = await getDeviceId();
  if (!userId) throw new Error('Must be signed in');

  const original = cachedBatches.find(b => b.id === batchId);
  if (!original) throw new Error('Batch not found');

  const newBatch: Batch = {
    id: `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    workflowId: original.workflowId, name: original.name, mode: original.mode,
    unitsPerBatch: original.unitsPerBatch, batchSizeMultiplier: original.batchSizeMultiplier,
    currentStepIndex: 0, completedSteps: [], activeTimers: [],
    createdAt: Date.now(), user_id: userId, owner_id: userId,
    location_id: original.location_id,
  };

  cachedBatches.push({ ...newBatch });
  persistBatches(cachedBatches);

  push(async () => {
    const { error } = await supabase.from('batches').insert({
      id: newBatch.id, workflow_id: newBatch.workflowId, name: newBatch.name,
      mode: newBatch.mode, units_per_batch: newBatch.unitsPerBatch,
      batch_size_multiplier: newBatch.batchSizeMultiplier,
      current_step_index: 0, completed_steps: [], active_timers: [],
      user_id: userId, owner_id: userId,
      location_id: original.location_id || null,
      created_at: new Date(newBatch.createdAt).toISOString(),
      updated_at: new Date().toISOString(),
    });
    if (error) throw error;
  });

  return newBatch;
}

export async function renameBatch(batchId: string, newName: string): Promise<void> {
  const batch = cachedBatches.find(b => b.id === batchId);
  if (!batch) return;
  batch.name = newName;
  persistBatches(cachedBatches);

  push(async () => {
    const { error } = await supabase.from('batches')
      .update({ name: newName, updated_at: new Date().toISOString() }).eq('id', batchId);
    if (error) throw error;
  });
}

export async function deleteBatch(batchId: string): Promise<void> {
  cachedBatches = cachedBatches.filter(b => b.id !== batchId);
  persistBatches(cachedBatches);

  push(async () => {
    const { error } = await supabase.from('batches').delete().eq('id', batchId);
    if (error) throw error;
  });
}

export function batchHasProgress(batchId: string): boolean {
  const batch = cachedBatches.find(b => b.id === batchId);
  if (!batch) return false;
  return batch.currentStepIndex > 0 || batch.completedSteps.length > 0 || batch.activeTimers.length > 0;
}

// ============================================
// BATCH STEP MANAGEMENT
// ============================================

async function _updateBatch(batchId: string, updates: any): Promise<void> {
  const batch = cachedBatches.find(b => b.id === batchId);
  if (!batch) return;

  Object.assign(batch, updates);
  persistBatches(cachedBatches);

  const dbUpdates: any = { updated_at: new Date().toISOString() };
  if (updates.batchSizeMultiplier !== undefined) dbUpdates.batch_size_multiplier = updates.batchSizeMultiplier;
  if (updates.currentStepIndex !== undefined)   dbUpdates.current_step_index = updates.currentStepIndex;
  if (updates.completedSteps !== undefined)     dbUpdates.completed_steps = updates.completedSteps;
  if (updates.activeTimers !== undefined)       dbUpdates.active_timers = updates.activeTimers;

  push(async () => {
    const { error } = await supabase.from('batches').update(dbUpdates).eq('id', batchId);
    if (error) throw error;
  });
}

export async function updateBatchSize(batchId: string, multiplier: number): Promise<void> {
  await _updateBatch(batchId, { batchSizeMultiplier: multiplier });
}

export async function updateBatchStep(batchId: string, stepIndex: number): Promise<void> {
  await _updateBatch(batchId, { currentStepIndex: stepIndex });
}

export async function completeBatchStep(batchId: string, stepId: string): Promise<void> {
  const batch = cachedBatches.find(b => b.id === batchId);
  if (!batch || batch.completedSteps.includes(stepId)) return;
  batch.completedSteps.push(stepId);
  await _updateBatch(batchId, { completedSteps: batch.completedSteps });
}

// ============================================
// WASTE TRACKING
// ============================================

export async function wasteBatch(
  batchId: string,
  atStepIndex: number,
  notes?: string
): Promise<void> {
  const batch = cachedBatches.find(b => b.id === batchId);
  if (!batch) throw new Error('Batch not found');

  const wastedAt = new Date().toISOString();
  batch.wasted_at = wastedAt;
  batch.wasted_at_step = atStepIndex;
  batch.waste_notes = notes;
  persistBatches(cachedBatches);

  push(async () => {
    const { error } = await supabase.from('batches').update({
      wasted_at: wastedAt,
      wasted_at_step: atStepIndex,
      waste_notes: notes || null,
      updated_at: new Date().toISOString(),
    }).eq('id', batchId);
    if (error) throw error;
  });
}

// ── Get the location the current user is clocked in at right now ──────────
async function _getClockedInLocationId(userId: string): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('time_entries')
      .select('location_id')
      .eq('user_id', userId)
      .is('clock_out', null)
      .order('clock_in', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) return null;
    return data.location_id ?? null;
  } catch {
    return null;
  }
}

// ── Fuzzy match an ingredient string against inventory items ──────────────
// Returns the best matching inventory item row or null if no match found.
// Match priority:
//   1. Exact match on ingredient field (case-insensitive)
//   2. Exact match on name field (case-insensitive)
//   3. ingredient field contains search string or vice versa
//   4. name field contains search string or vice versa
function _findInventoryItemMatch(
  ingredientStr: string,
  inventoryItems: any[]
): any | null {
  const search = ingredientStr.toLowerCase().trim();
  if (!search) return null;

  // Pass 1 — exact match on ingredient field
  let match = inventoryItems.find(
    item => item.ingredient && item.ingredient.toLowerCase().trim() === search
  );
  if (match) return match;

  // Pass 2 — exact match on name field
  match = inventoryItems.find(
    item => item.name && item.name.toLowerCase().trim() === search
  );
  if (match) return match;

  // Pass 3 — ingredient field contains search or search contains ingredient
  match = inventoryItems.find(item => {
    if (!item.ingredient) return false;
    const ing = item.ingredient.toLowerCase().trim();
    return ing.includes(search) || search.includes(ing);
  });
  if (match) return match;

  // Pass 4 — name field contains search or search contains name
  match = inventoryItems.find(item => {
    if (!item.name) return false;
    const nm = item.name.toLowerCase().trim();
    return nm.includes(search) || search.includes(nm);
  });
  if (match) return match;

  return null;
}

// ── Deduct ingredients from location_inventory using FIFO ─────────────────
// isWaste=true writes 'waste' transactions; false writes 'use' transactions.
// Returns silently with empty results if user is not clocked in anywhere.
export async function deductIngredientsForBatch(
  batchId: string,
  workflow: Workflow,
  upToStepIndex: number,
  batchSizeMultiplier: number,
  isWaste: boolean = false
): Promise<{ deducted: { name: string; amount: number; unit: string }[]; skipped: string[] }> {
  const userId = await getDeviceId();
  if (!userId) return { deducted: [], skipped: [] };

  // Only deduct if the user is clocked in at a location
  const locationId = await _getClockedInLocationId(userId);
  if (!locationId) {
    // Not clocked in — personal workflow context, skip deduction silently
    return { deducted: [], skipped: [] };
  }

  // Collect all ingredients from steps 0..upToStepIndex
  const ingredientsToDeduct: { name: string; amount: number; unit: string }[] = [];

  for (let i = 0; i <= upToStepIndex; i++) {
    const step = workflow.steps[i];
    if (!step) continue;
    const stepIngredients = _extractStepIngredients(step, batchSizeMultiplier);
    for (const ing of stepIngredients) {
      const existing = ingredientsToDeduct.find(
        d => d.name.toLowerCase() === ing.name.toLowerCase() && d.unit === ing.unit
      );
      if (existing) {
        existing.amount += ing.amount;
      } else {
        ingredientsToDeduct.push({ ...ing });
      }
    }
  }

  if (ingredientsToDeduct.length === 0) {
    return { deducted: [], skipped: [] };
  }

  // Fetch all inventory items for this owner
  const { data: inventoryItems, error: invError } = await supabase
    .from('inventory_items')
    .select('id, name, ingredient, unit')
    .eq('owner_id', userId);

  if (invError) throw new Error('Failed to fetch inventory items: ' + invError.message);
  if (!inventoryItems?.length) {
    return { deducted: [], skipped: ingredientsToDeduct.map(i => i.name) };
  }

  // Fetch location_inventory rows for this location
  const itemIds = inventoryItems.map((i: any) => i.id);
  const { data: locInvRows, error: locInvError } = await supabase
    .from('location_inventory')
    .select('id, inventory_item_id, quantity')
    .eq('location_id', locationId)
    .in('inventory_item_id', itemIds);

  if (locInvError) throw new Error('Failed to fetch location inventory: ' + locInvError.message);

  const deducted: { name: string; amount: number; unit: string }[] = [];
  const skipped: string[] = [];
  const now = new Date().toISOString();

  for (const ing of ingredientsToDeduct) {
    // Find the matching inventory item using fuzzy match
    const invItem = _findInventoryItemMatch(ing.name, inventoryItems);

    if (!invItem) {
      skipped.push(ing.name);
      continue;
    }

    // Find the location_inventory row for this item at this location
    const locInvRow = (locInvRows || []).find(
      (row: any) => row.inventory_item_id === invItem.id
    );

    if (!locInvRow) {
      // Item exists in master list but has no stock record at this location
      skipped.push(ing.name);
      continue;
    }

    const currentQty = parseFloat(locInvRow.quantity) || 0;
    const newQty = Math.max(0, currentQty - ing.amount);

    // Update location_inventory quantity
    const { error: updateError } = await supabase
      .from('location_inventory')
      .update({
        quantity: newQty,
        last_updated_by: userId,
        updated_at: now,
      })
      .eq('id', locInvRow.id);

    if (updateError) {
      console.warn(`[DB] Failed to update location_inventory for ${ing.name}:`, updateError.message);
      skipped.push(ing.name);
      continue;
    }

    // Write inventory transaction
    const { error: txError } = await supabase
      .from('inventory_transactions')
      .insert({
        user_id: userId,
        item_id: invItem.id,
        batch_id: batchId,
        type: isWaste ? 'waste' : 'use',
        quantity: ing.amount,
        notes: isWaste
          ? `Wasted in batch: ${batchId} (at step ${upToStepIndex + 1})`
          : `Used in batch: ${batchId}`,
        created_by: userId,
        created_at: now,
        location_id: locationId,
      });

    if (txError) {
      // Transaction log failure is non-fatal — stock was already updated
      console.warn(`[DB] Failed to log inventory transaction for ${ing.name}:`, txError.message);
    }

    deducted.push(ing);
  }

  return { deducted, skipped };
}

// ── Parse ingredients out of a step ──────────────────────────────────────
// Uses structured ingredients array if present, otherwise falls back to
// checklist parsing from the description field.
function _extractStepIngredients(
  step: Step,
  multiplier: number
): { name: string; amount: number; unit: string }[] {
  const results: { name: string; amount: number; unit: string }[] = [];

  if (step.ingredients && step.ingredients.length > 0) {
    for (const ing of step.ingredients) {
      const parsed = _parseIngredientString(ing, multiplier);
      if (parsed) results.push(parsed);
    }
    return results;
  }

  // Fall back to checklist in description
  const checklistMatch = step.description?.match(/📋 Checklist:\n([\s\S]*?)(?=\n\n|$)/);
  if (checklistMatch) {
    const lines = checklistMatch[1]
      .split('\n')
      .map((l: string) => l.replace(/^☐\s*/, '').trim())
      .filter(Boolean);
    for (const line of lines) {
      const parsed = _parseIngredientString(line, multiplier);
      if (parsed) results.push(parsed);
    }
  }

  return results;
}

// ── Parse "250g AP Flour" or "2 cups sugar" → { name, amount, unit } ─────
// Returns null for lines with no recognisable quantity — those are
// instruction lines, not ingredients, and should not be deducted.
function _parseIngredientString(
  text: string,
  multiplier: number
): { name: string; amount: number; unit: string } | null {
  if (!text) return null;

  // Handles formats like:
  //   "250g AP Flour"
  //   "2 cups sugar"
  //   "1.5 kg chicken breast"
  //   "500 ml milk"
  const match = text.trim().match(
    /^(\d+(?:\.\d+)?)\s*(g|kg|ml|l|oz|lb|cups?|tbsp|tsp|pieces?|ea|cs|bag|box|can|bt)?\s+(.+)$/i
  );

  if (!match) return null;

  const amount = parseFloat(match[1]) * multiplier;
  const unit = match[2] ? match[2].toLowerCase().replace(/s$/, '') : 'unit';
  const name = match[3].trim();

  if (!name || amount <= 0) return null;

  return {
    name,
    amount: Math.round(amount * 100) / 100,
    unit,
  };
}

// ============================================
// TIMER MANAGEMENT
// ============================================

export async function startTimer(batchId: string, stepId: string, durationMinutes: number): Promise<void> {
  const batch = cachedBatches.find(b => b.id === batchId);
  if (!batch) return;
  const timer: Timer = {
    id: `timer_${Date.now()}`, stepId, startedAt: Date.now(),
    duration: durationMinutes * 60, acknowledged: false,
  };
  batch.activeTimers.push(timer);
  await _updateBatch(batchId, { activeTimers: batch.activeTimers });
}

export async function stopTimer(batchId: string, timerId: string): Promise<void> {
  const batch = cachedBatches.find(b => b.id === batchId);
  if (!batch) return;
  batch.activeTimers = batch.activeTimers.filter(t => t.id !== timerId);
  await _updateBatch(batchId, { activeTimers: batch.activeTimers });
}

export async function acknowledgeTimer(batchId: string, timerId: string): Promise<void> {
  const batch = cachedBatches.find(b => b.id === batchId);
  if (!batch) return;
  const timer = batch.activeTimers.find(t => t.id === timerId);
  if (timer) {
    timer.acknowledged = true;
    await _updateBatch(batchId, { activeTimers: batch.activeTimers });
  }
}

export function getTimerStatus(timer: Timer): { remainingSeconds: number; isExpired: boolean; elapsedSeconds: number } {
  const elapsedSeconds = Math.floor((Date.now() - timer.startedAt) / 1000);
  const remainingSeconds = timer.duration - elapsedSeconds;
  return {
    remainingSeconds: Math.max(0, remainingSeconds),
    isExpired: remainingSeconds <= 0,
    elapsedSeconds,
  };
}

export function getMostUrgentTimer(batch: Batch): Timer | null {
  if (batch.activeTimers.length === 0) return null;
  const expired = batch.activeTimers.find(t => getTimerStatus(t).isExpired);
  if (expired) return expired;
  return batch.activeTimers.reduce((best, t) =>
    getTimerStatus(t).remainingSeconds < getTimerStatus(best).remainingSeconds ? t : best
  );
}

export function batchHasExpiredTimer(batch: Batch): boolean {
  return batch.activeTimers.some(t => getTimerStatus(t).isExpired && !t.acknowledged);
}

// ============================================
// UTILITY
// ============================================

export function formatTimeRemaining(seconds: number): string {
  if (seconds <= 0) return 'Expired';
  const hours   = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs    = seconds % 60;
  if (hours > 0)   return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}

export async function syncFromServer(): Promise<void> {
  const userId = await getDeviceId();
  if (userId) await _bgSync(userId);
}