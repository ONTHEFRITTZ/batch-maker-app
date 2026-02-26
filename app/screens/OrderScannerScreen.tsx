import React, { useState, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  TextInput, Alert, ActivityIndicator, Image,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImageManipulator from 'expo-image-manipulator';
import { supabase } from '../../lib/supabase';
import { useRouter } from 'expo-router';


const API_URL = process.env.EXPO_PUBLIC_API_URL || '';

// ── Types ─────────────────────────────────────────────────────────────────
interface ParsedLineItem {
  name: string;
  size: string | null;
  quantity: number;
  unit: string;
  unitPrice: number | null;
  extendedPrice: number | null;
  category: string;
  inventoryId: string | null;
  received: boolean;  // for backorder toggle
}

interface ParsedOrder {
  supplier: string | null;
  orderDate: string | null;
  items: ParsedLineItem[];
  financials: {
    subtotal: number | null;
    tax: number | null;
    fees: number | null;
    discounts: number | null;
    total: number | null;
  };
}

const CATEGORIES = [
  'Produce', 'Meat', 'Seafood', 'Dairy', 'Dry Goods',
  'Liquor', 'Beer', 'Wine', 'Non-Alcoholic',
  'Cleaning', 'Paper/Supplies', 'Other',
];

type Step = 'camera' | 'processing' | 'review' | 'saving';

interface Props {
  locationId: string;
  locationName: string;
  onComplete?: () => void;
  onCancel?: () => void;
}

// ── Main Component ────────────────────────────────────────────────────────
export default function OrderScannerScreen({ locationId, locationName, onComplete, onCancel }: Props) {
  const router = useRouter();
  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();

  const [step, setStep] = useState<Step>('camera');
  const [capturedUri, setCapturedUri] = useState<string | null>(null);
  const [parsedOrder, setParsedOrder] = useState<ParsedOrder | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // ── Camera capture ──────────────────────────────────────────────────────
  async function handleCapture() {
    if (!cameraRef.current) return;

    try {
      setStep('processing');
      setErrorMessage(null);

      // Take photo
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.8,
        base64: false,
        skipProcessing: false,
      });

      if (!photo) throw new Error('Failed to capture photo');

      setCapturedUri(photo.uri);

      // Resize to reduce payload size — Vision API works well at 1600px max
      const resized = await ImageManipulator.manipulateAsync(
        photo.uri,
        [{ resize: { width: 1600 } }],
        { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG, base64: true }
      );

      if (!resized.base64) throw new Error('Failed to convert image to base64');

      // Send to API — image processed server-side and immediately discarded
      await scanOrder(resized.base64);

    } catch (error: any) {
      console.error('Capture error:', error);
      setErrorMessage(error?.message || 'Failed to capture image');
      setStep('camera');
    }
  }

  // ── API call ────────────────────────────────────────────────────────────
  async function scanOrder(base64Image: string) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('Not authenticated');

    const response = await fetch(`${API_URL}/api/inventory/scan-order`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ base64Image, locationId }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(err.error || `Server error ${response.status}`);
    }

    const result = await response.json();

    // Add received:true to each item for backorder toggle
    const orderWithReceived: ParsedOrder = {
      ...result.parsed,
      items: result.parsed.items.map((item: any) => ({
        ...item,
        received: true,
      })),
    };

    setParsedOrder(orderWithReceived);
    setStep('review');
  }

  // ── Update a line item field ────────────────────────────────────────────
  function updateItem(index: number, field: keyof ParsedLineItem, value: any) {
    if (!parsedOrder) return;
    const updated = [...parsedOrder.items];
    updated[index] = { ...updated[index], [field]: value };
    setParsedOrder({ ...parsedOrder, items: updated });
  }

  function removeItem(index: number) {
    if (!parsedOrder) return;
    const updated = parsedOrder.items.filter((_, i) => i !== index);
    setParsedOrder({ ...parsedOrder, items: updated });
  }

  // ── Confirm and save to DB ──────────────────────────────────────────────
  async function handleConfirm() {
    if (!parsedOrder) return;
    setStep('saving');

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      // 1. Save order record
      const { data: orderRecord, error: orderError } = await supabase
        .from('orders')
        .insert({
          owner_id: session.user.id,
          location_id: locationId,
          order_date: parsedOrder.orderDate || new Date().toISOString().split('T')[0],
          created_by: session.user.id,
          status: 'unpaid',
          subtotal: parsedOrder.financials.subtotal,
          tax: parsedOrder.financials.tax,
          fees: parsedOrder.financials.fees,
          discounts: parsedOrder.financials.discounts,
          total: parsedOrder.financials.total,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (orderError) throw orderError;

      // 2. For each line item: find or create inventory_item, save line item, update location_inventory
      for (const item of parsedOrder.items) {
        // Try to find existing inventory item by name (case-insensitive)
        let inventoryItemId = item.inventoryId;

        if (!inventoryItemId) {
          const { data: existing } = await supabase
            .from('inventory_items')
            .select('id')
            .eq('owner_id', session.user.id)
            .ilike('name', item.name.trim())
            .maybeSingle();

          if (existing) {
            inventoryItemId = existing.id;
          } else {
            // Create new inventory item
            const { data: newItem, error: newItemError } = await supabase
              .from('inventory_items')
              .insert({
                owner_id: session.user.id,
                name: item.name.trim(),
                category: item.category || 'Other',
                size: item.size || null,
                unit: item.unit || null,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              })
              .select()
              .single();

            if (newItemError) throw newItemError;
            inventoryItemId = newItem.id;
          }
        }

        // Save order line item
        await supabase.from('order_line_items').insert({
          order_id: orderRecord.id,
          inventory_item_id: inventoryItemId,
          name: item.name,
          size: item.size,
          quantity: item.quantity,
          unit: item.unit,
          unit_price: item.unitPrice,
          extended_price: item.extendedPrice,
          category: item.category,
          received: item.received,
          created_at: new Date().toISOString(),
        });

        // Update location_inventory only for received items
        if (item.received && item.quantity > 0) {
          const { data: existing } = await supabase
            .from('location_inventory')
            .select('id, quantity')
            .eq('location_id', locationId)
            .eq('inventory_item_id', inventoryItemId)
            .maybeSingle();

          if (existing) {
            await supabase
              .from('location_inventory')
              .update({
                quantity: existing.quantity + item.quantity,
                last_updated_by: session.user.id,
                updated_at: new Date().toISOString(),
              })
              .eq('id', existing.id);
          } else {
            await supabase.from('location_inventory').insert({
              owner_id: session.user.id,
              location_id: locationId,
              inventory_item_id: inventoryItemId,
              quantity: item.quantity,
              last_updated_by: session.user.id,
              updated_at: new Date().toISOString(),
            });
          }
        }
      }

      Alert.alert(
        '✅ Order Saved',
        `${parsedOrder.items.filter(i => i.received).length} items added to inventory at ${locationName}.`,
        [{ text: 'Done', onPress: () => onComplete?.() }]
      );

    } catch (error: any) {
      console.error('Save error:', error);
      setErrorMessage(error?.message || 'Failed to save order');
      setStep('review');
    }
  }

  // ── Permission check ────────────────────────────────────────────────────
  if (!permission) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#2563eb" />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.centered}>
        <Text style={styles.permissionText}>Camera permission is required to scan orders.</Text>
        <TouchableOpacity style={styles.primaryButton} onPress={requestPermission}>
          <Text style={styles.primaryButtonText}>Grant Permission</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.secondaryButton} onPress={onCancel}>
          <Text style={styles.secondaryButtonText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Camera view ─────────────────────────────────────────────────────────
  if (step === 'camera') {
    return (
      <View style={styles.cameraContainer}>
        <CameraView ref={cameraRef} style={styles.camera} facing="back">
          {/* Overlay guide */}
          <View style={styles.cameraOverlay}>
            <View style={styles.cameraHeader}>
              <TouchableOpacity onPress={onCancel} style={styles.cancelButton}>
                <Text style={styles.cancelButtonText}>✕ Cancel</Text>
              </TouchableOpacity>
              <Text style={styles.cameraTitle}>Scan Order / Packing Slip</Text>
              <Text style={styles.locationLabel}>📍 {locationName}</Text>
            </View>

            {/* Guide frame */}
            <View style={styles.guideFrame}>
              <View style={[styles.corner, styles.topLeft]} />
              <View style={[styles.corner, styles.topRight]} />
              <View style={[styles.corner, styles.bottomLeft]} />
              <View style={[styles.corner, styles.bottomRight]} />
            </View>

            <View style={styles.cameraFooter}>
              <Text style={styles.cameraHint}>
                Position the document within the frame
              </Text>
              <TouchableOpacity style={styles.captureButton} onPress={handleCapture}>
                <View style={styles.captureButtonInner} />
              </TouchableOpacity>
            </View>
          </View>
        </CameraView>

        {errorMessage && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>⚠️ {errorMessage}</Text>
          </View>
        )}
      </View>
    );
  }

  // ── Processing ──────────────────────────────────────────────────────────
  if (step === 'processing') {
    return (
      <View style={styles.centered}>
        {capturedUri && (
          <Image source={{ uri: capturedUri }} style={styles.previewThumb} />
        )}
        <ActivityIndicator size="large" color="#2563eb" style={{ marginTop: 24 }} />
        <Text style={styles.processingTitle}>Reading document...</Text>
        <Text style={styles.processingSubtitle}>Extracting text and parsing line items</Text>
      </View>
    );
  }

  // ── Saving ──────────────────────────────────────────────────────────────
  if (step === 'saving') {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#16a34a" />
        <Text style={styles.processingTitle}>Saving to inventory...</Text>
        <Text style={styles.processingSubtitle}>Updating stock levels at {locationName}</Text>
      </View>
    );
  }

  // ── Review screen ───────────────────────────────────────────────────────
  if (step === 'review' && parsedOrder) {
    const receivedCount = parsedOrder.items.filter(i => i.received).length;

    return (
      <View style={styles.reviewContainer}>
        {/* Header */}
        <View style={styles.reviewHeader}>
          <Text style={styles.reviewTitle}>Review Order</Text>
          <Text style={styles.reviewSubtitle}>
            {parsedOrder.items.length} items · {locationName}
          </Text>
          {parsedOrder.supplier && (
            <Text style={styles.reviewSupplier}>📦 {parsedOrder.supplier}</Text>
          )}
        </View>

        {errorMessage && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>⚠️ {errorMessage}</Text>
          </View>
        )}

        <ScrollView style={styles.reviewScroll} contentContainerStyle={{ paddingBottom: 120 }}>
          {/* Line Items */}
          {parsedOrder.items.map((item, index) => (
            <View key={index} style={[styles.lineItem, !item.received && styles.lineItemBackorder]}>
              {/* Received toggle */}
              <TouchableOpacity
                style={styles.receivedToggle}
                onPress={() => updateItem(index, 'received', !item.received)}
              >
                <View style={[styles.checkbox, item.received && styles.checkboxChecked]}>
                  {item.received && <Text style={styles.checkmark}>✓</Text>}
                </View>
              </TouchableOpacity>

              <View style={styles.lineItemContent}>
                {/* Name */}
                <TextInput
                  style={styles.lineItemName}
                  value={item.name}
                  onChangeText={v => updateItem(index, 'name', v)}
                  placeholder="Item name"
                />

                {/* Size + Category row */}
                <View style={styles.lineItemRow}>
                  <TextInput
                    style={[styles.lineItemInput, { flex: 1 }]}
                    value={item.size || ''}
                    onChangeText={v => updateItem(index, 'size', v || null)}
                    placeholder="Size"
                  />
                  <View style={[styles.categoryPill]}>
                    <Text style={styles.categoryText}>{item.category}</Text>
                  </View>
                </View>

                {/* Qty + Unit + Price row */}
                <View style={styles.lineItemRow}>
                  <TextInput
                    style={[styles.lineItemInput, { width: 60 }]}
                    value={String(item.quantity)}
                    onChangeText={v => updateItem(index, 'quantity', parseFloat(v) || 0)}
                    keyboardType="numeric"
                    placeholder="Qty"
                  />
                  <TextInput
                    style={[styles.lineItemInput, { width: 50 }]}
                    value={item.unit}
                    onChangeText={v => updateItem(index, 'unit', v)}
                    placeholder="Unit"
                  />
                  <TextInput
                    style={[styles.lineItemInput, { flex: 1 }]}
                    value={item.unitPrice != null ? String(item.unitPrice) : ''}
                    onChangeText={v => updateItem(index, 'unitPrice', parseFloat(v) || null)}
                    keyboardType="numeric"
                    placeholder="Unit price"
                  />
                  <TextInput
                    style={[styles.lineItemInput, { flex: 1 }]}
                    value={item.extendedPrice != null ? String(item.extendedPrice) : ''}
                    onChangeText={v => updateItem(index, 'extendedPrice', parseFloat(v) || null)}
                    keyboardType="numeric"
                    placeholder="Total"
                  />
                </View>

                {!item.received && (
                  <Text style={styles.backorderLabel}>⚠️ Backordered — not added to inventory</Text>
                )}
              </View>

              {/* Remove button */}
              <TouchableOpacity onPress={() => removeItem(index)} style={styles.removeButton}>
                <Text style={styles.removeButtonText}>✕</Text>
              </TouchableOpacity>
            </View>
          ))}

          {/* Financials summary */}
          <View style={styles.financials}>
            <Text style={styles.financialsTitle}>Financial Summary</Text>
            {[
              ['Subtotal', parsedOrder.financials.subtotal],
              ['Tax', parsedOrder.financials.tax],
              ['Fees', parsedOrder.financials.fees],
              ['Discounts', parsedOrder.financials.discounts],
              ['Total', parsedOrder.financials.total],
            ].map(([label, value]) => value != null && (
              <View key={label as string} style={styles.financialRow}>
                <Text style={[styles.financialLabel, label === 'Total' && styles.financialTotal]}>
                  {label}
                </Text>
                <Text style={[styles.financialValue, label === 'Total' && styles.financialTotal]}>
                  ${(value as number).toFixed(2)}
                </Text>
              </View>
            ))}
          </View>

          {/* Rescan option */}
          <TouchableOpacity
            style={styles.rescanButton}
            onPress={() => { setParsedOrder(null); setStep('camera'); }}
          >
            <Text style={styles.rescanButtonText}>📷 Rescan</Text>
          </TouchableOpacity>
        </ScrollView>

        {/* Fixed bottom bar */}
        <View style={styles.bottomBar}>
          <TouchableOpacity style={styles.cancelBottomButton} onPress={onCancel}>
            <Text style={styles.cancelBottomText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.confirmButton} onPress={handleConfirm}>
            <Text style={styles.confirmButtonText}>
              ✓ Add {receivedCount} Item{receivedCount !== 1 ? 's' : ''} to Inventory
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return null;
}

