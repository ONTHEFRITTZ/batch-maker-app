import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "../lib/supabase";

const REPORTS_KEY = "@reports";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EnvironmentalReport {
  id: string;
  timestamp: number;
  date: string;
  time: string;
  ambientTemp?: number;
  humidity?: number;
  // Extended equipment temps (Phase 4)
  fridgeTemp?: number;
  freezerTemp?: number;
  proofTemp?: number;
  ovenTemp?: number;
  notes?: string;
  createdBy: string;
  userId?: string;
}

export interface IngredientUsage {
  name: string;
  amount: number;
  unit: string;
  cost?: number;
}

export interface BatchCompletionReport {
  id: string;
  batchId: string;
  batchName: string;
  workflowId: string;
  workflowName: string;
  timestamp: number;
  date: string;
  time: string;
  completedBy: string;
  batchSizeMultiplier: number;
  environmentalReportId?: string;
  actualDuration?: number;
  notes?: string;
  photos?: string[];
  stepNotes?: { [stepId: string]: string };
  temperatureLog?: { stepId: string; temp: number; timestamp: number }[];
  ingredientsUsed?: IngredientUsage[];
  totalCost?: number;
  yieldAmount?: number;
  yieldUnit?: string;
  userId?: string;
  wasted?: boolean;
  wastedAtStep?: number;
  wastedAtStepName?: string;
  waste_notes?: string;
  ingredientsDeducted?: IngredientUsage[];
  ingredientsSkipped?: string[];
}

export interface LabourEntry {
  userId: string;
  name: string;
  clockIn: string;
  clockOut: string | null;
  totalHours: number;
  hourlyRate: number;
  labourCost: number;
}

export interface LabourSummary {
  entries: LabourEntry[];
  totalHours: number;
  totalLabourCost: number;
  generatedAt: string;
}

// ── Phase 4: par-level inventory snapshot ─────────────────────────────────────
export interface InventoryParItem {
  id: string;
  name: string;
  category: string;
  currentQty: number;
  parLevel: number;
  unit: string;
  belowPar: boolean;
  supplierName?: string;
}

export interface InventoryParSnapshot {
  items: InventoryParItem[];
  belowParCount: number;
  checkedAt: string;
  locationId?: string;
}

export interface DailyReport {
  id: string;
  date: string;
  timestamp: number;
  totalBatches: number;
  batchesByWorkflow: { [workflowId: string]: number };
  averageDuration: number;
  totalIngredientCost?: number;
  totalYield?: { [unit: string]: number };
  environmentalReports: EnvironmentalReport[];
  batchCompletions: BatchCompletionReport[];
  labourSummary?: LabourSummary;
  inventorySnapshot?: InventoryParSnapshot;  // Phase 4
  userId?: string;
}

interface ReportsData {
  environmental: EnvironmentalReport[];
  batchCompletions: BatchCompletionReport[];
  daily: DailyReport[];
}

// ─── State ────────────────────────────────────────────────────────────────────

let reportsData: ReportsData = {
  environmental: [],
  batchCompletions: [],
  daily: [],
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getCurrentUserId(): Promise<string | null> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    return user?.id || null;
  } catch {
    return null;
  }
}

function getTodayDateString(): string {
  return new Date().toISOString().split("T")[0];
}

function getTimeString(timestamp: number): string {
  const d = new Date(timestamp);
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}

async function saveReports(): Promise<void> {
  try {
    await AsyncStorage.setItem(REPORTS_KEY, JSON.stringify(reportsData));
  } catch (error) {
    console.error("Error saving reports locally:", error);
  }
}

// ─── Init & Sync ──────────────────────────────────────────────────────────────

export async function initializeReports(): Promise<void> {
  try {
    const stored = await AsyncStorage.getItem(REPORTS_KEY);
    if (stored) {
      reportsData = JSON.parse(stored);
      console.log(
        `Loaded reports: ${reportsData.environmental.length} SoD, ` +
        `${reportsData.batchCompletions.length} batch, ${reportsData.daily.length} daily`,
      );
    }
    await syncFromSupabase();
  } catch (error) {
    console.error("Error loading reports:", error);
  }
}

