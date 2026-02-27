import React, { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, Alert, ActivityIndicator,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTheme } from '../../contexts/ThemeContext';
import {
  createEnvironmentalReport,
  updateEnvironmentalReport,
  getEnvironmentalReports,
} from '../../services/reports';
import { getDeviceName } from '../../services/database';

export default function EnvironmentalReportScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { editId } = useLocalSearchParams<{ editId?: string }>();

  const isEditing = !!editId;

  const [loading, setLoading] = useState(isEditing);
  const [saving, setSaving] = useState(false);

  const [ambientTemp, setAmbientTemp] = useState('');
  const [humidity, setHumidity] = useState('');
  const [fridgeTemp, setFridgeTemp] = useState('');
  const [freezerTemp, setFreezerTemp] = useState('');
  const [proofTemp, setProofTemp] = useState('');
  const [ovenTemp, setOvenTemp] = useState('');
  const [notes, setNotes] = useState('');

  // ── Load existing report if editing ─────────────────────────────────────
  useEffect(() => {
    if (!isEditing) return;
    const all = getEnvironmentalReports();
    const existing = all.find(r => r.id === editId);
    if (existing) {
      setAmbientTemp(existing.ambientTemp != null ? String(existing.ambientTemp) : '');
      setHumidity(existing.humidity != null ? String(existing.humidity) : '');
      setFridgeTemp((existing as any).fridgeTemp != null ? String((existing as any).fridgeTemp) : '');
      setFreezerTemp((existing as any).freezerTemp != null ? String((existing as any).freezerTemp) : '');
      setProofTemp((existing as any).proofTemp != null ? String((existing as any).proofTemp) : '');
      setOvenTemp((existing as any).ovenTemp != null ? String((existing as any).ovenTemp) : '');
      setNotes(existing.notes ?? '');
    }
    setLoading(false);
  }, [editId]);

  // ── Save ─────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    const temp     = parseFloat(ambientTemp);
    const hum      = parseFloat(humidity);
    const fridge   = parseFloat(fridgeTemp);
    const freezer  = parseFloat(freezerTemp);
    const proof    = parseFloat(proofTemp);
    const oven     = parseFloat(ovenTemp);

    const hasAnyValue =
      !isNaN(temp) || !isNaN(hum) || !isNaN(fridge) ||
      !isNaN(freezer) || !isNaN(proof) || !isNaN(oven) ||
      notes.trim().length > 0;

    if (!hasAnyValue) {
      Alert.alert('Nothing to save', 'Please enter at least one value.');
      return;
    }

    setSaving(true);
    try {
      const extras = {
        fridgeTemp:  !isNaN(fridge)  ? fridge  : undefined,
        freezerTemp: !isNaN(freezer) ? freezer : undefined,
        proofTemp:   !isNaN(proof)   ? proof   : undefined,
        ovenTemp:    !isNaN(oven)    ? oven    : undefined,
      };

      if (isEditing && editId) {
        await updateEnvironmentalReport(editId, {
          ambientTemp: !isNaN(temp) ? temp : undefined,
          humidity:    !isNaN(hum)  ? hum  : undefined,
          notes:       notes.trim() || undefined,
          ...extras,
        });
        Alert.alert('Updated', 'Start of Day report updated.', [
          { text: 'OK', onPress: () => router.back() },
        ]);
      } else {
        const deviceName = await getDeviceName();
        await createEnvironmentalReport(
          deviceName,
          !isNaN(temp) ? temp : undefined,
          !isNaN(hum)  ? hum  : undefined,
          notes.trim() || undefined,
          extras,
        );
        Alert.alert('Saved', 'Start of Day report saved!', [
          { text: 'OK', onPress: () => router.back() },
        ]);
      }
    } catch (error) {
      console.error('Error saving SoD report:', error);
      Alert.alert('Error', 'Failed to save report. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>

        {/* Title */}
        <Text style={[styles.title, { color: colors.text }]}>
          {isEditing ? 'Edit Start of Day' : 'Start of Day Report'}
        </Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          Record environmental and equipment conditions for quality control.
        </Text>

        {/* ── ENVIRONMENT SECTION ── */}
        <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>ENVIRONMENT</Text>

        <View style={styles.row}>
          <View style={[styles.fieldHalf, { marginRight: 8 }]}>
            <Text style={[styles.label, { color: colors.text }]}>Ambient Temp (°C)</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border }]}
              value={ambientTemp}
              onChangeText={setAmbientTemp}
              placeholder="e.g. 22"
              placeholderTextColor={colors.textSecondary}
              keyboardType="decimal-pad"
            />
          </View>
          <View style={styles.fieldHalf}>
            <Text style={[styles.label, { color: colors.text }]}>Humidity (%)</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border }]}
              value={humidity}
              onChangeText={setHumidity}
              placeholder="e.g. 65"
              placeholderTextColor={colors.textSecondary}
              keyboardType="decimal-pad"
            />
          </View>
        </View>

        {/* ── EQUIPMENT SECTION ── */}
        <Text style={[styles.sectionLabel, { color: colors.textSecondary, marginTop: 8 }]}>EQUIPMENT TEMPS (°C)</Text>

        <View style={styles.row}>
          <View style={[styles.fieldHalf, { marginRight: 8 }]}>
            <Text style={[styles.label, { color: colors.text }]}>Fridge</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border }]}
              value={fridgeTemp}
              onChangeText={setFridgeTemp}
              placeholder="e.g. 4"
              placeholderTextColor={colors.textSecondary}
              keyboardType="decimal-pad"
            />
          </View>
          <View style={styles.fieldHalf}>
            <Text style={[styles.label, { color: colors.text }]}>Freezer</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border }]}
              value={freezerTemp}
              onChangeText={setFreezerTemp}
              placeholder="e.g. -18"
              placeholderTextColor={colors.textSecondary}
              keyboardType="decimal-pad"
            />
          </View>
        </View>

        <View style={styles.row}>
          <View style={[styles.fieldHalf, { marginRight: 8 }]}>
            <Text style={[styles.label, { color: colors.text }]}>Proof Box</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border }]}
              value={proofTemp}
              onChangeText={setProofTemp}
              placeholder="e.g. 28"
              placeholderTextColor={colors.textSecondary}
              keyboardType="decimal-pad"
            />
          </View>
          <View style={styles.fieldHalf}>
            <Text style={[styles.label, { color: colors.text }]}>Oven</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border }]}
              value={ovenTemp}
              onChangeText={setOvenTemp}
              placeholder="e.g. 220"
              placeholderTextColor={colors.textSecondary}
              keyboardType="decimal-pad"
            />
          </View>
        </View>

        {/* ── NOTES ── */}
        <Text style={[styles.sectionLabel, { color: colors.textSecondary, marginTop: 8 }]}>NOTES</Text>
        <TextInput
          style={[styles.textArea, { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border }]}
          value={notes}
          onChangeText={setNotes}
          placeholder="Weather, unusual observations, equipment issues..."
          placeholderTextColor={colors.textSecondary}
          multiline
          numberOfLines={4}
        />

        {/* Info box (only on create) */}
        {!isEditing && (
          <View style={[styles.infoBox, { backgroundColor: colors.primary + '15', borderColor: colors.primary }]}>
            <Text style={[styles.infoTitle, { color: colors.primary }]}>Why Track This?</Text>
            <Text style={[styles.infoText, { color: colors.text }]}>
              Environmental conditions affect dough behaviour, rising times, and final product quality.
              This data helps maintain consistency and troubleshoot issues.
            </Text>
          </View>
        )}
      </ScrollView>

      {/* Bottom action bar */}
      <View style={[styles.actionBar, { backgroundColor: colors.surface, borderTopColor: colors.border }]}>
        <TouchableOpacity
          style={[styles.cancelButton, { backgroundColor: (colors as any).surfaceVariant ?? colors.surface }]}
          onPress={() => router.back()}
          disabled={saving}
        >
          <Text style={[styles.cancelButtonText, { color: colors.text }]}>Cancel</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.saveButton, { backgroundColor: saving ? colors.border : colors.success }]}
          onPress={handleSave}
          disabled={saving}
        >
          {saving
            ? <ActivityIndicator size="small" color="white" />
            : <Text style={styles.saveButtonText}>{isEditing ? 'Update Report' : 'Save Report'}</Text>
          }
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  container: { flex: 1 },
  scrollView: { flex: 1 },
  content: { padding: 20, paddingBottom: 120 },
  title: { fontSize: 26, fontWeight: '700', marginBottom: 6 },
  subtitle: { fontSize: 15, lineHeight: 22, marginBottom: 28 },
  sectionLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 1, marginBottom: 12 },
  row: { flexDirection: 'row', marginBottom: 16 },
  fieldHalf: { flex: 1 },
  label: { fontSize: 14, fontWeight: '600', marginBottom: 6 },
  input: { borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 16 },
  textArea: {
    borderWidth: 1, borderRadius: 10, padding: 12,
    fontSize: 16, minHeight: 100, textAlignVertical: 'top',
    marginBottom: 20,
  },
  infoBox: { borderWidth: 2, borderRadius: 12, padding: 16, marginTop: 8 },
  infoTitle: { fontSize: 15, fontWeight: '700', marginBottom: 6 },
  infoText: { fontSize: 14, lineHeight: 20 },
  actionBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', padding: 16, gap: 12, borderTopWidth: 1,
  },
  cancelButton: { flex: 1, padding: 16, borderRadius: 12, alignItems: 'center' },
  cancelButtonText: { fontSize: 16, fontWeight: '600' },
  saveButton: { flex: 1, padding: 16, borderRadius: 12, alignItems: 'center' },
  saveButtonText: { color: 'white', fontSize: 16, fontWeight: '600' },
});