import React, { useState, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  TextInput, Alert, ActivityIndicator, Image,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../../lib/supabase';
import * as FileSystem from 'expo-file-system';
import { useRouter } from 'expo-router';


const API_URL = (process.env.EXPO_PUBLIC_API_URL || '').replace(/\/+$/, '');

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
}

interface ParsedOrder {
  supplier: string | null;
  supplierAddress: string | null;
  supplierPhone: string | null;
  supplierEmail: string | null;
  repName: string | null;
  invoiceNumber: string | null;
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

type Step = 'camera' | 'processing' | 'supplier' | 'review' | 'saving';

interface Supplier {
  id: string;
  name: string;
}

interface SupplierMatch {
  type: 'exact' | 'partial' | 'none';
  matched: Supplier | null;
  allSuppliers: Supplier[];
}

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
  const [isCameraReady, setIsCameraReady] = useState(false);

  // ── Supplier state ──────────────────────────────────────────────────────
  const [supplierMatch, setSupplierMatch] = useState<SupplierMatch | null>(null);
  const [selectedSupplierId, setSelectedSupplierId] = useState<string | null>(null);
  const [supplierPickerOpen, setSupplierPickerOpen] = useState(false);
  const [newSupplierName, setNewSupplierName] = useState('');
  const [creatingSupplier, setCreatingSupplier] = useState(false);

  // ── Supplier matching ───────────────────────────────────────────────────
  function similarity(a: string, b: string): number {
    const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
    const ca = clean(a);
    const cb = clean(b);
    if (!ca || !cb) return 0;
    if (ca === cb) return 1;
    if (ca.includes(cb) || cb.includes(ca)) return 0.85;
    const wordsA = ca.split(/\s+/);
    const wordsB = cb.split(/\s+/);
    const shared = wordsA.filter(w => wordsB.some(wb => wb.startsWith(w) || w.startsWith(wb)));
    return shared.length / Math.max(wordsA.length, wordsB.length);
  }

  async function fetchAndMatchSupplier(detectedName: string | null): Promise<SupplierMatch> {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return { type: 'none', matched: null, allSuppliers: [] };

    const { data, error } = await supabase
      .from('suppliers')
      .select('id, name')
      .eq('owner_id', session.user.id)
      .order('name');

    if (error || !data) return { type: 'none', matched: null, allSuppliers: [] };

    const allSuppliers: Supplier[] = data;

    if (!detectedName || detectedName.trim() === '') {
      return { type: 'none', matched: null, allSuppliers };
    }

    let bestMatch: Supplier | null = null;
    let bestScore = 0;

    for (const s of allSuppliers) {
      const score = similarity(detectedName, s.name);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = s;
      }
    }