async function syncFromSupabase(): Promise<void> {
  try {
    const userId = await getCurrentUserId();
    if (!userId) return;

    // Batch reports
    const { data: batchReports, error: batchError } = await supabase
      .from("batch_completion_reports")
      .select("*")
      .eq("user_id", userId)
      .order("timestamp", { ascending: false });

    if (!batchError && batchReports) {
      const supabaseIds = new Set(batchReports.map(r => r.id));
      const localOnly = reportsData.batchCompletions.filter(r => !supabaseIds.has(r.id));
      reportsData.batchCompletions = [
        ...batchReports.map(r => ({
          ...r,
          userId: r.user_id,
          stepNotes: r.step_notes || {},
          temperatureLog: r.temperature_log || [],
          ingredientsUsed: r.ingredients_used || [],
          wasted: r.wasted || false,
          wastedAtStep: r.wasted_at_step ?? undefined,
          wastedAtStepName: r.wasted_at_step_name || undefined,
          waste_notes: r.waste_notes || undefined,
          ingredientsDeducted: r.ingredients_used || [],
          ingredientsSkipped: r.ingredients_skipped || [],
        })),
        ...localOnly,
      ];
    }

    // Environmental (SoD) reports
    const { data: envReports, error: envError } = await supabase
      .from("environmental_reports")
      .select("*")
      .eq("user_id", userId)
      .order("timestamp", { ascending: false });

    if (!envError && envReports) {
      const supabaseIds = new Set(envReports.map(r => r.id));
      const localOnly = reportsData.environmental.filter(r => !supabaseIds.has(r.id));
      reportsData.environmental = [
        ...envReports.map(r => ({
          ...r,
          userId: r.user_id,
          ambientTemp: r.ambient_temp,
          fridgeTemp: r.fridge_temp ?? undefined,
          freezerTemp: r.freezer_temp ?? undefined,
          proofTemp: r.proof_temp ?? undefined,
          ovenTemp: r.oven_temp ?? undefined,
          createdBy: r.created_by,
        })),
        ...localOnly,
      ];
    }

    await saveReports();
  } catch (error) {
    console.error("Error syncing from Supabase:", error);
  }
}

async function syncToSupabase(report: any, table: string): Promise<void> {
  try {
    const userId = await getCurrentUserId();
    if (!userId) return;

    let data: any = { ...report, user_id: userId };

    if (table === "batch_completion_reports") {
      data = {
        id: report.id, user_id: userId,
        batch_id: report.batchId, batch_name: report.batchName,
        workflow_id: report.workflowId, workflow_name: report.workflowName,
        timestamp: report.timestamp, date: report.date, time: report.time,
        completed_by: report.completedBy,
        batch_size_multiplier: report.batchSizeMultiplier,
        environmental_report_id: report.environmentalReportId,
        actual_duration: report.actualDuration, notes: report.notes,
        photos: report.photos, step_notes: report.stepNotes,
        temperature_log: report.temperatureLog,
        ingredients_used: report.ingredientsUsed,
        total_cost: report.totalCost, yield_amount: report.yieldAmount,
        yield_unit: report.yieldUnit,
      };
    } else if (table === "environmental_reports") {
      data = {
        id: report.id, user_id: userId,
        timestamp: report.timestamp, date: report.date, time: report.time,
        ambient_temp: report.ambientTemp ?? null,
        humidity: report.humidity ?? null,
        fridge_temp: report.fridgeTemp ?? null,
        freezer_temp: report.freezerTemp ?? null,
        proof_temp: report.proofTemp ?? null,
        oven_temp: report.ovenTemp ?? null,
        notes: report.notes ?? null,
        created_by: report.createdBy,
      };
    }

    const { error } = await supabase.from(table).upsert(data, { onConflict: "id" });
    if (error) console.error(`Error syncing to ${table}:`, error);
  } catch (error) {
    console.error("Error syncing to Supabase:", error);
  }
}

// ─── Phase 4: Par-level inventory snapshot ───────────────────────────────────

