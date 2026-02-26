// ============================================
// FILE: app/screens/ClockInScreen.tsx
// ============================================

import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { supabase } from "../../lib/supabase";

interface Location {
  id: string;
  user_id: string;
  name: string;
  address: string | null;
}

interface NetworkConnection {
  location_id: string;
  owner_id: string;
  owner_name: string;
  location_name: string;
  role: "owner" | "admin" | "member";
  require_clock_in: boolean;
  allow_anytime_access: boolean;
}

interface Shift {
  id: string;
  location_id: string;
  shift_date: string;
  start_time: string;
  end_time: string;
  role: string | null;
  notes: string | null;
  status: string;
}

interface ActiveEntry {
  id: string;
  location_id: string;
  clock_in: string;
  shift_id: string | null;
}

interface HolidayRequest {
  id: string;
  type: string;
  date_from: string;
  date_to: string;
  days: number;
  notes: string | null;
  status: string;
  decline_reason: string | null;
  created_at: string;
}

const ClockInScreen: React.FC = () => {
  const [user, setUser]                         = useState<any>(null);
  const [networks, setNetworks]                 = useState<NetworkConnection[]>([]);
  const [upcomingShifts, setUpcomingShifts]     = useState<Record<string, Shift[]>>({});
  const [activeEntry, setActiveEntry]           = useState<ActiveEntry | null>(null);
  const [loading, setLoading]                   = useState(true);
  const [clockingIn, setClockingIn]             = useState(false);

  // ── Holiday request state ──────────────────────────────────────────────────
  const [requestModalOpen, setRequestModalOpen] = useState(false);
  const [selectedNetwork, setSelectedNetwork]   = useState<NetworkConnection | null>(null);
  const [requestType, setRequestType]           = useState<'holiday' | 'unpaid_leave'>('holiday');
  const [dateFrom, setDateFrom]                 = useState('');
  const [dateTo, setDateTo]                     = useState('');
  const [requestNotes, setRequestNotes]         = useState('');
  const [submitting, setSubmitting]             = useState(false);
  const [myRequests, setMyRequests]             = useState<HolidayRequest[]>([]);
  const [requestsLoading, setRequestsLoading]   = useState(false);

  useEffect(() => { loadUser(); }, []);

  useEffect(() => {
    if (!user) return;
    loadNetworks();
    loadActiveEntry();
    loadUpcomingShifts();
    loadMyRequests();
    const alertInterval = setInterval(checkShiftAlert, 5 * 60 * 1000);
    return () => clearInterval(alertInterval);
  }, [user]);

  async function loadUser() {
    const { data: { user: currentUser } } = await supabase.auth.getUser();
    setUser(currentUser);
    setLoading(false);
  }

  async function loadNetworks() {
    if (!user) return;
    const connections: NetworkConnection[] = [];

    // ── Owned locations ────────────────────────────────────────────────────
    const { data: ownedLocations } = await supabase
      .from("locations")
      .select("*")
      .eq("user_id", user.id);

    if (ownedLocations) {
      ownedLocations.forEach((loc: Location) => {
        connections.push({
          location_id: loc.id,
          owner_id: user.id,
          owner_name: "My Business",
          location_name: loc.name,
          role: "owner",
          require_clock_in: false,
          allow_anytime_access: true,
        });
      });
    }

    // ── Member roles (employee of another business) ────────────────────────
    const { data: memberRoles } = await supabase
      .from("network_member_roles")
      .select("*, profiles:owner_id (device_name, email)")
      .eq("user_id", user.id);

    if (memberRoles) {
      for (const r of memberRoles) {
        // FIX: use array query instead of .single() to handle owners with
        // multiple locations — .single() would silently fail if there were
        // 0 or 2+ rows, causing the entire member card to disappear.
        const { data: locationRows } = await supabase
          .from("locations")
          .select("id, name, user_id")
          .eq("user_id", r.owner_id);

        if (locationRows && locationRows.length > 0) {
          locationRows.forEach((locationData: any) => {
            connections.push({
              location_id: locationData.id,
              owner_id: r.owner_id,
              owner_name:
                (r.profiles as any)?.device_name ||
                (r.profiles as any)?.email ||
                "Unknown Business",
              location_name: locationData.name,
              role: r.role,
              require_clock_in: r.require_clock_in,
              allow_anytime_access: r.allow_anytime_access,
            });
          });
        }
      }
    }

    setNetworks(connections);
  }

  async function loadActiveEntry() {
    if (!user) return;
    const { data } = await supabase
      .from("time_entries")
      .select("*")
      .eq("user_id", user.id)
      .is("clock_out", null)
      .single();
    setActiveEntry(data);
  }

  async function loadUpcomingShifts() {
    if (!user) return;
    const today = new Date().toISOString().split("T")[0];
    const sevenDays = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0];

    const { data: shifts } = await supabase
      .from("shifts")
      .select("*")
      .eq("assigned_to", user.id)
      .eq("status", "scheduled")
      .gte("shift_date", today)
      .lte("shift_date", sevenDays)
      .order("shift_date", { ascending: true })
      .order("start_time", { ascending: true });

    if (shifts) {
      const grouped: Record<string, Shift[]> = {};
      shifts.forEach((s: Shift) => {
        if (!grouped[s.location_id]) grouped[s.location_id] = [];
        grouped[s.location_id].push(s);
      });
      setUpcomingShifts(grouped);
    }
  }

  async function loadMyRequests() {
    if (!user) return;
    setRequestsLoading(true);
    const { data } = await supabase
      .from("holiday_requests")
      .select("*")
      .eq("employee_id", user.id)
      .order("created_at", { ascending: false })
      .limit(10);
    if (data) setMyRequests(data);
    setRequestsLoading(false);
  }

  // ── Delete a pending request (employees only, cannot delete approved) ────────
  async function handleDeleteRequest(requestId: string) {
    Alert.alert(
      "Cancel Request",
      "Are you sure you want to cancel this time off request?",
      [
        { text: "No", style: "cancel" },
        {
          text: "Yes, Cancel It",
          style: "destructive",
          onPress: async () => {
            try {
              const { error } = await supabase
                .from("holiday_requests")
                .delete()
                .eq("id", requestId)
                .eq("employee_id", user.id)   // safety: can only delete own
                .eq("status", "pending");       // safety: only pending
              if (error) throw error;
              await loadMyRequests();
            } catch (err: any) {
              Alert.alert("Error", err.message || "Failed to cancel request");
            }
          },
        },
      ]
    );
  }

  // ── Calculate business days between two dates ──────────────────────────────
  function calcDays(from: string, to: string): number {
    if (!from || !to) return 0;
    const start = new Date(from);
    const end   = new Date(to);
    if (end < start) return 0;
    let days = 0;
    const cur = new Date(start);
    while (cur <= end) {
      const day = cur.getDay();
      if (day !== 0 && day !== 6) days++;
      cur.setDate(cur.getDate() + 1);
    }
    return days;
  }

  // ── Submit holiday / unavailability request ────────────────────────────────
  async function handleSubmitRequest() {
    if (!selectedNetwork || !dateFrom || !dateTo) {
      Alert.alert("Missing Info", "Please fill in all required fields.");
      return;
    }
    if (new Date(dateTo) < new Date(dateFrom)) {
      Alert.alert("Invalid Dates", "End date must be after start date.");
      return;
    }

    setSubmitting(true);
    try {
      const days = calcDays(dateFrom, dateTo);

      // For owners submitting their own unavailability, owner_id === employee_id.
      // This lets managers / admins see it on the dashboard calendar.
      const isOwner = selectedNetwork.role === "owner";

      const { error } = await supabase.from("holiday_requests").insert({
        owner_id:    selectedNetwork.owner_id,
        employee_id: user.id,
        type:        requestType,
        date_from:   dateFrom,
        date_to:     dateTo,
        days,
        notes:       requestNotes.trim() || null,
        // Owners auto-approve their own unavailability; others stay pending.
        status: isOwner ? "approved" : "pending",
      });

      if (error) throw error;

      // ── If owner, also create shift entries so the calendar updates ────────
      // This mirrors what handleApprove does on the web dashboard.
      if (isOwner) {
        const inserts: any[] = [];
        const cur = new Date(dateFrom + "T00:00:00");
        const end = new Date(dateTo + "T00:00:00");
        while (cur <= end) {
          const day = cur.getDay();
          if (day !== 0 && day !== 6) { // skip weekends
            inserts.push({
              owner_id:         selectedNetwork.owner_id,
              assigned_to:      user.id,
              assigned_to_name: user.user_metadata?.full_name || user.email || "Owner",
              shift_date:       cur.toISOString().split("T")[0],
              start_time:       "00:00",
              end_time:         "00:00",
              role:             null,
              notes:            requestNotes.trim() || null,
              status:           requestType === "holiday" ? "holiday" : "cancelled",
              created_at:       new Date().toISOString(),
              updated_at:       new Date().toISOString(),
            });
          }
          cur.setDate(cur.getDate() + 1);
        }
        if (inserts.length > 0) {
          const { error: shiftError } = await supabase.from("shifts").insert(inserts);
          if (shiftError) console.warn("[ClockIn] Failed to create holiday shifts:", shiftError.message);
        }
      }

      setRequestModalOpen(false);
      setDateFrom("");
      setDateTo("");
      setRequestNotes("");
      setRequestType("holiday");
      await loadMyRequests();

      const typeLabel =
        requestType === "holiday" ? "holiday" : "unpaid leave";

      if (isOwner) {
        Alert.alert(
          "Unavailability Saved ✅",
          `Your ${typeLabel} for ${days} day${days !== 1 ? "s" : ""} has been recorded and your team will be able to see it.`
        );
      } else {
        Alert.alert(
          "Request Sent ✅",
          `Your ${typeLabel} request for ${days} day${days !== 1 ? "s" : ""} has been sent to ${selectedNetwork.owner_name}.`
        );
      }
    } catch (err: any) {
      Alert.alert("Error", err.message || "Failed to submit request");
    } finally {
      setSubmitting(false);
    }
  }

  function openRequestModal(network: NetworkConnection) {
    setSelectedNetwork(network);
    setDateFrom("");
    setDateTo("");
    setRequestNotes("");
    setRequestType("holiday");
    setRequestModalOpen(true);
  }

  // ── Clock in / out ─────────────────────────────────────────────────────────
  async function handleClockIn(locationId: string) {
    setClockingIn(true);
    try {
      const today = new Date().toISOString().split("T")[0];
      const { data: todayShifts } = await supabase
        .from("shifts")
        .select("*")
        .eq("assigned_to", user.id)
        .eq("location_id", locationId)
        .eq("shift_date", today)
        .eq("status", "scheduled");

      if (!todayShifts || todayShifts.length === 0) {
        Alert.alert(
          "No Shift Scheduled",
          "You don't have a scheduled shift today. Are you sure you want to clock in?",
          [
            { text: "Cancel", style: "cancel", onPress: () => setClockingIn(false) },
            { text: "Yes, Clock In", onPress: () => performClockIn(locationId) },
          ]
        );
        return;
      }
      await performClockIn(locationId, todayShifts[0].id);
    } catch (err: any) {
      Alert.alert("Clock In Failed", err.message || "Unable to clock in at this time");
      setClockingIn(false);
    }
  }

  async function performClockIn(locationId: string, shiftId?: string) {
    try {
      const { data: locationData, error: locationError } = await supabase
        .from("locations")
        .select("user_id")
        .eq("id", locationId)
        .single();
      if (locationError || !locationData) throw new Error("Could not find location owner");

      const { error } = await supabase.from("time_entries").insert({
        user_id:     user.id,
        owner_id:    locationData.user_id,
        location_id: locationId,
        shift_id:    shiftId || null,
        clock_in:    new Date().toISOString(),
      });
      if (error) throw error;

      await loadActiveEntry();
      Alert.alert("Clocked In", "You are now on the clock");
    } catch (err: any) {
      Alert.alert("Clock In Failed", err.message || "Unable to clock in");
    } finally {
      setClockingIn(false);
    }
  }

  async function handleClockOut() {
    setClockingIn(true);
    try {
      if (!activeEntry) throw new Error("No active time entry found");
      const { error } = await supabase
        .from("time_entries")
        .update({ clock_out: new Date().toISOString() })
        .eq("id", activeEntry.id);
      if (error) throw error;
      await loadActiveEntry();
      Alert.alert("Clocked Out", "You are now off the clock");
    } catch (err: any) {
      Alert.alert("Clock Out Failed", err.message || "Unable to clock out");
    } finally {
      setClockingIn(false);
    }
  }

  async function checkShiftAlert() {
    if (!activeEntry || !activeEntry.shift_id) return;
    const { data: shift } = await supabase
      .from("shifts")
      .select("end_time")
      .eq("id", activeEntry.shift_id)
      .single();
    if (!shift) return;
    const now = new Date();
    const shiftEnd = new Date(
      `${new Date().toISOString().split("T")[0]}T${shift.end_time}`
    );
    const thirtyMinutesAfter = new Date(shiftEnd.getTime() + 30 * 60 * 1000);
    if (now > thirtyMinutesAfter) {
      Alert.alert(
        "Still Working?",
        "Your shift ended over 30 minutes ago. Are you still working?",
        [
          { text: "Yes, Still Working", style: "default" },
          { text: "Clock Out Now", onPress: handleClockOut, style: "destructive" },
        ]
      );
    }
  }

  // ── Status badge helpers ───────────────────────────────────────────────────
  function statusColor(status: string): string {
    if (status === "approved") return "#16a34a";
    if (status === "declined") return "#dc2626";
    return "#d97706";
  }
  function statusLabel(status: string): string {
    if (status === "approved") return "✅ Approved";
    if (status === "declined") return "❌ Declined";
    return "⏳ Pending";
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color="#3b82f6" />
      </View>
    );
  }

  if (!user) {
    return (
      <View style={[styles.container, styles.centered]}>
        <Text style={styles.emptyText}>Please sign in to view your schedule</Text>
      </View>
    );
  }

  const currentNetwork = networks.find(
    (n) => n.location_id === activeEntry?.location_id
  );
  const previewDays = calcDays(dateFrom, dateTo);
  const isOwnerRequest = selectedNetwork?.role === "owner";

  return (
    <>
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.container}>

        {/* ── Clock status card ── */}
        {activeEntry ? (
          <View style={styles.statusCard}>
            <View style={styles.statusHeader}>
              <View style={[styles.statusDot, { backgroundColor: "#22c55e" }]} />
              <Text style={styles.statusTitle}>Clocked In</Text>
            </View>
            <Text style={styles.statusBusiness}>
              {currentNetwork?.location_name || "Unknown"}
            </Text>
            <Text style={styles.statusTime}>
              Since {new Date(activeEntry.clock_in).toLocaleTimeString()}
            </Text>
            <TouchableOpacity
              style={[styles.clockButton, styles.clockOutButton]}
              onPress={handleClockOut}
              disabled={clockingIn}
            >
              {clockingIn
                ? <ActivityIndicator size="small" color="#fff" />
                : <Text style={styles.clockButtonText}>Clock Out</Text>}
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.statusCard}>
            <View style={styles.statusHeader}>
              <View style={[styles.statusDot, { backgroundColor: "#9ca3af" }]} />
              <Text style={styles.statusTitle}>Not Clocked In</Text>
            </View>
            <Text style={styles.statusSubtitle}>Select a location below to clock in</Text>
          </View>
        )}

        {/* ── Network cards ── */}
        {networks.length === 0 ? (
          <View style={styles.card}>
            <Text style={styles.emptyText}>
              You don't have any locations yet. Create a location or ask your employer for an invite.
            </Text>
          </View>
        ) : (
          networks.map((network, index) => {
            const shifts = upcomingShifts[network.location_id] || [];
            const isClockedInHere = activeEntry?.location_id === network.location_id;

            return (
              <View key={`${network.location_id}-${index}`} style={styles.card}>
                <Text style={styles.cardTitle}>{network.location_name}</Text>
                <Text style={styles.cardSubtitle}>
                  {network.role === "owner"
                    ? "👑 Owner"
                    : network.role === "admin"
                    ? "⭐ Admin"
                    : "👤 Team Member"}
                  {network.allow_anytime_access && " • Access Anytime"}
                </Text>

                {shifts.length > 0 && (
                  <View style={styles.shiftsSection}>
                    <Text style={styles.shiftsSectionTitle}>Upcoming Shifts</Text>
                    {shifts.slice(0, 3).map((shift) => {
                      const shiftDate = new Date(shift.shift_date + "T00:00:00");
                      const isToday =
                        shiftDate.toDateString() === new Date().toDateString();
                      return (
                        <View key={shift.id} style={styles.shiftRow}>
                          <View>
                            <Text style={styles.shiftDate}>
                              {isToday
                                ? "Today"
                                : shiftDate.toLocaleDateString("en-US", {
                                    weekday: "short",
                                    month: "short",
                                    day: "numeric",
                                  })}
                            </Text>
                            <Text style={styles.shiftTime}>
                              {shift.start_time.slice(0, 5)} –{" "}
                              {shift.end_time.slice(0, 5)}
                              {shift.role && ` • ${shift.role}`}
                            </Text>
                          </View>
                        </View>
                      );
                    })}
                  </View>
                )}

                {!activeEntry && (
                  <TouchableOpacity
                    style={[styles.clockButton, styles.clockInButton]}
                    onPress={() => handleClockIn(network.location_id)}
                    disabled={clockingIn}
                  >
                    {clockingIn
                      ? <ActivityIndicator size="small" color="#fff" />
                      : <Text style={styles.clockButtonText}>Clock In</Text>}
                  </TouchableOpacity>
                )}

                {isClockedInHere && (
                  <View style={styles.activeIndicator}>
                    <Text style={styles.activeIndicatorText}>
                      ✓ Currently Clocked In Here
                    </Text>
                  </View>
                )}

                {/* ── Request Time Off / Unavailability (all roles) ── */}
                <TouchableOpacity
                  style={styles.requestButton}
                  onPress={() => openRequestModal(network)}
                >
                  <Text style={styles.requestButtonText}>
                    {network.role === "owner"
                      ? "📅 Mark Unavailability"
                      : "🏖️ Request Time Off"}
                  </Text>
                </TouchableOpacity>
              </View>
            );
          })
        )}

        {/* ── My recent requests ── */}
        {myRequests.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>My Time Off Requests</Text>
            {requestsLoading ? (
              <ActivityIndicator size="small" color="#3b82f6" style={{ marginTop: 8 }} />
            ) : (
              myRequests.map((req) => (
                <View key={req.id} style={styles.requestRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.requestRowTitle}>
                      {req.type === "holiday" ? "🏖️ Holiday" : "💼 Unpaid Leave"}
                      {" · "}
                      {req.days} day{req.days !== 1 ? "s" : ""}
                    </Text>
                    <Text style={styles.requestRowDates}>
                      {req.date_from} → {req.date_to}
                    </Text>
                    {req.notes && (
                      <Text style={styles.requestRowNotes}>{req.notes}</Text>
                    )}
                    {req.status === "declined" && req.decline_reason && (
                      <Text style={styles.requestRowDeclineReason}>
                        Reason: {req.decline_reason}
                      </Text>
                    )}
                  </View>
                  <View style={styles.requestRowRight}>
                    <Text
                      style={[
                        styles.requestRowStatus,
                        { color: statusColor(req.status) },
                      ]}
                    >
                      {statusLabel(req.status)}
                    </Text>
                    {req.status === "pending" && (
                      <TouchableOpacity
                        style={styles.deleteRequestButton}
                        onPress={() => handleDeleteRequest(req.id)}
                      >
                        <Text style={styles.deleteRequestButtonText}>✕ Cancel</Text>
                      </TouchableOpacity>
                    )}
                    {req.status === "approved" && (
                      <Text style={styles.requestLockedText}>🔒 Locked</Text>
                    )}
                  </View>
                </View>
              ))
            )}
          </View>
        )}

      </ScrollView>

      {/* ══════════════════════════════════════
          HOLIDAY / UNAVAILABILITY REQUEST MODAL
      ══════════════════════════════════════ */}
      <Modal
        visible={requestModalOpen}
        transparent
        animationType="slide"
        onRequestClose={() => !submitting && setRequestModalOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>
              {isOwnerRequest ? "📅 Mark Unavailability" : "🏖️ Request Time Off"}
            </Text>
            {selectedNetwork && (
              <Text style={styles.modalSubtitle}>
                {isOwnerRequest
                  ? `This will be visible to your team at ${selectedNetwork.location_name}`
                  : `Requesting from ${selectedNetwork.owner_name}`}
              </Text>
            )}

            {/* Type selector */}
            <Text style={styles.fieldLabel}>Type</Text>
            <View style={styles.typeRow}>
              <TouchableOpacity
                style={[
                  styles.typeButton,
                  requestType === "holiday" && styles.typeButtonActive,
                ]}
                onPress={() => setRequestType("holiday")}
              >
                <Text
                  style={[
                    styles.typeButtonText,
                    requestType === "holiday" && styles.typeButtonTextActive,
                  ]}
                >
                  🏖️ Holiday
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.typeButton,
                  requestType === "unpaid_leave" && styles.typeButtonActive,
                ]}
                onPress={() => setRequestType("unpaid_leave")}
              >
                <Text
                  style={[
                    styles.typeButtonText,
                    requestType === "unpaid_leave" && styles.typeButtonTextActive,
                  ]}
                >
                  💼 Unpaid Leave
                </Text>
              </TouchableOpacity>
            </View>

            {/* Date from */}
            <Text style={styles.fieldLabel}>From Date *</Text>
            <TextInput
              style={styles.input}
              value={dateFrom}
              onChangeText={setDateFrom}
              placeholder="YYYY-MM-DD"
              placeholderTextColor="#9ca3af"
              editable={!submitting}
            />

            {/* Date to */}
            <Text style={styles.fieldLabel}>To Date *</Text>
            <TextInput
              style={styles.input}
              value={dateTo}
              onChangeText={setDateTo}
              placeholder="YYYY-MM-DD"
              placeholderTextColor="#9ca3af"
              editable={!submitting}
            />

            {/* Live day count preview */}
            {previewDays > 0 && (
              <View style={styles.dayCountBadge}>
                <Text style={styles.dayCountText}>
                  {previewDays} working day{previewDays !== 1 ? "s" : ""}
                </Text>
              </View>
            )}

            {/* Notes */}
            <Text style={styles.fieldLabel}>Notes (optional)</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              value={requestNotes}
              onChangeText={setRequestNotes}
              placeholder={
                isOwnerRequest
                  ? "Let your team know why you're unavailable..."
                  : "Any additional context for your manager..."
              }
              placeholderTextColor="#9ca3af"
              multiline
              numberOfLines={3}
              editable={!submitting}
            />

            {/* Owner info banner */}
            {isOwnerRequest && (
              <View style={styles.ownerInfoBanner}>
                <Text style={styles.ownerInfoText}>
                  ℹ️ As the owner, this will be automatically approved and visible on your team's schedule.
                </Text>
              </View>
            )}

            {/* Buttons */}
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnCancel]}
                onPress={() => setRequestModalOpen(false)}
                disabled={submitting}
              >
                <Text style={styles.modalBtnCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.modalBtn,
                  styles.modalBtnSubmit,
                  submitting && { opacity: 0.6 },
                ]}
                onPress={handleSubmitRequest}
                disabled={submitting}
              >
                {submitting ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.modalBtnSubmitText}>
                    {isOwnerRequest ? "Save" : "Send Request"}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  scrollView:              { flex: 1, backgroundColor: "#f9fafb" },
  container:               { padding: 16 },
  centered:                { flex: 1, justifyContent: "center", alignItems: "center" },
  statusCard:              { backgroundColor: "#fff", borderRadius: 12, padding: 20, marginBottom: 16, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 3, elevation: 2 },
  statusHeader:            { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 },
  statusDot:               { width: 12, height: 12, borderRadius: 6 },
  statusTitle:             { fontSize: 18, fontWeight: "700", color: "#111827" },
  statusBusiness:          { fontSize: 15, fontWeight: "500", color: "#3b82f6", marginBottom: 4 },
  statusTime:              { fontSize: 13, color: "#6b7280", marginBottom: 16 },
  statusSubtitle:          { fontSize: 13, color: "#6b7280" },
  card:                    { backgroundColor: "#fff", borderRadius: 12, padding: 20, marginBottom: 16, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 3, elevation: 2 },
  cardTitle:               { fontSize: 17, fontWeight: "600", color: "#111827", marginBottom: 4 },
  cardSubtitle:            { fontSize: 13, color: "#6b7280", marginBottom: 12 },
  shiftsSection:           { marginBottom: 16, paddingTop: 12, borderTopWidth: 1, borderTopColor: "#f3f4f6" },
  shiftsSectionTitle:      { fontSize: 13, fontWeight: "600", color: "#6b7280", marginBottom: 8, textTransform: "uppercase" },
  shiftRow:                { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#f3f4f6" },
  shiftDate:               { fontSize: 14, fontWeight: "500", color: "#1f2937", marginBottom: 2 },
  shiftTime:               { fontSize: 12, color: "#6b7280" },
  clockButton:             { height: 48, borderRadius: 8, alignItems: "center", justifyContent: "center", marginBottom: 8 },
  clockInButton:           { backgroundColor: "#22c55e" },
  clockOutButton:          { backgroundColor: "#dc2626" },
  clockButtonText:         { color: "#fff", fontSize: 16, fontWeight: "600" },
  activeIndicator:         { marginTop: 4, padding: 8, backgroundColor: "#dcfce7", borderRadius: 6, marginBottom: 8 },
  activeIndicatorText:     { fontSize: 13, fontWeight: "600", color: "#16a34a", textAlign: "center" },
  requestButton:           { marginTop: 4, height: 44, borderRadius: 8, alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: "#3b82f6" },
  requestButtonText:       { color: "#3b82f6", fontSize: 15, fontWeight: "600" },
  sectionTitle:            { fontSize: 16, fontWeight: "700", color: "#111827", marginBottom: 12 },
  requestRow:              { flexDirection: "row", alignItems: "flex-start", paddingVertical: 10, borderTopWidth: 1, borderTopColor: "#f3f4f6" },
  requestRowTitle:         { fontSize: 14, fontWeight: "600", color: "#1f2937", marginBottom: 2 },
  requestRowDates:         { fontSize: 12, color: "#6b7280", marginBottom: 2 },
  requestRowNotes:         { fontSize: 12, color: "#9ca3af", fontStyle: "italic" },
  requestRowDeclineReason: { fontSize: 12, color: "#dc2626", marginTop: 2 },
  requestRowRight:         { alignItems: "flex-end", gap: 6, marginLeft: 8 },
  requestRowStatus:        { fontSize: 12, fontWeight: "700", marginTop: 2 },
  deleteRequestButton:     { marginTop: 4, paddingHorizontal: 8, paddingVertical: 4, backgroundColor: "#fee2e2", borderRadius: 6 },
  deleteRequestButtonText: { fontSize: 11, fontWeight: "700", color: "#dc2626" },
  requestLockedText:       { fontSize: 11, color: "#9ca3af", marginTop: 4 },
  emptyText:               { fontSize: 14, color: "#9ca3af", fontStyle: "italic", textAlign: "center", paddingVertical: 32 },

  // Modal
  modalOverlay:       { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modal:              { backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40 },
  modalTitle:         { fontSize: 22, fontWeight: "700", color: "#111827", marginBottom: 4 },
  modalSubtitle:      { fontSize: 14, color: "#6b7280", marginBottom: 20 },
  fieldLabel:         { fontSize: 13, fontWeight: "600", color: "#374151", marginBottom: 6, marginTop: 12 },
  typeRow:            { flexDirection: "row", gap: 10 },
  typeButton:         { flex: 1, paddingVertical: 10, borderRadius: 8, borderWidth: 1.5, borderColor: "#e5e7eb", alignItems: "center" },
  typeButtonActive:   { borderColor: "#3b82f6", backgroundColor: "#eff6ff" },
  typeButtonText:     { fontSize: 14, fontWeight: "600", color: "#6b7280" },
  typeButtonTextActive: { color: "#3b82f6" },
  input:              { borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 8, padding: 12, fontSize: 15, color: "#111827", backgroundColor: "#f9fafb" },
  textArea:           { minHeight: 80, textAlignVertical: "top" },
  dayCountBadge:      { marginTop: 8, padding: 8, backgroundColor: "#eff6ff", borderRadius: 8, alignItems: "center" },
  dayCountText:       { fontSize: 14, fontWeight: "700", color: "#3b82f6" },
  ownerInfoBanner:    { marginTop: 12, padding: 10, backgroundColor: "#fef9c3", borderRadius: 8, borderLeftWidth: 3, borderLeftColor: "#eab308" },
  ownerInfoText:      { fontSize: 12, color: "#713f12", lineHeight: 18 },
  modalButtons:       { flexDirection: "row", gap: 12, marginTop: 24 },
  modalBtn:           { flex: 1, height: 50, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  modalBtnCancel:     { backgroundColor: "#f3f4f6" },
  modalBtnCancelText: { fontSize: 16, fontWeight: "600", color: "#374151" },
  modalBtnSubmit:     { backgroundColor: "#3b82f6" },
  modalBtnSubmitText: { fontSize: 16, fontWeight: "700", color: "#fff" },
});

export default ClockInScreen;