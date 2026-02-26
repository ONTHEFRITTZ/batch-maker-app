import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  Modal, TextInput, Alert, Share, Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '../../contexts/ThemeContext';
import {
  getEnvironmentalReports,
  getBatchCompletionReports,
  getDailyReports,
  generateDailyReport,
  searchBatchReports,
  exportReportsAsJSON,
  generateBatchReportsCSV,
  generateEnvironmentalReportsCSV,
  generateDailyReportsCSV,
  deleteEnvironmentalReport,
  deleteBatchCompletionReport,
  deleteDailyReport,
  EnvironmentalReport,
  BatchCompletionReport,
  DailyReport,
} from '../../services/reports';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

// ─── Tab types ────────────────────────────────────────────────────────────────
type TabType = 'day' | 'batches';

// ─── Helpers ──────────────────────────────────────────────────────────────────
const today = () => new Date().toDateString();

function formatDate(ts: number) {
  return new Date(ts).toLocaleDateString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  });
}

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDuration(minutes: number) {
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

// ─── Subcomponents ────────────────────────────────────────────────────────────

/** Single pill-style stat */
function StatPill({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
  return (
    <View style={styles.statPill}>
      <Text style={styles.statPillValue}>{value}</Text>
      <Text style={[styles.statPillLabel, accent ? { color: accent } : undefined]}>{label}</Text>
    </View>
  );
}

/** Section header */
function SectionHeader({ title, right }: { title: string; right?: React.ReactNode }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {right}
    </View>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function ReportsScreen() {
  const router = useRouter();
  const { colors } = useTheme();

  const [activeTab, setActiveTab] = useState<TabType>('day');

  // Data
  const [dailyReports, setDailyReports] = useState<DailyReport[]>([]);
  const [batchReports, setBatchReports] = useState<BatchCompletionReport[]>([]);
  const [sodReports, setSodReports] = useState<EnvironmentalReport[]>([]);

  // Batch search / filter
  const [searchQuery, setSearchQuery] = useState('');
  const [filteredBatches, setFilteredBatches] = useState<BatchCompletionReport[]>([]);

  // Selected reports for detail modal
  const [selectedDaily, setSelectedDaily] = useState<DailyReport | null>(null);
  const [selectedSod, setSelectedSod] = useState<EnvironmentalReport | null>(null);
  const [selectedBatch, setSelectedBatch] = useState<BatchCompletionReport | null>(null);

  // Generate report modal
  const [generateModalOpen, setGenerateModalOpen] = useState(false);

  // Edit fields for day-report detail modal
  const [editNotes, setEditNotes] = useState('');
  const [editEndNotes, setEditEndNotes] = useState('');

  // ── Load ──────────────────────────────────────────────────────────────────
  const load = useCallback(() => {
    setDailyReports(getDailyReports());
    setBatchReports(getBatchCompletionReports());
    setSodReports(getEnvironmentalReports());
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const q = searchQuery.trim().toLowerCase();
    setFilteredBatches(
      q
        ? batchReports.filter(r =>
            r.batchName?.toLowerCase().includes(q) ||
            r.workflowName?.toLowerCase().includes(q),
          )
        : batchReports,
    );
  }, [searchQuery, batchReports]);

  // ── Derived state ─────────────────────────────────────────────────────────
  const todaySod = sodReports.find(r => new Date(r.timestamp).toDateString() === today());
  const todayDaily = dailyReports.find(r => new Date(r.timestamp).toDateString() === today());
  const activeWorkday = todayDaily && !(todayDaily as any).endTime;

  // ── Generate modal logic ──────────────────────────────────────────────────
  function handleGeneratePress() {
    setGenerateModalOpen(true);
  }

  async function handleGenerateSoD() {
    setGenerateModalOpen(false);
    router.push('/screens/EnvironmentalReportScreen');
  }

  async function handleGenerateEoD() {
    setGenerateModalOpen(false);
    try {
      await generateDailyReport();
      load();
      Alert.alert('End of Day Report', 'Today\'s report has been generated.');
    } catch {
      Alert.alert('Error', 'Failed to generate report.');
    }
  }

  // ── Export ────────────────────────────────────────────────────────────────
  async function handleExportCSV(type: 'batch' | 'environmental' | 'daily') {
    try {
      let csv = '';
      let filename = '';
      if (type === 'batch') { csv = generateBatchReportsCSV(); filename = 'batch-reports.csv'; }
      else if (type === 'environmental') { csv = generateEnvironmentalReportsCSV(); filename = 'sod-reports.csv'; }
      else { csv = generateDailyReportsCSV(); filename = 'daily-reports.csv'; }

      const uri = FileSystem.documentDirectory + filename;
      await FileSystem.writeAsStringAsync(uri, csv, { encoding: FileSystem.EncodingType.UTF8 });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'text/csv', dialogTitle: 'Export CSV', UTI: 'public.comma-separated-values-text' });
      } else {
        Alert.alert('Saved', `CSV saved to ${uri}`);
      }
    } catch {
      Alert.alert('Error', 'Failed to export CSV');
    }
  }

  function handleExport() {
    Alert.alert('Export Reports', 'Choose format', [
      { text: 'CSV — Batches', onPress: () => handleExportCSV('batch') },
      { text: 'CSV — Start of Day', onPress: () => handleExportCSV('environmental') },
      { text: 'CSV — End of Day', onPress: () => handleExportCSV('daily') },
      { text: 'JSON (Full backup)', onPress: async () => {
        try { await Share.share({ message: exportReportsAsJSON(), title: 'Reports JSON' }); }
        catch { Alert.alert('Error', 'Failed to export'); }
      }},
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  // ── Delete helpers ────────────────────────────────────────────────────────
  function confirmDelete(onConfirm: () => void) {
    Alert.alert('Delete Report', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: onConfirm },
    ]);
  }

  // ── Open report helpers ───────────────────────────────────────────────────
  function openDaily(r: DailyReport) {
    setEditNotes((r as any).notes || '');
    setEditEndNotes((r as any).endNotes || '');
    setSelectedDaily(r);
  }

  function openSod(r: EnvironmentalReport) {
    setSelectedSod(r);
  }

  function openBatch(r: BatchCompletionReport) {
    setSelectedBatch(r);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────
  const bg = colors.background;
  const surface = colors.surface;
  const border = colors.border;
  const text = colors.text;
  const sub = colors.textSecondary;
  const primary = colors.primary;

  return (
    <View style={[styles.root, { backgroundColor: bg }]}>

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <View style={[styles.header, { backgroundColor: surface, borderBottomColor: border }]}>
        <Text style={[styles.headerTitle, { color: text }]}>Reports</Text>
        <View style={styles.headerRight}>
          <TouchableOpacity
            style={[styles.headerBtn, { backgroundColor: primary }]}
            onPress={handleGeneratePress}
          >
            <Text style={styles.headerBtnText}>+ Report</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.headerBtn, { backgroundColor: surface, borderWidth: 1, borderColor: border, marginLeft: 8 }]}
            onPress={handleExport}
          >
            <Text style={[styles.headerBtnText, { color: text }]}>Export</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* ── Tab bar ────────────────────────────────────────────────────── */}
      <View style={[styles.tabBar, { backgroundColor: surface, borderBottomColor: border }]}>
        {([['day', '📅 Day Reports'], ['batches', '🧺 Batches']] as [TabType, string][]).map(([tab, label]) => (
          <TouchableOpacity
            key={tab}
            style={[styles.tab, activeTab === tab && { borderBottomColor: primary, borderBottomWidth: 3 }]}
            onPress={() => setActiveTab(tab)}
          >
            <Text style={[styles.tabText, { color: activeTab === tab ? primary : sub }]}>
              {label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* ── Content ────────────────────────────────────────────────────── */}
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>

        {/* ════════════════ DAY REPORTS TAB ════════════════ */}
        {activeTab === 'day' && (
          <>
            {/* Today summary card */}
            <View style={[styles.todayCard, { backgroundColor: surface, borderColor: border }]}>
              <Text style={[styles.todayLabel, { color: sub }]}>TODAY</Text>
              <View style={styles.todayRow}>
                <View style={styles.todayItem}>
                  <Text style={[styles.todayStatus, { color: todaySod ? colors.success : colors.error }]}>
                    {todaySod ? '✓ Done' : '— None'}
                  </Text>
                  <Text style={[styles.todayItemLabel, { color: sub }]}>Start of Day</Text>
                </View>
                <View style={[styles.todayDivider, { backgroundColor: border }]} />
                <View style={styles.todayItem}>
                  <Text style={[styles.todayStatus, {
                    color: todayDaily
                      ? activeWorkday ? colors.warning : colors.success
                      : colors.error,
                  }]}>
                    {todayDaily ? (activeWorkday ? '⏳ Open' : '✓ Done') : '— None'}
                  </Text>
                  <Text style={[styles.todayItemLabel, { color: sub }]}>End of Day</Text>
                </View>
                <View style={[styles.todayDivider, { backgroundColor: border }]} />
                <View style={styles.todayItem}>
                  <Text style={[styles.todayStatus, { color: text }]}>
                    {batchReports.filter(r => new Date(r.timestamp).toDateString() === today()).length}
                  </Text>
                  <Text style={[styles.todayItemLabel, { color: sub }]}>Batches</Text>
                </View>
              </View>
            </View>

            {/* ── Start of Day Reports ── */}
            <SectionHeader title="Start of Day" right={
              <TouchableOpacity onPress={handleGenerateSoD}>
                <Text style={[styles.sectionAction, { color: primary }]}>+ New</Text>
              </TouchableOpacity>
            } />

            {sodReports.length === 0 ? (
              <View style={[styles.emptyCard, { backgroundColor: surface, borderColor: border }]}>
                <Text style={[styles.emptyText, { color: sub }]}>No start of day reports yet</Text>
              </View>
            ) : (
              sodReports.map(r => (
                <TouchableOpacity
                  key={r.id}
                  style={[styles.reportCard, { backgroundColor: surface, borderColor: border }]}
                  onPress={() => openSod(r)}
                  activeOpacity={0.7}
                >
                  <View style={styles.reportCardLeft}>
                    <View style={[styles.reportTypeBadge, { backgroundColor: '#e8f5e9' }]}>
                      <Text style={[styles.reportTypeBadgeText, { color: '#2e7d32' }]}>SoD</Text>
                    </View>
                    <View style={styles.reportCardInfo}>
                      <Text style={[styles.reportCardDate, { color: text }]}>{formatDate(r.timestamp)}</Text>
                      <Text style={[styles.reportCardSub, { color: sub }]}>
                        {formatTime(r.timestamp)} · {r.createdBy || 'Unknown'}
                      </Text>
                      {(r.ambientTemp !== undefined || r.humidity !== undefined) && (
                        <Text style={[styles.reportCardMeta, { color: sub }]}>
                          {r.ambientTemp !== undefined ? `🌡 ${r.ambientTemp}°C  ` : ''}
                          {r.humidity !== undefined ? `💧 ${r.humidity}%` : ''}
                        </Text>
                      )}
                    </View>
                  </View>
                  <Text style={[styles.chevron, { color: sub }]}>›</Text>
                </TouchableOpacity>
              ))
            )}

            {/* ── End of Day Reports ── */}
            <SectionHeader title="End of Day" />

            {dailyReports.length === 0 ? (
              <View style={[styles.emptyCard, { backgroundColor: surface, borderColor: border }]}>
                <Text style={[styles.emptyText, { color: sub }]}>No end of day reports yet</Text>
              </View>
            ) : (
              dailyReports.map(r => {
                const batchCount = r.totalBatches ?? 0;
                const isOpen = !(r as any).endTime;
                return (
                  <TouchableOpacity
                    key={r.id}
                    style={[styles.reportCard, { backgroundColor: surface, borderColor: border }]}
                    onPress={() => openDaily(r)}
                    activeOpacity={0.7}
                  >
                    <View style={styles.reportCardLeft}>
                      <View style={[styles.reportTypeBadge, {
                        backgroundColor: isOpen ? '#fff8e1' : '#e3f2fd',
                      }]}>
                        <Text style={[styles.reportTypeBadgeText, {
                          color: isOpen ? '#f57f17' : '#1565c0',
                        }]}>
                          {isOpen ? 'Open' : 'EoD'}
                        </Text>
                      </View>
                      <View style={styles.reportCardInfo}>
                        <Text style={[styles.reportCardDate, { color: text }]}>{formatDate(r.timestamp)}</Text>
                        <Text style={[styles.reportCardSub, { color: sub }]}>
                          {batchCount} batch{batchCount !== 1 ? 'es' : ''}
                          {r.averageDuration ? `  ·  avg ${formatDuration(r.averageDuration)}` : ''}
                        </Text>
                      </View>
                    </View>
                    <Text style={[styles.chevron, { color: sub }]}>›</Text>
                  </TouchableOpacity>
                );
              })
            )}
          </>
        )}

        {/* ════════════════ BATCHES TAB ════════════════ */}
        {activeTab === 'batches' && (
          <>
            {/* Search */}
            <View style={[styles.searchWrap, { backgroundColor: surface }]}>
              <TextInput
                style={[styles.searchInput, { backgroundColor: bg, color: text, borderColor: border }]}
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder="Search batches…"
                placeholderTextColor={sub}
                clearButtonMode="while-editing"
              />
            </View>

            {/* Summary pills */}
            {batchReports.length > 0 && (
              <View style={[styles.pillRow, { backgroundColor: surface, borderColor: border }]}>
                <StatPill label="Total" value={batchReports.length} />
                <StatPill label="Today" value={batchReports.filter(r => new Date(r.timestamp).toDateString() === today()).length} />
                <StatPill
                  label="Wasted"
                  value={batchReports.filter(r => (r as any).wasted).length}
                  accent={colors.error}
                />
              </View>
            )}

            {filteredBatches.length === 0 ? (
              <View style={[styles.emptyCard, { backgroundColor: surface, borderColor: border }]}>
                <Text style={[styles.emptyText, { color: sub }]}>
                  {searchQuery ? 'No matching batches' : 'No batch reports yet'}
                </Text>
              </View>
            ) : (
              filteredBatches.map(r => {
                const wasted = !!(r as any).wasted;
                return (
                  <TouchableOpacity
                    key={r.id}
                    style={[styles.reportCard, { backgroundColor: surface, borderColor: border }]}
                    onPress={() => openBatch(r)}
                    activeOpacity={0.7}
                  >
                    <View style={styles.reportCardLeft}>
                      <View style={[styles.reportTypeBadge, {
                        backgroundColor: wasted ? '#fce4ec' : '#e8f5e9',
                      }]}>
                        <Text style={[styles.reportTypeBadgeText, {
                          color: wasted ? '#c62828' : '#2e7d32',
                        }]}>
                          {wasted ? 'Waste' : 'Done'}
                        </Text>
                      </View>
                      <View style={styles.reportCardInfo}>
                        <Text style={[styles.reportCardDate, { color: text }]} numberOfLines={1}>
                          {(r as any).batchName || 'Batch'}
                        </Text>
                        <Text style={[styles.reportCardSub, { color: sub }]}>
                          {formatDate(r.timestamp)} · {formatTime(r.timestamp)}
                        </Text>
                        <Text style={[styles.reportCardMeta, { color: sub }]}>
                          {(r as any).batchSizeMultiplier}x
                          {(r as any).actualDuration ? `  ·  ${formatDuration((r as any).actualDuration)}` : ''}
                        </Text>
                      </View>
                    </View>
                    <Text style={[styles.chevron, { color: sub }]}>›</Text>
                  </TouchableOpacity>
                );
              })
            )}
          </>
        )}
      </ScrollView>

      {/* ════════════════ GENERATE MODAL ════════════════ */}
      <Modal
        visible={generateModalOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setGenerateModalOpen(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setGenerateModalOpen(false)}
        >
          <View
            style={[styles.generateSheet, { backgroundColor: surface }]}
            // Prevent touches inside sheet closing the modal
            onStartShouldSetResponder={() => true}
          >
            <Text style={[styles.generateSheetTitle, { color: text }]}>Generate Report</Text>
            <Text style={[styles.generateSheetSub, { color: sub }]}>
              What type of report do you want to create?
            </Text>

            {/* Start of Day */}
            <TouchableOpacity
              style={[styles.generateOption, { borderColor: border }]}
              onPress={handleGenerateSoD}
            >
              <View style={[styles.generateOptionIcon, { backgroundColor: '#e8f5e9' }]}>
                <Text style={{ fontSize: 22 }}>🌅</Text>
              </View>
              <View style={styles.generateOptionText}>
                <Text style={[styles.generateOptionTitle, { color: text }]}>Start of Day</Text>
                <Text style={[styles.generateOptionSub, { color: sub }]}>
                  {todaySod
                    ? `Already done today at ${formatTime(todaySod.timestamp)}`
                    : 'Temperature, humidity, equipment check'}
                </Text>
              </View>
              {!todaySod && (
                <View style={[styles.generateBadge, { backgroundColor: '#4caf50' }]}>
                  <Text style={styles.generateBadgeText}>Needed</Text>
                </View>
              )}
            </TouchableOpacity>

            {/* End of Day */}
            <TouchableOpacity
              style={[styles.generateOption, { borderColor: border }]}
              onPress={handleGenerateEoD}
            >
              <View style={[styles.generateOptionIcon, { backgroundColor: '#e3f2fd' }]}>
                <Text style={{ fontSize: 22 }}>🌙</Text>
              </View>
              <View style={styles.generateOptionText}>
                <Text style={[styles.generateOptionTitle, { color: text }]}>End of Day</Text>
                <Text style={[styles.generateOptionSub, { color: sub }]}>
                  {activeWorkday
                    ? 'Close out today\'s workday'
                    : todayDaily
                    ? `Already done today`
                    : 'Summarise batches, costs, and output'}
                </Text>
              </View>
              {activeWorkday && (
                <View style={[styles.generateBadge, { backgroundColor: '#ff9800' }]}>
                  <Text style={styles.generateBadgeText}>Open</Text>
                </View>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.generateCancelBtn, { borderColor: border }]}
              onPress={() => setGenerateModalOpen(false)}
            >
              <Text style={[styles.generateCancelText, { color: sub }]}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* ════════════════ SoD DETAIL MODAL ════════════════ */}
      <Modal
        visible={!!selectedSod}
        transparent
        animationType="slide"
        onRequestClose={() => setSelectedSod(null)}
      >
        <View style={[styles.detailModal, { backgroundColor: bg }]}>
          <View style={[styles.detailHeader, { backgroundColor: surface, borderBottomColor: border }]}>
            <TouchableOpacity onPress={() => setSelectedSod(null)}>
              <Text style={[styles.detailBack, { color: primary }]}>‹ Back</Text>
            </TouchableOpacity>
            <Text style={[styles.detailTitle, { color: text }]}>Start of Day</Text>
            <TouchableOpacity onPress={() => {
              confirmDelete(async () => {
                if (!selectedSod) return;
                await deleteEnvironmentalReport(selectedSod.id);
                setSelectedSod(null);
                load();
              });
            }}>
              <Text style={[styles.detailDelete, { color: colors.error }]}>Delete</Text>
            </TouchableOpacity>
          </View>

          {selectedSod && (
            <ScrollView style={styles.detailScroll} contentContainerStyle={styles.detailContent}>
              <Text style={[styles.detailDateLarge, { color: text }]}>{formatDate(selectedSod.timestamp)}</Text>
              <Text style={[styles.detailTimeSub, { color: sub }]}>
                {formatTime(selectedSod.timestamp)} · {selectedSod.createdBy}
              </Text>

              <View style={[styles.detailSection, { borderTopColor: border }]}>
                <Text style={[styles.detailSectionTitle, { color: sub }]}>ENVIRONMENT</Text>
                <View style={styles.detailRow}>
                  <Text style={[styles.detailLabel, { color: sub }]}>Temperature</Text>
                  <Text style={[styles.detailValue, { color: text }]}>
                    {selectedSod.ambientTemp !== undefined ? `${selectedSod.ambientTemp}°C` : '—'}
                  </Text>
                </View>
                <View style={styles.detailRow}>
                  <Text style={[styles.detailLabel, { color: sub }]}>Humidity</Text>
                  <Text style={[styles.detailValue, { color: text }]}>
                    {selectedSod.humidity !== undefined ? `${selectedSod.humidity}%` : '—'}
                  </Text>
                </View>
              </View>

              {selectedSod.notes ? (
                <View style={[styles.detailSection, { borderTopColor: border }]}>
                  <Text style={[styles.detailSectionTitle, { color: sub }]}>NOTES</Text>
                  <Text style={[styles.detailNotes, { color: text }]}>{selectedSod.notes}</Text>
                </View>
              ) : null}

              <TouchableOpacity
                style={[styles.detailEditBtn, { borderColor: primary }]}
                onPress={() => {
                  setSelectedSod(null);
                  router.push({ pathname: '/screens/EnvironmentalReportScreen', params: { editId: selectedSod?.id } });
                }}
              >
                <Text style={[styles.detailEditBtnText, { color: primary }]}>✏️ Edit This Report</Text>
              </TouchableOpacity>
            </ScrollView>
          )}
        </View>
      </Modal>

      {/* ════════════════ EoD DETAIL MODAL ════════════════ */}
      <Modal
        visible={!!selectedDaily}
        transparent
        animationType="slide"
        onRequestClose={() => setSelectedDaily(null)}
      >
        <View style={[styles.detailModal, { backgroundColor: bg }]}>
          <View style={[styles.detailHeader, { backgroundColor: surface, borderBottomColor: border }]}>
            <TouchableOpacity onPress={() => setSelectedDaily(null)}>
              <Text style={[styles.detailBack, { color: primary }]}>‹ Back</Text>
            </TouchableOpacity>
            <Text style={[styles.detailTitle, { color: text }]}>End of Day</Text>
            <TouchableOpacity onPress={() => {
              confirmDelete(async () => {
                if (!selectedDaily) return;
                await deleteDailyReport(selectedDaily.id);
                setSelectedDaily(null);
                load();
              });
            }}>
              <Text style={[styles.detailDelete, { color: colors.error }]}>Delete</Text>
            </TouchableOpacity>
          </View>

          {selectedDaily && (
            <ScrollView style={styles.detailScroll} contentContainerStyle={styles.detailContent}>
              <Text style={[styles.detailDateLarge, { color: text }]}>{formatDate(selectedDaily.timestamp)}</Text>

              <View style={styles.pillRow}>
                <StatPill label="Batches" value={selectedDaily.totalBatches ?? 0} />
                <StatPill label="Avg Duration"
                  value={selectedDaily.averageDuration ? formatDuration(selectedDaily.averageDuration) : '—'} />
              </View>

              {Object.keys(selectedDaily.batchesByWorkflow ?? {}).length > 0 && (
                <View style={[styles.detailSection, { borderTopColor: border }]}>
                  <Text style={[styles.detailSectionTitle, { color: sub }]}>BY WORKFLOW</Text>
                  {Object.entries(selectedDaily.batchesByWorkflow).map(([wf, count]) => (
                    <View key={wf} style={styles.detailRow}>
                      <Text style={[styles.detailLabel, { color: sub }]} numberOfLines={1}>{wf}</Text>
                      <Text style={[styles.detailValue, { color: text }]}>{count as number}</Text>
                    </View>
                  ))}
                </View>
              )}

              <View style={[styles.detailSection, { borderTopColor: border }]}>
                <Text style={[styles.detailSectionTitle, { color: sub }]}>NOTES</Text>
                <TextInput
                  style={[styles.detailTextArea, { color: text, borderColor: border, backgroundColor: bg }]}
                  value={editNotes}
                  onChangeText={setEditNotes}
                  placeholder="Add notes…"
                  placeholderTextColor={sub}
                  multiline
                  numberOfLines={4}
                />
              </View>

              <TouchableOpacity
                style={[styles.detailSaveBtn, { backgroundColor: primary }]}
                onPress={() => {
                  // Persist notes update — your reports service should expose an update fn
                  // updateDailyReport(selectedDaily.id, { notes: editNotes });
                  setSelectedDaily(null);
                  load();
                }}
              >
                <Text style={styles.detailSaveBtnText}>Save Changes</Text>
              </TouchableOpacity>
            </ScrollView>
          )}
        </View>
      </Modal>

      {/* ════════════════ BATCH DETAIL MODAL ════════════════ */}
      <Modal
        visible={!!selectedBatch}
        transparent
        animationType="slide"
        onRequestClose={() => setSelectedBatch(null)}
      >
        <View style={[styles.detailModal, { backgroundColor: bg }]}>
          <View style={[styles.detailHeader, { backgroundColor: surface, borderBottomColor: border }]}>
            <TouchableOpacity onPress={() => setSelectedBatch(null)}>
              <Text style={[styles.detailBack, { color: primary }]}>‹ Back</Text>
            </TouchableOpacity>
            <Text style={[styles.detailTitle, { color: text }]} numberOfLines={1}>
              {(selectedBatch as any)?.batchName || 'Batch'}
            </Text>
            <TouchableOpacity onPress={() => {
              confirmDelete(async () => {
                if (!selectedBatch) return;
                await deleteBatchCompletionReport(selectedBatch.id);
                setSelectedBatch(null);
                load();
              });
            }}>
              <Text style={[styles.detailDelete, { color: colors.error }]}>Delete</Text>
            </TouchableOpacity>
          </View>

          {selectedBatch && (
            <ScrollView style={styles.detailScroll} contentContainerStyle={styles.detailContent}>
              {(selectedBatch as any).wasted && (
                <View style={[styles.wastedBanner, { backgroundColor: '#fce4ec' }]}>
                  <Text style={[styles.wastedBannerText, { color: '#c62828' }]}>
                    ⚠ Wasted
                    {(selectedBatch as any).wastedAtStepName
                      ? ` at "${(selectedBatch as any).wastedAtStepName}"`
                      : ''}
                  </Text>
                </View>
              )}

              <Text style={[styles.detailDateLarge, { color: text }]}>
                {formatDate(selectedBatch.timestamp)}
              </Text>
              <Text style={[styles.detailTimeSub, { color: sub }]}>
                {formatTime(selectedBatch.timestamp)}
              </Text>

              <View style={[styles.detailSection, { borderTopColor: border }]}>
                <Text style={[styles.detailSectionTitle, { color: sub }]}>DETAILS</Text>
                {[
                  ['Workflow', (selectedBatch as any).workflowName],
                  ['Completed by', (selectedBatch as any).completedBy],
                  ['Batch size', `${(selectedBatch as any).batchSizeMultiplier}x`],
                  ['Duration', (selectedBatch as any).actualDuration ? formatDuration((selectedBatch as any).actualDuration) : null],
                  ['Total cost', (selectedBatch as any).totalCost != null ? `$${(selectedBatch as any).totalCost.toFixed(2)}` : null],
                  ['Yield', (selectedBatch as any).yieldAmount != null
                    ? `${(selectedBatch as any).yieldAmount} ${(selectedBatch as any).yieldUnit || ''}`
                    : null],
                ].filter(([, v]) => v).map(([label, value]) => (
                  <View key={label as string} style={styles.detailRow}>
                    <Text style={[styles.detailLabel, { color: sub }]}>{label}</Text>
                    <Text style={[styles.detailValue, { color: text }]}>{value}</Text>
                  </View>
                ))}
              </View>

              {(selectedBatch as any).notes ? (
                <View style={[styles.detailSection, { borderTopColor: border }]}>
                  <Text style={[styles.detailSectionTitle, { color: sub }]}>NOTES</Text>
                  <Text style={[styles.detailNotes, { color: text }]}>{(selectedBatch as any).notes}</Text>
                </View>
              ) : null}

              {(selectedBatch as any).wasteNotes ? (
                <View style={[styles.detailSection, { borderTopColor: border }]}>
                  <Text style={[styles.detailSectionTitle, { color: '#c62828' }]}>WASTE NOTES</Text>
                  <Text style={[styles.detailNotes, { color: text }]}>{(selectedBatch as any).wasteNotes}</Text>
                </View>
              ) : null}
            </ScrollView>
          )}
        </View>
      </Modal>

    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1 },

  // Header
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1,
  },
  headerTitle: { fontSize: 22, fontWeight: '700' },
  headerRight: { flexDirection: 'row', alignItems: 'center' },
  headerBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8 },
  headerBtnText: { color: 'white', fontSize: 14, fontWeight: '600' },

  // Tabs
  tabBar: {
    flexDirection: 'row', borderBottomWidth: 1,
  },
  tab: { flex: 1, paddingVertical: 14, alignItems: 'center' },
  tabText: { fontSize: 15, fontWeight: '600' },

  // Scroll
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 48 },

  // Today card
  todayCard: {
    borderRadius: 14, borderWidth: 1, padding: 16, marginBottom: 20,
  },
  todayLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 1, marginBottom: 12 },
  todayRow: { flexDirection: 'row', alignItems: 'center' },
  todayItem: { flex: 1, alignItems: 'center' },
  todayStatus: { fontSize: 16, fontWeight: '700', marginBottom: 4 },
  todayItemLabel: { fontSize: 11 },
  todayDivider: { width: 1, height: 36, marginHorizontal: 8 },

  // Section header
  sectionHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginTop: 8, marginBottom: 10,
  },
  sectionTitle: { fontSize: 16, fontWeight: '700' },
  sectionAction: { fontSize: 14, fontWeight: '600' },

  // Empty
  emptyCard: {
    borderRadius: 12, borderWidth: 1, padding: 28, alignItems: 'center', marginBottom: 16,
  },
  emptyText: { fontSize: 15 },

  // Report card
  reportCard: {
    borderRadius: 12, borderWidth: 1, padding: 14,
    marginBottom: 10, flexDirection: 'row', alignItems: 'center',
  },
  reportCardLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  reportTypeBadge: {
    width: 44, height: 44, borderRadius: 10,
    justifyContent: 'center', alignItems: 'center',
  },
  reportTypeBadgeText: { fontSize: 11, fontWeight: '700' },
  reportCardInfo: { flex: 1 },
  reportCardDate: { fontSize: 15, fontWeight: '600', marginBottom: 2 },
  reportCardSub: { fontSize: 13 },
  reportCardMeta: { fontSize: 12, marginTop: 2 },
  chevron: { fontSize: 24, marginLeft: 8 },

  // Stat pills
  pillRow: {
    flexDirection: 'row', borderRadius: 12, borderWidth: 1,
    padding: 12, marginBottom: 14, gap: 4,
  },
  statPill: { flex: 1, alignItems: 'center' },
  statPillValue: { fontSize: 20, fontWeight: '700' },
  statPillLabel: { fontSize: 11, marginTop: 2 },

  // Search
  searchWrap: { marginBottom: 12 },
  searchInput: {
    borderWidth: 1, borderRadius: 10, paddingHorizontal: 14,
    paddingVertical: 10, fontSize: 15,
  },

  // Generate modal
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end',
  },
  generateSheet: {
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 24, paddingBottom: Platform.OS === 'ios' ? 40 : 24,
  },
  generateSheetTitle: { fontSize: 20, fontWeight: '700', marginBottom: 4 },
  generateSheetSub: { fontSize: 14, marginBottom: 20 },
  generateOption: {
    flexDirection: 'row', alignItems: 'center', borderWidth: 1,
    borderRadius: 14, padding: 14, marginBottom: 12, gap: 14,
  },
  generateOptionIcon: {
    width: 48, height: 48, borderRadius: 12, justifyContent: 'center', alignItems: 'center',
  },
  generateOptionText: { flex: 1 },
  generateOptionTitle: { fontSize: 16, fontWeight: '600', marginBottom: 2 },
  generateOptionSub: { fontSize: 13 },
  generateBadge: {
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20,
  },
  generateBadgeText: { color: 'white', fontSize: 12, fontWeight: '600' },
  generateCancelBtn: {
    borderWidth: 1, borderRadius: 12, padding: 14, alignItems: 'center', marginTop: 4,
  },
  generateCancelText: { fontSize: 15, fontWeight: '600' },

  // Detail modals
  detailModal: { flex: 1 },
  detailHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1,
  },
  detailBack: { fontSize: 16, fontWeight: '600', minWidth: 60 },
  detailTitle: { fontSize: 17, fontWeight: '700', flex: 1, textAlign: 'center' },
  detailDelete: { fontSize: 14, fontWeight: '600', minWidth: 60, textAlign: 'right' },
  detailScroll: { flex: 1 },
  detailContent: { padding: 20, paddingBottom: 60 },
  detailDateLarge: { fontSize: 22, fontWeight: '700', marginBottom: 4 },
  detailTimeSub: { fontSize: 14, marginBottom: 16 },
  detailSection: { borderTopWidth: 1, paddingTop: 16, marginTop: 4, marginBottom: 4 },
  detailSectionTitle: { fontSize: 11, fontWeight: '700', letterSpacing: 1, marginBottom: 10 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  detailLabel: { fontSize: 14, flex: 1 },
  detailValue: { fontSize: 14, fontWeight: '600' },
  detailNotes: { fontSize: 15, lineHeight: 22 },
  detailTextArea: {
    borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 15,
    minHeight: 100, textAlignVertical: 'top',
  },
  detailSaveBtn: {
    padding: 16, borderRadius: 12, alignItems: 'center', marginTop: 20,
  },
  detailSaveBtnText: { color: 'white', fontSize: 16, fontWeight: '600' },
  detailEditBtn: {
    borderWidth: 1, borderRadius: 12, padding: 14, alignItems: 'center', marginTop: 20,
  },
  detailEditBtnText: { fontSize: 15, fontWeight: '600' },
  wastedBanner: {
    borderRadius: 10, padding: 12, marginBottom: 14,
  },
  wastedBannerText: { fontSize: 14, fontWeight: '600' },
});