async function fetchInventoryParSnapshot(
  userId: string,
  locationId?: string,
): Promise<InventoryParSnapshot | undefined> {
  try {
    let query = supabase
      .from("inventory_items")
      .select(`
        id, name, category, unit, par_level,
        suppliers(name),
        location_inventory(location_id, quantity)
      `)
      .eq("owner_id", userId)
      .not("par_level", "is", null);

    const { data: items, error } = await query;
    if (error || !items?.length) return undefined;

    const parItems: InventoryParItem[] = items.map((item: any) => {
      const locInv: any[] = item.location_inventory ?? [];
      let currentQty = 0;
      if (locationId) {
        const locRow = locInv.find((li: any) => li.location_id === locationId);
        currentQty = locRow?.quantity ?? 0;
      } else {
        currentQty = locInv.reduce((sum: number, li: any) => sum + (li.quantity ?? 0), 0);
      }

      return {
        id: item.id,
        name: item.name,
        category: item.category ?? 'Other',
        currentQty,
        parLevel: item.par_level,
        unit: item.unit ?? '',
        belowPar: currentQty < item.par_level,
        supplierName: item.suppliers?.name ?? undefined,
      };
    });

    parItems.sort((a, b) => {
      if (a.belowPar && !b.belowPar) return -1;
      if (!a.belowPar && b.belowPar) return 1;
      return a.name.localeCompare(b.name);
    });

    return {
      items: parItems,
      belowParCount: parItems.filter(i => i.belowPar).length,
      checkedAt: new Date().toISOString(),
      locationId,
    };
  } catch (err) {
    console.warn('Par snapshot fetch failed (non-fatal):', err);
    return undefined;
  }
}

// ─── Environmental (SoD) Reports ─────────────────────────────────────────────

export interface EnvironmentalExtras {
  fridgeTemp?: number;
  freezerTemp?: number;
  proofTemp?: number;
  ovenTemp?: number;
}

export async function createEnvironmentalReport(
  createdBy: string,
  ambientTemp?: number,
  humidity?: number,
  notes?: string,
  extras?: EnvironmentalExtras,
): Promise<EnvironmentalReport> {
  const timestamp = Date.now();
  const userId = await getCurrentUserId();

  const report: EnvironmentalReport = {
    id: `env_${timestamp}`,
    timestamp,
    date: getTodayDateString(),
    time: getTimeString(timestamp),
    ambientTemp,
    humidity,
    fridgeTemp: extras?.fridgeTemp,
    freezerTemp: extras?.freezerTemp,
    proofTemp: extras?.proofTemp,
    ovenTemp: extras?.ovenTemp,
    notes,
    createdBy,
    userId: userId || undefined,
  };

  reportsData.environmental.push(report);
  await saveReports();
  await syncToSupabase(report, "environmental_reports");

  return report;
}

/** Update an existing SoD report (used from ReportsScreen edit flow) */
export async function updateEnvironmentalReport(
  id: string,
  updates: Partial<Omit<EnvironmentalReport, 'id' | 'timestamp' | 'date' | 'time' | 'createdBy' | 'userId'>>,
): Promise<void> {
  const idx = reportsData.environmental.findIndex(r => r.id === id);
  if (idx === -1) throw new Error(`Environmental report ${id} not found`);

  reportsData.environmental[idx] = {
    ...reportsData.environmental[idx],
    ...updates,
  };

  await saveReports();

  try {
    const userId = await getCurrentUserId();
    if (!userId) return;
    const r = reportsData.environmental[idx];
    const { error } = await supabase
      .from("environmental_reports")
      .update({
        ambient_temp: r.ambientTemp ?? null,
        humidity: r.humidity ?? null,
        fridge_temp: r.fridgeTemp ?? null,
        freezer_temp: r.freezerTemp ?? null,
        proof_temp: r.proofTemp ?? null,
        oven_temp: r.ovenTemp ?? null,
        notes: r.notes ?? null,
      })
      .eq("id", id)
      .eq("user_id", userId);
    if (error) console.error("Error updating environmental report:", error);
  } catch (err) {
    console.error("updateEnvironmentalReport sync error:", err);
  }
}

export function getEnvironmentalReports(date?: string): EnvironmentalReport[] {
  if (date) return reportsData.environmental.filter(r => r.date === date);
  return [...reportsData.environmental].sort((a, b) => b.timestamp - a.timestamp);
}