// ── Styles ─────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  centered: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#fff', padding: 24,
  },
  permissionText: { fontSize: 16, color: '#374151', textAlign: 'center', marginBottom: 24 },

  // Camera
  cameraContainer: { flex: 1, backgroundColor: '#000' },
  camera: { flex: 1 },
  cameraOverlay: { flex: 1, justifyContent: 'space-between' },
  cameraHeader: {
    paddingTop: 56, paddingHorizontal: 20, paddingBottom: 16,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  cancelButton: { alignSelf: 'flex-start', marginBottom: 8 },
  cancelButtonText: { color: '#fff', fontSize: 16 },
  cameraTitle: { color: '#fff', fontSize: 20, fontWeight: '700', textAlign: 'center' },
  locationLabel: { color: '#93c5fd', fontSize: 13, textAlign: 'center', marginTop: 4 },
  guideFrame: {
    flex: 1, margin: 32,
    borderRadius: 8,
  },
  corner: {
    position: 'absolute', width: 28, height: 28,
    borderColor: '#fff', borderWidth: 3,
  },
  topLeft: { top: 0, left: 0, borderRightWidth: 0, borderBottomWidth: 0, borderTopLeftRadius: 6 },
  topRight: { top: 0, right: 0, borderLeftWidth: 0, borderBottomWidth: 0, borderTopRightRadius: 6 },
  bottomLeft: { bottom: 0, left: 0, borderRightWidth: 0, borderTopWidth: 0, borderBottomLeftRadius: 6 },
  bottomRight: { bottom: 0, right: 0, borderLeftWidth: 0, borderTopWidth: 0, borderBottomRightRadius: 6 },
  cameraFooter: {
    paddingBottom: 48, paddingHorizontal: 20,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
  },
  cameraHint: { color: '#d1d5db', fontSize: 13, marginBottom: 20 },
  captureButton: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: 'rgba(255,255,255,0.3)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 3, borderColor: '#fff',
  },
  captureButtonInner: {
    width: 56, height: 56, borderRadius: 28, backgroundColor: '#fff',
  },

  // Processing
  previewThumb: {
    width: 160, height: 200, borderRadius: 8,
    borderWidth: 1, borderColor: '#e5e7eb',
  },
  processingTitle: {
    fontSize: 18, fontWeight: '600', color: '#111827', marginTop: 16,
  },
  processingSubtitle: { fontSize: 14, color: '#6b7280', marginTop: 6 },

  // Review
  reviewContainer: { flex: 1, backgroundColor: '#f9fafb' },
  reviewHeader: {
    backgroundColor: '#fff', paddingTop: 56, paddingHorizontal: 20,
    paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: '#e5e7eb',
  },
  reviewTitle: { fontSize: 22, fontWeight: '700', color: '#111827' },
  reviewSubtitle: { fontSize: 14, color: '#6b7280', marginTop: 2 },
  reviewSupplier: { fontSize: 14, color: '#2563eb', marginTop: 4 },
  reviewScroll: { flex: 1, padding: 16 },

  // Line items
  lineItem: {
    flexDirection: 'row', backgroundColor: '#fff', borderRadius: 10,
    padding: 12, marginBottom: 10,
    borderWidth: 1, borderColor: '#e5e7eb',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 2, elevation: 1,
  },
  lineItemBackorder: { backgroundColor: '#fffbeb', borderColor: '#fde68a' },
  receivedToggle: { marginRight: 10, paddingTop: 2 },
  checkbox: {
    width: 22, height: 22, borderRadius: 4,
    borderWidth: 2, borderColor: '#d1d5db',
    alignItems: 'center', justifyContent: 'center',
  },
  checkboxChecked: { backgroundColor: '#16a34a', borderColor: '#16a34a' },
  checkmark: { color: '#fff', fontSize: 13, fontWeight: '700' },
  lineItemContent: { flex: 1 },
  lineItemName: {
    fontSize: 15, fontWeight: '600', color: '#111827',
    borderBottomWidth: 1, borderBottomColor: '#f3f4f6',
    paddingBottom: 4, marginBottom: 6,
  },
  lineItemRow: { flexDirection: 'row', gap: 6, marginBottom: 6, alignItems: 'center' },
  lineItemInput: {
    fontSize: 13, color: '#374151',
    borderWidth: 1, borderColor: '#e5e7eb',
    borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4,
    backgroundColor: '#f9fafb',
  },
  categoryPill: {
    paddingHorizontal: 8, paddingVertical: 3,
    backgroundColor: '#dbeafe', borderRadius: 12,
  },
  categoryText: { fontSize: 11, color: '#1d4ed8', fontWeight: '600' },
  backorderLabel: { fontSize: 11, color: '#d97706', marginTop: 2 },
  removeButton: { padding: 6, marginLeft: 4 },
  removeButtonText: { color: '#9ca3af', fontSize: 16 },

  // Financials
  financials: {
    backgroundColor: '#fff', borderRadius: 10, padding: 16,
    marginTop: 8, marginBottom: 8,
    borderWidth: 1, borderColor: '#e5e7eb',
  },
  financialsTitle: { fontSize: 14, fontWeight: '600', color: '#374151', marginBottom: 10 },
  financialRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingVertical: 4,
  },
  financialLabel: { fontSize: 14, color: '#6b7280' },
  financialValue: { fontSize: 14, color: '#111827', fontWeight: '500' },
  financialTotal: { fontWeight: '700', fontSize: 16, color: '#111827' },

  rescanButton: {
    alignItems: 'center', padding: 12, marginBottom: 8,
  },
  rescanButtonText: { color: '#6b7280', fontSize: 14 },

  // Bottom bar
  bottomBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', gap: 12, padding: 16,
    paddingBottom: 32,
    backgroundColor: '#fff',
    borderTopWidth: 1, borderTopColor: '#e5e7eb',
  },
  cancelBottomButton: {
    flex: 1, paddingVertical: 14, borderRadius: 10,
    backgroundColor: '#f3f4f6', alignItems: 'center',
  },
  cancelBottomText: { color: '#374151', fontWeight: '600', fontSize: 15 },
  confirmButton: {
    flex: 2, paddingVertical: 14, borderRadius: 10,
    backgroundColor: '#16a34a', alignItems: 'center',
  },
  confirmButtonText: { color: '#fff', fontWeight: '700', fontSize: 15 },

  // Error
  errorBanner: {
    backgroundColor: '#fef2f2', borderColor: '#fecaca',
    borderWidth: 1, margin: 12, borderRadius: 8, padding: 10,
  },
  errorText: { color: '#dc2626', fontSize: 13 },

  // Buttons
  primaryButton: {
    paddingHorizontal: 24, paddingVertical: 12,
    backgroundColor: '#2563eb', borderRadius: 8, marginTop: 16,
  },
  primaryButtonText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  secondaryButton: { marginTop: 12, padding: 10 },
  secondaryButtonText: { color: '#6b7280', fontSize: 14 },
});