    if (bestScore >= 0.85) {
      return { type: 'exact', matched: bestMatch, allSuppliers };
    } else if (bestScore >= 0.4) {
      return { type: 'partial', matched: bestMatch, allSuppliers };
    } else {
      return { type: 'none', matched: null, allSuppliers };
    }
  }

  // ── Create supplier — defined at component level so handleConfirm
  //    always reads the live selectedSupplierId state value ──────────────
  async function handleCreateSupplier() {
    if (!newSupplierName.trim()) return;
    setCreatingSupplier(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const { data: created, error } = await supabase
        .from('suppliers')
        .insert({
          owner_id: session.user.id,
          name: newSupplierName.trim(),
          contact_name: parsedOrder?.repName || null,
          phone: parsedOrder?.supplierPhone || null,
          email: parsedOrder?.supplierEmail || null,
          notes: parsedOrder?.supplierAddress || null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .select('id, name')
        .single();

      if (error) throw error;

      setSelectedSupplierId(created.id);
      setSupplierPickerOpen(false);
      setStep('review');
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to create supplier');
    } finally {
      setCreatingSupplier(false);
    }
  }

  // ── Camera capture ──────────────────────────────────────────────────────
  async function handleCapture() {
    if (!cameraRef.current || !isCameraReady) {
      console.error('[Camera] not ready — ref:', !!cameraRef.current, 'isCameraReady:', isCameraReady);
      setErrorMessage('Camera not ready. Please wait a moment and try again.');
      return;
    }

    try {
      setStep('processing');
      setErrorMessage(null);

      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.8,
        base64: false,
        skipProcessing: false,
      });

      console.log('[Camera] takePictureAsync result:', photo?.uri);
      if (!photo?.uri) throw new Error('Failed to capture photo');

      setCapturedUri(photo.uri);

      const base64 = await imageToBase64(photo.uri);
      await scanOrder(base64);

    } catch (error: any) {
      console.error('Capture error:', JSON.stringify(error), error?.message, error?.code);
      setErrorMessage(error?.message || error?.code || 'Failed to capture image');
      setStep('camera');
    }
  }

  // ── Image picker (upload from device) ──────────────────────────────────
  async function handlePickImage() {
    try {
      const permResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
      console.log('[Picker] permission status:', permResult.status, 'granted:', permResult.granted);

      if (!permResult.granted) {
        Alert.alert(
          'Permission Required',
          'Please allow access to your photo library. You may need to enable it in Android Settings > Apps > Batch Maker > Permissions.'
        );
        return;
      }

      console.log('[Picker] launching library...');
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: 'images',
        allowsEditing: false,
        quality: 1,
        base64: false,
      });

      console.log('[Picker] result canceled:', result.canceled, 'assets:', result.assets?.length);

      if (result.canceled || !result.assets?.[0]) return;

      const picked = result.assets[0];
      console.log('[Picker] picked uri:', picked.uri, 'type:', picked.type, 'fileSize:', picked.fileSize);

      if (!picked.uri) throw new Error('No URI returned from image picker');

      setStep('processing');
      setErrorMessage(null);
      setCapturedUri(picked.uri);

      const base64 = await imageToBase64(picked.uri);
      await scanOrder(base64);

    } catch (error: any) {
      const msg = error?.message || error?.code || JSON.stringify(error) || 'Failed to load image';
      console.error('[Picker] error full:', JSON.stringify(error), msg);
      setErrorMessage(msg);
      setStep('camera');
    }
  }

  // ── Image → base64 helper ───────────────────────────────────────────────
  async function imageToBase64(uri: string): Promise<string> {
    console.log('[imageToBase64] uri:', uri);
    try {
      const resized = await ImageManipulator.manipulateAsync(
        uri,
        [{ resize: { width: 1600 } }],
        { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG, base64: true }
      );
      if (!resized.base64) throw new Error('Manipulator returned no base64');
      console.log('[imageToBase64] manipulator OK, length:', resized.base64.length);
      return resized.base64;
    } catch (manipErr: any) {
      console.warn('[imageToBase64] manipulator failed, falling back to FileSystem:', manipErr?.message || JSON.stringify(manipErr));
      const raw = await FileSystem.readAsStringAsync(uri, {
        encoding: 'base64' as any,
      });
      if (!raw) throw new Error('FileSystem returned empty base64');
      console.log('[imageToBase64] FileSystem fallback OK, length:', raw.length);
      return raw;
    }
  }

  // ── API call ────────────────────────────────────────────────────────────
  async function scanOrder(base64Image: string) {
    console.log('[scanOrder] starting, API_URL:', API_URL, 'base64 length:', base64Image.length);

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('Not authenticated');

    console.log('[scanOrder] session OK, posting to:', `${API_URL}/api/inventory/scan-order`);

    let response: Response;
    try {
      response = await fetch(`${API_URL}/api/inventory/scan-order`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ base64Image, locationId }),
      });
    } catch (fetchErr: any) {
      console.error('[scanOrder] fetch threw:', JSON.stringify(fetchErr), fetchErr?.message);
      throw new Error(fetchErr?.message || 'Network request failed — check API_URL and connectivity');
    }

    console.log('[scanOrder] response status:', response.status);

    if (!response.ok) {
      const errText = await response.text().catch(() => 'no body');
      console.error('[scanOrder] error response:', errText);
      throw new Error(`Server error ${response.status}: ${errText}`);
    }

    const result = await response.json();
    console.log('[scanOrder] parsed result keys:', Object.keys(result));

    if (!result.parsed) throw new Error('API response missing parsed field');

    const orderWithReceived: ParsedOrder = {
      ...result.parsed,
      items: result.parsed.items.map((item: any) => ({ ...item })),
    };

    setParsedOrder(orderWithReceived);

    const match = await fetchAndMatchSupplier(result.parsed.supplier);
    setSupplierMatch(match);
    setNewSupplierName(result.parsed.supplier || '');

    if (match.type === 'exact' && match.matched) {
      setSelectedSupplierId(match.matched.id);
    } else {
      setSelectedSupplierId(null);
    }

    setStep('supplier');
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

      const { data: orderRecord, error: orderError } = await supabase
        .from('orders')
        .insert({
          owner_id: session.user.id,
          location_id: locationId,
          supplier_id: selectedSupplierId || null,
          order_number: parsedOrder.invoiceNumber || null,
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

      // Track potential duplicates to warn about after saving
      const potentialDuplicates: { scanned: string; existing: string }[] = [];

      // Fetch all existing inventory items once for duplicate checking
      const { data: allExistingItems } = await supabase
        .from('inventory_items')
        .select('id, name, ingredient')
        .eq('owner_id', session.user.id)
        .eq('location_id', locationId);

      for (const item of parsedOrder.items) {
        let inventoryItemId = item.inventoryId;

        if (!inventoryItemId) {
          // Pass 1 — exact name match
          const exactMatch = (allExistingItems || []).find(
            (e: any) => e.name.toLowerCase().trim() === item.name.toLowerCase().trim()
          );

          if (exactMatch) {
            inventoryItemId = exactMatch.id;
          } else {
            // Pass 2 — exact ingredient match
            const ingredientMatch = (allExistingItems || []).find(
              (e: any) => e.ingredient &&
                e.ingredient.toLowerCase().trim() === item.name.toLowerCase().trim()
            );

            if (ingredientMatch) {
              inventoryItemId = ingredientMatch.id;
            } else {
              // Pass 3 — fuzzy match: check if existing ingredient/name contains
              // the scanned name or vice versa, with a minimum length guard to
              // avoid false positives on short words
              const scannedClean = item.name.toLowerCase().trim();
              const fuzzyMatch = scannedClean.length >= 4
                ? (allExistingItems || []).find((e: any) => {
                    const existingIngredient = (e.ingredient ?? '').toLowerCase().trim();
                    const existingName = (e.name ?? '').toLowerCase().trim();
                    return (
                      (existingIngredient.length >= 4 && (
                        existingIngredient.includes(scannedClean) ||
                        scannedClean.includes(existingIngredient)
                      )) ||
                      (existingName.length >= 4 && (
                        existingName.includes(scannedClean) ||
                        scannedClean.includes(existingName)
                      ))
                    );
                  })
                : null;

              if (fuzzyMatch) {
                // Fuzzy match found — flag as potential duplicate but still
                // create a new item. Owner can merge on the website.
                potentialDuplicates.push({
                  scanned: item.name,
                  existing: fuzzyMatch.ingredient ?? fuzzyMatch.name,
                });
              }

              // Create new inventory item regardless of fuzzy match
              const { data: newItem, error: newItemError } = await supabase
                .from('inventory_items')
                .insert({
                  owner_id: session.user.id,
                  name: item.name.trim(),
                  category: item.category || 'Other',
                  size: item.size || null,
                  unit: item.unit || null,
                  location_id: locationId,
                  supplier_id: selectedSupplierId || null,
                  created_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                })
                .select()
                .single();

              if (newItemError) throw newItemError;
              inventoryItemId = newItem.id;
            }
          }
        }

        await supabase.from('order_line_items').insert({
          order_id: orderRecord.id,
          inventory_item_id: inventoryItemId,
          name: item.name,
          size: item.size,
          quantity: item.quantity,
          quantity_received: item.quantity,
          unit: item.unit,
          unit_price: item.unitPrice,
          extended_price: item.extendedPrice,
          category: item.category,
          created_at: new Date().toISOString(),
        });

        if (item.quantity > 0) {
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

      // Build success message — include duplicate warnings if any were found
      let message = `${parsedOrder.items.length} items added to inventory at ${locationName}.`;
      if (potentialDuplicates.length > 0) {
        message += `\n\nPossible duplicates detected (${potentialDuplicates.length}):\n`;
        message += potentialDuplicates
          .map(d => `• "${d.scanned}" may duplicate "${d.existing}"`)
          .join('\n');
        message += '\n\nYou can merge duplicates from the Inventory tab on the website.';
      }

      Alert.alert(
        potentialDuplicates.length > 0 ? 'Order Saved — Review Duplicates' : 'Order Saved',
        message,
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
        <CameraView
          ref={cameraRef}
          style={styles.camera}
          facing="back"
          onCameraReady={() => {
            console.log('[Camera] onCameraReady fired, ref:', !!cameraRef.current);
            setIsCameraReady(true);
          }}
        />

        <View style={styles.cameraOverlay}>
          <View style={styles.cameraHeader}>
            <TouchableOpacity onPress={onCancel} style={styles.cancelButton}>
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>
            <Text style={styles.cameraTitle}>Scan Order / Packing Slip</Text>
            <Text style={styles.locationLabel}>{locationName}</Text>
          </View>

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
            <View style={styles.cameraFooterButtons}>
              <TouchableOpacity
                style={[styles.captureButton, !isCameraReady && { opacity: 0.4 }]}
                onPress={handleCapture}
                disabled={!isCameraReady}
              >
                <View style={styles.captureButtonInner} />
              </TouchableOpacity>

              <TouchableOpacity style={styles.uploadButton} onPress={handlePickImage}>
                <Text style={styles.uploadButtonIcon}>Upload</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {errorMessage && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{errorMessage}</Text>
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

  // ── Supplier step ───────────────────────────────────────────────────────
  if (step === 'supplier' && parsedOrder && supplierMatch) {
    const detectedName = parsedOrder.supplier;

    return (
      <View style={styles.supplierContainer}>
        <View style={styles.supplierHeader}>
          <Text style={styles.supplierTitle}>Supplier Detected</Text>
          <Text style={styles.supplierSubtitle}>
            {detectedName
              ? `We found "${detectedName}" on this order.`
              : 'No supplier name was detected on this order.'}
          </Text>
          {parsedOrder.invoiceNumber && (
            <Text style={styles.supplierInvoiceMeta}>Invoice #{parsedOrder.invoiceNumber}</Text>
          )}
          {parsedOrder.repName && (
            <Text style={styles.supplierInvoiceMeta}>Rep: {parsedOrder.repName}</Text>
          )}
        </View>

        {errorMessage && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{errorMessage}</Text>
          </View>
        )}

        <ScrollView style={{ flex: 1, padding: 16 }} contentContainerStyle={{ paddingBottom: 120 }}>

          {(supplierMatch.type === 'exact' || supplierMatch.type === 'partial') && supplierMatch.matched && (
            <View style={styles.supplierCard}>
              <Text style={styles.supplierCardLabel}>
                {supplierMatch.type === 'exact' ? 'Matched Supplier' : 'Possible Match'}
              </Text>
              <TouchableOpacity
                style={[
                  styles.supplierOption,
                  selectedSupplierId === supplierMatch.matched.id && styles.supplierOptionSelected,
                ]}
                onPress={() => {
                  setSelectedSupplierId(supplierMatch.matched!.id);
                  setSupplierPickerOpen(false);
                }}
              >
                <View style={styles.supplierOptionInner}>
                  <Text style={styles.supplierOptionName}>{supplierMatch.matched.name}</Text>
                  {supplierMatch.type === 'partial' && (
                    <Text style={styles.supplierOptionHint}>Partial match — confirm if correct</Text>
                  )}
                </View>
                {selectedSupplierId === supplierMatch.matched.id && (
                  <Text style={styles.supplierCheckmark}>✓</Text>
                )}
              </TouchableOpacity>
            </View>
          )}

          {supplierMatch.type === 'none' && detectedName && (
            <View style={styles.supplierCard}>
              <Text style={styles.supplierCardLabel}>New Supplier</Text>
              <Text style={styles.supplierNewHint}>
                This supplier is not in your list yet. Save them now?
              </Text>
              {(parsedOrder.supplierPhone || parsedOrder.supplierEmail || parsedOrder.supplierAddress || parsedOrder.repName) && (
                <View style={styles.supplierParsedInfo}>
                  {parsedOrder.repName && (
                    <Text style={styles.supplierParsedInfoText}>Rep: {parsedOrder.repName}</Text>
                  )}
                  {parsedOrder.supplierPhone && (
                    <Text style={styles.supplierParsedInfoText}>Phone: {parsedOrder.supplierPhone}</Text>
                  )}
                  {parsedOrder.supplierEmail && (
                    <Text style={styles.supplierParsedInfoText}>Email: {parsedOrder.supplierEmail}</Text>
                  )}
                  {parsedOrder.supplierAddress && (
                    <Text style={styles.supplierParsedInfoText}>Address: {parsedOrder.supplierAddress}</Text>
                  )}
                </View>
              )}
              <TextInput
                style={styles.supplierInput}
                value={newSupplierName}
                onChangeText={setNewSupplierName}
                placeholder="Supplier name"
              />
              <TouchableOpacity
                style={[styles.supplierCreateButton, creatingSupplier && { opacity: 0.5 }]}
                onPress={handleCreateSupplier}
                disabled={creatingSupplier}
              >
                <Text style={styles.supplierCreateButtonText}>
                  {creatingSupplier ? 'Saving...' : 'Save as New Supplier'}
                </Text>
              </TouchableOpacity>
            </View>
          )}

          <View style={styles.supplierCard}>
            <TouchableOpacity
              style={styles.supplierPickerToggle}
              onPress={() => setSupplierPickerOpen(v => !v)}
            >
              <Text style={styles.supplierCardLabel}>
                {supplierPickerOpen ? 'Hide Supplier List' : 'Choose from Existing Suppliers'}
              </Text>
              <Text style={styles.supplierPickerArrow}>{supplierPickerOpen ? '▲' : '▼'}</Text>
            </TouchableOpacity>

            {supplierPickerOpen && (
              <>
                {supplierMatch.allSuppliers.length === 0 ? (
                  <Text style={styles.supplierOptionHint}>No suppliers saved yet.</Text>
                ) : (
                  supplierMatch.allSuppliers.map(s => (
                    <TouchableOpacity
                      key={s.id}
                      style={[
                        styles.supplierOption,
                        selectedSupplierId === s.id && styles.supplierOptionSelected,
                      ]}
                      onPress={() => {
                        setSelectedSupplierId(s.id);
                        setSupplierPickerOpen(false);
                      }}
                    >
                      <Text style={styles.supplierOptionName}>{s.name}</Text>
                      {selectedSupplierId === s.id && (
                        <Text style={styles.supplierCheckmark}>✓</Text>
                      )}
                    </TouchableOpacity>
                  ))
                )}

                <View style={{ marginTop: 12 }}>
                  <Text style={styles.supplierCardLabel}>Or create a new one</Text>
                  <TextInput
                    style={styles.supplierInput}
                    value={newSupplierName}
                    onChangeText={setNewSupplierName}
                    placeholder="Supplier name"
                  />
                  <TouchableOpacity
                    style={[styles.supplierCreateButton, creatingSupplier && { opacity: 0.5 }]}
                    onPress={handleCreateSupplier}
                    disabled={creatingSupplier}
                  >
                    <Text style={styles.supplierCreateButtonText}>
                      {creatingSupplier ? 'Saving...' : 'Save as New Supplier'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>

        </ScrollView>

        <View style={styles.bottomBar}>
          <TouchableOpacity
            style={styles.cancelBottomButton}
            onPress={() => { setSelectedSupplierId(null); setStep('review'); }}
          >
            <Text style={styles.cancelBottomText}>Skip</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.confirmButton}
            onPress={() => setStep('review')}
          >
            <Text style={styles.confirmButtonText}>
              {selectedSupplierId ? 'Confirm Supplier' : 'Continue Without Supplier'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── Review screen ───────────────────────────────────────────────────────
  if (step === 'review' && parsedOrder) {
    const receivedCount = parsedOrder.items.length;

    return (
      <View style={styles.reviewContainer}>
        <View style={styles.reviewHeader}>
          <Text style={styles.reviewTitle}>Review Order</Text>
          <Text style={styles.reviewSubtitle}>
            {parsedOrder.items.length} items · {locationName}
          </Text>
          {parsedOrder.supplier && (
            <Text style={styles.reviewSupplier}>{parsedOrder.supplier}</Text>
          )}
          {parsedOrder.invoiceNumber && (
            <Text style={styles.reviewMeta}>Invoice #{parsedOrder.invoiceNumber}</Text>
          )}
          {parsedOrder.repName && (
            <Text style={styles.reviewMeta}>Rep: {parsedOrder.repName}</Text>
          )}
        </View>

        {errorMessage && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{errorMessage}</Text>
          </View>
        )}

        <ScrollView style={styles.reviewScroll} contentContainerStyle={{ paddingBottom: 120 }}>
          {parsedOrder.items.map((item, index) => (
            <View key={index} style={styles.lineItem}>
              <View style={{ width: 22, marginRight: 10 }} />

              <View style={styles.lineItemContent}>
                <TextInput
                  style={styles.lineItemName}
                  value={item.name}
                  onChangeText={v => updateItem(index, 'name', v)}
                  placeholder="Item name"
                />

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
              </View>

              <TouchableOpacity onPress={() => removeItem(index)} style={styles.removeButton}>
                <Text style={styles.removeButtonText}>✕</Text>
              </TouchableOpacity>
            </View>
          ))}

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

          <TouchableOpacity
            style={styles.rescanButton}
            onPress={() => { setParsedOrder(null); setStep('camera'); }}
          >
            <Text style={styles.rescanButtonText}>Rescan</Text>
          </TouchableOpacity>
        </ScrollView>

        <View style={styles.bottomBar}>
          <TouchableOpacity style={styles.cancelBottomButton} onPress={onCancel}>
            <Text style={styles.cancelBottomText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.confirmButton} onPress={handleConfirm}>
            <Text style={styles.confirmButtonText}>
              Save {receivedCount} Item{receivedCount !== 1 ? 's' : ''} to Inventory
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
  camera: { ...StyleSheet.absoluteFillObject },
  cameraOverlay: {
    flex: 1, justifyContent: 'space-between',
  },
  cameraHeader: {
    paddingTop: 56, paddingHorizontal: 20, paddingBottom: 16,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  cancelButton: { alignSelf: 'flex-start', marginBottom: 8 },
  cancelButtonText: { color: '#fff', fontSize: 16 },
  cameraTitle: { color: '#fff', fontSize: 20, fontWeight: '700', textAlign: 'center' },
  locationLabel: { color: '#93c5fd', fontSize: 13, textAlign: 'center', marginTop: 4 },
  guideFrame: { flex: 1, margin: 32, borderRadius: 8 },
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
  cameraFooterButtons: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    height: 72,
  },
  captureButton: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: 'rgba(255,255,255,0.3)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 3, borderColor: '#fff',
  },
  captureButtonInner: {
    width: 56, height: 56, borderRadius: 28, backgroundColor: '#fff',
  },
  uploadButton: {
    position: 'absolute',
    right: 0,
    top: 0,
    width: 72, height: 52, borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.6)',
    alignItems: 'center', justifyContent: 'center',
  },
  uploadButtonIcon: {
    color: '#fff', fontSize: 13, fontWeight: '600',
  },

  // Processing
  previewThumb: {
    width: 160, height: 200, borderRadius: 8,
    borderWidth: 1, borderColor: '#e5e7eb',
  },
  processingTitle: { fontSize: 18, fontWeight: '600', color: '#111827', marginTop: 16 },
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
  reviewMeta: { fontSize: 12, color: '#6b7280', marginTop: 2 },
  reviewScroll: { flex: 1, padding: 16 },

  // Line items
  lineItem: {
    flexDirection: 'row', backgroundColor: '#fff', borderRadius: 10,
    padding: 12, marginBottom: 10,
    borderWidth: 1, borderColor: '#e5e7eb',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 2, elevation: 1,
  },
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
  removeButton: { padding: 6, marginLeft: 4 },
  removeButtonText: { color: '#9ca3af', fontSize: 16 },

  // Financials
  financials: {
    backgroundColor: '#fff', borderRadius: 10, padding: 16,
    marginTop: 8, marginBottom: 8,
    borderWidth: 1, borderColor: '#e5e7eb',
  },
  financialsTitle: { fontSize: 14, fontWeight: '600', color: '#374151', marginBottom: 10 },
  financialRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  financialLabel: { fontSize: 14, color: '#6b7280' },
  financialValue: { fontSize: 14, color: '#111827', fontWeight: '500' },
  financialTotal: { fontWeight: '700', fontSize: 16, color: '#111827' },

  rescanButton: { alignItems: 'center', padding: 12, marginBottom: 8 },
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

  // Supplier step
  supplierContainer: { flex: 1, backgroundColor: '#f9fafb' },
  supplierHeader: {
    backgroundColor: '#fff', paddingTop: 56, paddingHorizontal: 20,
    paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: '#e5e7eb',
  },
  supplierTitle: { fontSize: 22, fontWeight: '700', color: '#111827' },
  supplierSubtitle: { fontSize: 14, color: '#6b7280', marginTop: 4 },
  supplierInvoiceMeta: { fontSize: 12, color: '#6b7280', marginTop: 2 },
  supplierCard: {
    backgroundColor: '#fff', borderRadius: 10, padding: 16,
    marginBottom: 12, borderWidth: 1, borderColor: '#e5e7eb',
  },
  supplierCardLabel: { fontSize: 12, fontWeight: '700', color: '#6b7280', textTransform: 'uppercase', marginBottom: 8 },
  supplierOption: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: 12, borderRadius: 8, borderWidth: 1, borderColor: '#e5e7eb',
    marginBottom: 6, backgroundColor: '#f9fafb',
  },
  supplierOptionSelected: { borderColor: '#16a34a', backgroundColor: '#f0fdf4' },
  supplierOptionInner: { flex: 1 },
  supplierOptionName: { fontSize: 15, fontWeight: '600', color: '#111827' },
  supplierOptionHint: { fontSize: 12, color: '#9ca3af', marginTop: 2 },
  supplierCheckmark: { color: '#16a34a', fontSize: 18, fontWeight: '700', marginLeft: 8 },
  supplierNewHint: { fontSize: 13, color: '#374151', marginBottom: 10 },
  supplierParsedInfo: {
    backgroundColor: '#f0fdf4', borderRadius: 8, padding: 10, marginBottom: 10,
    borderWidth: 1, borderColor: '#bbf7d0',
  },
  supplierParsedInfoText: { fontSize: 12, color: '#166534', marginBottom: 2 },
  supplierInput: {
    borderWidth: 1, borderColor: '#d1d5db', borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 15, color: '#111827', backgroundColor: '#fff', marginBottom: 10,
  },
  supplierCreateButton: {
    backgroundColor: '#2563eb', borderRadius: 8,
    paddingVertical: 12, alignItems: 'center',
  },
  supplierCreateButtonText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  supplierPickerToggle: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  supplierPickerArrow: { fontSize: 12, color: '#6b7280' },

  // Error
  errorBanner: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
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