export function getTodaysEnvironmentalReports(): EnvironmentalReport[] {
  return getEnvironmentalReports(getTodayDateString());
}

export async function deleteEnvironmentalReport(id: string): Promise<void> {
  reportsData.environmental = reportsData.environmental.filter(r => r.id !== id);
  await saveReports();
  const userId = await getCurrentUserId();
  if (userId) {
    await supabase.from("environmental_reports").delete().eq("id", id).eq("user_id", userId);
  }
}

// ─── Batch Completion Reports ─────────────────────────────────────────────────

export async function createBatchCompletionReport(
  batchId: string,
  batchName: string,
  workflowId: string,
  workflowName: string,
  completedBy: string,
  batchSizeMultiplier: number,
  actualDuration?: number,
  notes?: string,
  stepNotes?: { [stepId: string]: string },
  temperatureLog?: { stepId: string; temp: number; timestamp: number }[],
  ingredientsUsed?: IngredientUsage[],
  yieldAmount?: number,
  yieldUnit?: string,
): Promise<BatchCompletionReport> {
  const timestamp = Date.now();
  const userId = await getCurrentUserId();
  const todayDate = getTodayDateString();

  const todaysEnvReports = getTodaysEnvironmentalReports();
  const environmentalReportId =
    todaysEnvReports.length > 0
      ? todaysEnvReports[todaysEnvReports.length - 1].id
      : undefined;

  const totalCost = ingredientsUsed?.reduce((sum, ing) => sum + (ing.cost || 0), 0);

  const report: BatchCompletionReport = {
    id: `batch_${timestamp}`,
    batchId, batchName, workflowId, workflowName,
    timestamp, date: todayDate, time: getTimeString(timestamp),
    completedBy, batchSizeMultiplier, environmentalReportId,
    actualDuration, notes, stepNotes, temperatureLog, ingredientsUsed,
    totalCost, yieldAmount, yieldUnit,
    userId: userId || undefined,
    wasted: false,
  };

  reportsData.batchCompletions.push(report);
  await saveReports();
  await syncToSupabase(report, "batch_completion_reports");

  return report;
}

export async function createWasteReport(
  batchId: string,
  batchName: string,
  workflowId: string,
  workflowName: string,
  completedBy: string,
  batchSizeMultiplier: number,
  wastedAtStep: number,
  wastedAtStepName: string,
  waste_notes?: string,
  ingredientsDeducted?: IngredientUsage[],
  ingredientsSkipped?: string[],
  actualDuration?: number,
): Promise<BatchCompletionReport> {
  const timestamp = Date.now();
  const userId = await getCurrentUserId();
  const totalCost = ingredientsDeducted?.reduce((sum, ing) => sum + (ing.cost || 0), 0);

  const report: BatchCompletionReport = {
    id: `waste_${timestamp}`,
    batchId, batchName, workflowId, workflowName,
    timestamp, date: getTodayDateString(), time: getTimeString(timestamp),
    completedBy, batchSizeMultiplier, actualDuration,
    notes: waste_notes,
    ingredientsUsed: ingredientsDeducted,
    totalCost,
    userId: userId || undefined,
    wasted: true, wastedAtStep, wastedAtStepName, waste_notes,
    ingredientsDeducted, ingredientsSkipped,
  };

  reportsData.batchCompletions.push(report);
  await saveReports();

  if (userId) {
    try {
      const { error } = await supabase.from('batch_completion_reports').upsert({
        id: report.id, user_id: userId,
        batch_id: report.batchId, batch_name: report.batchName,
        workflow_id: report.workflowId, workflow_name: report.workflowName,
        timestamp: report.timestamp, date: report.date, time: report.time,
        completed_by: report.completedBy,
        batch_size_multiplier: report.batchSizeMultiplier,
        actual_duration: report.actualDuration || null,
        notes: report.notes || null,
        ingredients_used: report.ingredientsDeducted || null,
        total_cost: report.totalCost || null,
        wasted: true,
        wasted_at_step: report.wastedAtStep,
        wasted_at_step_name: report.wastedAtStepName,
        waste_notes: report.waste_notes || null,
        ingredients_skipped: report.ingredientsSkipped || null,
      }, { onConflict: 'id' });
      if (error) console.error('Error syncing waste report:', error);
    } catch (err) {
      console.error('syncWasteReport error:', err);
    }
  }

  return report;
}

export function getBatchCompletionReports(date?: string): BatchCompletionReport[] {
  if (date) return reportsData.batchCompletions.filter(r => r.date === date);
  return [...reportsData.batchCompletions].sort((a, b) => b.timestamp - a.timestamp);
}

export function getTodaysBatchCompletions(): BatchCompletionReport[] {
  return getBatchCompletionReports(getTodayDateString());
}

export function searchBatchReports(query: string): BatchCompletionReport[] {
  const q = query.toLowerCase();
  return reportsData.batchCompletions.filter(r =>
    r.batchName.toLowerCase().includes(q) ||
    r.workflowName.toLowerCase().includes(q) ||
    r.completedBy.toLowerCase().includes(q) ||
    r.notes?.toLowerCase().includes(q),
  );
}

export async function deleteBatchCompletionReport(id: string): Promise<void> {
  reportsData.batchCompletions = reportsData.batchCompletions.filter(r => r.id !== id);
  await saveReports();
  const userId = await getCurrentUserId();
  if (userId) {
    await supabase.from("batch_completion_reports").delete().eq("id", id).eq("user_id", userId);
  }
}

// ─── Labour Summary ───────────────────────────────────────────────────────────

async function fetchLabourSummaryForDate(userId: string, date: string): Promise<LabourSummary> {
  const dayStart = `${date}T00:00:00.000Z`;
  const dayEnd   = `${date}T23:59:59.999Z`;

  const { data: entries, error: entriesError } = await supabase
    .from('time_entries')
    .select('user_id, clock_in, clock_out, total_hours')
    .eq('owner_id', userId)
    .gte('clock_in', dayStart)
    .lte('clock_in', dayEnd);

  if (entriesError || !entries?.length) {
    return { entries: [], totalHours: 0, totalLabourCost: 0, generatedAt: new Date().toISOString() };
  }

  const userIds = [...new Set(entries.map(e => e.user_id))];

  const { data: roles } = await supabase
    .from('network_member_roles')
    .select('user_id, hourly_rate')
    .eq('owner_id', userId)
    .in('user_id', userIds);

  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, device_name, email')
    .in('id', userIds);

  const rateMap: Record<string, number> = {};
  roles?.forEach((r: any) => { rateMap[r.user_id] = r.hourly_rate || 0; });

  const nameMap: Record<string, string> = {};
  profiles?.forEach((p: any) => { nameMap[p.id] = p.device_name || p.email || 'Unknown'; });

  const labourEntries: LabourEntry[] = entries.map(e => {
    const hours = e.total_hours ?? 0;
    const rate  = rateMap[e.user_id] ?? 0;
    return {
      userId: e.user_id,
      name: nameMap[e.user_id] ?? 'Unknown',
      clockIn: e.clock_in,
      clockOut: e.clock_out,
      totalHours: hours,
      hourlyRate: rate,
      labourCost: Math.round(hours * rate * 100) / 100,
    };
  });

  const totalHours      = labourEntries.reduce((s, e) => s + e.totalHours, 0);
  const totalLabourCost = labourEntries.reduce((s, e) => s + e.labourCost, 0);

  return {
    entries: labourEntries,
    totalHours: Math.round(totalHours * 100) / 100,
    totalLabourCost: Math.round(totalLabourCost * 100) / 100,
    generatedAt: new Date().toISOString(),
  };
}

// ─── Daily Reports ────────────────────────────────────────────────────────────

export async function generateDailyReport(
  date?: string,
  locationId?: string,
): Promise<DailyReport> {
  const targetDate = date || getTodayDateString();
  const timestamp  = Date.now();
  const userId     = await getCurrentUserId();

  const envReports   = getEnvironmentalReports(targetDate);
  const batchReports = getBatchCompletionReports(targetDate);

  const batchesByWorkflow: { [workflowId: string]: number } = {};
  let totalDuration     = 0;
  let countWithDuration = 0;
  let totalIngredientCost = 0;
  const totalYield: { [unit: string]: number } = {};

  batchReports.forEach(r => {
    if (!batchesByWorkflow[r.workflowId]) batchesByWorkflow[r.workflowId] = 0;
    batchesByWorkflow[r.workflowId]++;
    if (r.actualDuration) { totalDuration += r.actualDuration; countWithDuration++; }
    if (r.totalCost) totalIngredientCost += r.totalCost;
    if (r.yieldAmount && r.yieldUnit) {
      if (!totalYield[r.yieldUnit]) totalYield[r.yieldUnit] = 0;
      totalYield[r.yieldUnit] += r.yieldAmount;
    }
  });

  const averageDuration = countWithDuration > 0
    ? Math.round(totalDuration / countWithDuration)
    : 0;

  // Labour summary
  let labourSummary: LabourSummary | undefined;
  if (userId) {
    try {
      labourSummary = await fetchLabourSummaryForDate(userId, targetDate);
    } catch (err) {
      console.warn('Labour summary fetch failed (non-fatal):', err);
    }
  }

  // Phase 4: Inventory par snapshot
  let inventorySnapshot: InventoryParSnapshot | undefined;
  if (userId) {
    try {
      inventorySnapshot = await fetchInventoryParSnapshot(userId, locationId);
      if (inventorySnapshot) {
        console.log(
          `✅ Inventory snapshot: ${inventorySnapshot.items.length} items, ` +
          `${inventorySnapshot.belowParCount} below par`,
        );
      }
    } catch (err) {
      console.warn('Inventory snapshot fetch failed (non-fatal):', err);
    }
  }

  const report: DailyReport = {
    id: `daily_${targetDate}`,
    date: targetDate,
    timestamp,
    totalBatches: batchReports.length,
    batchesByWorkflow,
    averageDuration,
    totalIngredientCost: totalIngredientCost > 0 ? totalIngredientCost : undefined,
    totalYield: Object.keys(totalYield).length > 0 ? totalYield : undefined,
    environmentalReports: envReports,
    batchCompletions: batchReports,
    labourSummary,
    inventorySnapshot,
    userId: userId || undefined,
  };

  // Replace any existing daily report for this date
  reportsData.daily = reportsData.daily.filter(r => r.date !== targetDate);
  reportsData.daily.push(report);
  await saveReports();

  // Archive to Supabase
  if (userId) {
    try {
      await supabase
        .from('reports')
        .delete()
        .eq('user_id', userId)
        .eq('type', 'daily')
        .filter('data->>date', 'eq', report.date);

      const { error } = await supabase.from('reports').insert({
        id: report.id,
        user_id: userId,
        type: 'daily',
        data: {
          date: report.date,
          totalBatches: report.totalBatches,
          batchesByWorkflow: report.batchesByWorkflow,
          averageDuration: report.averageDuration,
          totalIngredientCost: report.totalIngredientCost ?? null,
          totalYield: report.totalYield ?? null,
          labourSummary: report.labourSummary ?? null,
          inventorySnapshot: report.inventorySnapshot ?? null,
          environmentalReports: report.environmentalReports,
          batchCompletions: report.batchCompletions,
        },
        timestamp: new Date(report.timestamp).toISOString(),
      });

      if (error) {
        console.error('Failed to archive daily report:', error);
      } else {
        // Clear today's local data — fresh start tomorrow
        reportsData.batchCompletions = reportsData.batchCompletions.filter(r => r.date !== targetDate);
        reportsData.environmental    = reportsData.environmental.filter(r => r.date !== targetDate);
        await saveReports();
        console.log('✅ Daily report archived, local data cleared for', targetDate);

        // Trigger POS sync for today's date — fire and forget, never blocks EoD
        try {
          const { data: { session } } = await supabase.auth.getSession();
          if (session?.access_token) {
            fetch('https://fjcpscyxrppcderqzgpa.supabase.co/functions/v1/sync-pos', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${session.access_token}`,
              },
              body: JSON.stringify({ date: targetDate }),
            }).then(() => {
              console.log('✅ POS sync triggered for', targetDate);
            }).catch((err) => {
              console.warn('POS sync trigger failed (non-fatal):', err);
            });
          }
        } catch (err) {
          console.warn('POS sync trigger setup failed (non-fatal):', err);
        }
      }
    } catch (err) {
      console.error('Error archiving daily report:', err);
    }
  }

  return report;
}

/** Update notes on an existing EoD (daily) report */
export async function updateDailyReport(
  id: string,
  updates: { notes?: string; endNotes?: string },
): Promise<void> {
  const idx = reportsData.daily.findIndex(r => r.id === id);
  if (idx === -1) throw new Error(`Daily report ${id} not found`);

  reportsData.daily[idx] = {
    ...reportsData.daily[idx],
    ...(updates as any),
  };

  await saveReports();

  // Persist to Supabase reports.data JSONB
  try {
    const userId = await getCurrentUserId();
    if (!userId) return;
    const r = reportsData.daily[idx];
    await supabase
      .from('reports')
      .update({
        data: {
          ...r,
          notes: (updates as any).notes ?? null,
          endNotes: (updates as any).endNotes ?? null,
        },
      })
      .eq('id', id)
      .eq('user_id', userId);
  } catch (err) {
    console.warn('updateDailyReport Supabase sync failed (non-fatal):', err);
  }
}

export function getDailyReports(): DailyReport[] {
  return [...reportsData.daily].sort((a, b) => b.timestamp - a.timestamp);
}

export function getDailyReport(date: string): DailyReport | undefined {
  return reportsData.daily.find(r => r.date === date);
}

export async function deleteDailyReport(id: string): Promise<void> {
  reportsData.daily = reportsData.daily.filter(r => r.id !== id);
  await saveReports();
}

// ─── Manual sync ──────────────────────────────────────────────────────────────

export async function forceSyncToSupabase(): Promise<void> {
  console.log("🔄 Force syncing all reports to Supabase...");
  for (const report of reportsData.batchCompletions) {
    if (report.wasted) {
      const userId = await getCurrentUserId();
      if (userId) {
        await supabase.from('batch_completion_reports').upsert({
          id: report.id, user_id: userId,
          batch_id: report.batchId, batch_name: report.batchName,
          workflow_id: report.workflowId, workflow_name: report.workflowName,
          timestamp: report.timestamp, date: report.date, time: report.time,
          completed_by: report.completedBy,
          batch_size_multiplier: report.batchSizeMultiplier,
          actual_duration: report.actualDuration || null,
          notes: report.notes || null,
          ingredients_used: report.ingredientsDeducted || null,
          total_cost: report.totalCost || null,
          wasted: true,
          wasted_at_step: report.wastedAtStep,
          wasted_at_step_name: report.wastedAtStepName,
          waste_notes: report.waste_notes || null,
          ingredients_skipped: report.ingredientsSkipped || null,
        }, { onConflict: 'id' });
      }
    } else {
      await syncToSupabase(report, "batch_completion_reports");
    }
  }
  for (const report of reportsData.environmental) {
    await syncToSupabase(report, "environmental_reports");
  }
  console.log("✅ Force sync complete");
}

export async function forceSyncFromSupabase(): Promise<void> {
  await syncFromSupabase();
}

// ─── Analytics ────────────────────────────────────────────────────────────────

export function getWorkflowStats(workflowId: string) {
  const batches = reportsData.batchCompletions.filter(r => r.workflowId === workflowId);
  const wasted  = batches.filter(r => r.wasted);
  let totalDuration = 0, countWithDuration = 0, lastCompleted: number | undefined, totalCost = 0;
  const totalYield: { [unit: string]: number } = {};

  batches.forEach(b => {
    if (b.actualDuration) { totalDuration += b.actualDuration; countWithDuration++; }
    if (!lastCompleted || b.timestamp > lastCompleted) lastCompleted = b.timestamp;
    if (b.totalCost) totalCost += b.totalCost;
    if (b.yieldAmount && b.yieldUnit) {
      if (!totalYield[b.yieldUnit]) totalYield[b.yieldUnit] = 0;
      totalYield[b.yieldUnit] += b.yieldAmount;
    }
  });

  return {
    totalBatches: batches.length,
    totalWasted: wasted.length,
    averageDuration: countWithDuration > 0 ? Math.round(totalDuration / countWithDuration) : 0,
    lastCompleted,
    totalCost: totalCost > 0 ? totalCost : undefined,
    totalYield: Object.keys(totalYield).length > 0 ? totalYield : undefined,
  };
}

export function getDateRangeReports(startDate: string, endDate: string) {
  return {
    environmental:    reportsData.environmental.filter(r => r.date >= startDate && r.date <= endDate),
    batchCompletions: reportsData.batchCompletions.filter(r => r.date >= startDate && r.date <= endDate),
  };
}

// ─── Export ───────────────────────────────────────────────────────────────────

export function exportReportsAsJSON(): string {
  return JSON.stringify(reportsData, null, 2);
}

export function generateBatchReportsCSV(): string {
  let csv = "Date,Time,Batch Name,Workflow,Station,Size,Duration (min),Cost,Yield,Wasted,Wasted At Step,Waste Reason,Notes\n";
  reportsData.batchCompletions.forEach(r => {
    const cost      = r.totalCost ? r.totalCost.toFixed(2) : "";
    const yieldStr  = r.yieldAmount && r.yieldUnit ? `${r.yieldAmount}${r.yieldUnit}` : "";
    const notes     = (r.notes || "").replace(/,/g, ";").replace(/\n/g, " ");
    const wastedStr = r.wasted ? "Yes" : "No";
    const wastedStep = r.wasted ? `Step ${(r.wastedAtStep ?? 0) + 1}: ${r.wastedAtStepName || ''}` : "";
    const wasteReason = (r.waste_notes || "").replace(/,/g, ";");
    csv += `${r.date},${r.time},"${r.batchName}","${r.workflowName}",${r.completedBy},${r.batchSizeMultiplier}x,${r.actualDuration || ""},${cost},${yieldStr},${wastedStr},"${wastedStep}","${wasteReason}","${notes}"\n`;
  });
  return csv;
}

export function generateEnvironmentalReportsCSV(): string {
  let csv = "Date,Time,Station,Ambient Temp (°C),Humidity (%),Fridge (°C),Freezer (°C),Proof Box (°C),Oven (°C),Notes\n";
  reportsData.environmental.forEach(r => {
    const notes = (r.notes || "").replace(/,/g, ";").replace(/\n/g, " ");
    csv += `${r.date},${r.time},${r.createdBy},${r.ambientTemp ?? ""},${r.humidity ?? ""},${r.fridgeTemp ?? ""},${r.freezerTemp ?? ""},${r.proofTemp ?? ""},${r.ovenTemp ?? ""},"${notes}"\n`;
  });
  return csv;
}

export function generateDailyReportsCSV(): string {
  let csv = "Date,Total Batches,Avg Duration (min),Total Cost,Workflows,Labour Hours,Labour Cost,Below Par Items\n";
  reportsData.daily.forEach(r => {
    const workflows  = Object.entries(r.batchesByWorkflow).map(([wf, c]) => `${wf}:${c}`).join("; ");
    const cost       = r.totalIngredientCost ? r.totalIngredientCost.toFixed(2) : "";
    const labourHrs  = r.labourSummary ? r.labourSummary.totalHours.toFixed(2) : "";
    const labourCost = r.labourSummary ? r.labourSummary.totalLabourCost.toFixed(2) : "";
    const belowPar   = r.inventorySnapshot ? r.inventorySnapshot.belowParCount : "";
    csv += `${r.date},${r.totalBatches},${r.averageDuration},${cost},"${workflows}",${labourHrs},${labourCost},${belowPar}\n`;
  });
  return csv;
}

export async function importReportsFromJSON(jsonString: string): Promise<void> {
  try {
    const imported: ReportsData = JSON.parse(jsonString);
    if (!imported.environmental || !imported.batchCompletions || !imported.daily) {
      throw new Error("Invalid reports data structure");
    }
    reportsData = imported;
    await saveReports();
    await forceSyncToSupabase();
  } catch (error) {
    console.error("Error importing reports:", error);
    throw error;
  }
}

export async function clearAllReports(): Promise<void> {
  reportsData = { environmental: [], batchCompletions: [], daily: [] };
  await saveReports();
}