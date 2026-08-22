import React, { useState, useMemo, useEffect } from "react";
import {
  Box,
  Grid,
  Paper,
  Typography,
  IconButton,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Chip,
  Tooltip,
  Alert,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Divider,
  ToggleButton,
  ToggleButtonGroup,
  Tabs,
  Tab,
  Badge,
} from "@mui/material";
import {
  format,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameMonth,
  isSameDay,
  addMonths,
  subMonths,
  isBefore,
  startOfDay,
  addDays,
  isAfter,
} from "date-fns";
import ArrowBackIosIcon from "@mui/icons-material/ArrowBackIos";
import ArrowForwardIosIcon from "@mui/icons-material/ArrowForwardIos";
import DeleteIcon from "@mui/icons-material/Delete";
import AccessTimeIcon from "@mui/icons-material/AccessTime";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import CalendarMonthIcon from "@mui/icons-material/CalendarMonth";
import HistoryIcon from "@mui/icons-material/History";
import AutoFixHighIcon from "@mui/icons-material/AutoFixHigh";
import BlockIcon from "@mui/icons-material/Block";
import LockIcon from "@mui/icons-material/Lock";
import { SCHEDULABLE_CONSULTATION_TYPES as CONSULTATION_TYPES, CONSULTATION_TYPE_MAP } from "../constants/consultationTypes";
import { hasTypePricing, getConfiguredDurations, getSlotSizesFromPricing } from "../utils/getMaxDuration";

const SLOT_SIZE_OPTIONS = [5, 10, 15, 20, 25, 30, 45, 60];
const GAP_OPTIONS = [2, 5, 10, 15];

const parseTimeToMinutes = (timeStr) => {
  if (!timeStr) return 0;
  const [h, m] = timeStr.split(":").map(Number);
  return h * 60 + m;
};

const minutesToTimeStr = (minutes) => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
};

/** Ceil minutes to next 5-min boundary so slots start at :00, :05, :10, … */
const ceilTo5 = (mins) => Math.ceil(mins / 5) * 5;

/**
 * Collect unique consultation types offered across all slots for a given date.
 */
const getTypesForDate = (slots = []) => {
  const types = new Set();
  slots.forEach((s) => {
    (s.consultation_types || ["complete"]).forEach((t) => types.add(t));
  });
  return [...types];
};

/**
 * Detect whether workingHours is in the new per-type format
 * (keys are consultation type values) or the legacy flat format
 * (keys are day names like "Monday").
 */
const TYPE_KEYS = new Set(CONSULTATION_TYPES.map((t) => t.value));
const DAY_NAMES = new Set(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]);

const isPerTypeFormat = (wh) => {
  if (!wh || typeof wh !== "object") return false;
  return Object.keys(wh).some((k) => TYPE_KEYS.has(k));
};

/**
 * Get working-hours windows for a specific day, respecting the selected
 * consultation-type filter.
 *
 * Per-type format:  { video: { Monday: [{start,end}] }, audio: {...} }
 * Legacy flat:      { Monday: [{start,end}] }
 *
 * When typeFilter === "all", merge windows from ALL types for that day.
 */
const getWorkingWindowsForDay = (workingHours, dayName, typeFilter) => {
  if (!workingHours) return [];

  if (!isPerTypeFormat(workingHours)) {
    // Legacy flat format
    return workingHours[dayName] || [];
  }

  if (typeFilter && typeFilter !== "all") {
    return (workingHours[typeFilter] || {})[dayName] || [];
  }

  // "all" — merge from every type, deduplicate by start+end
  const seen = new Set();
  const merged = [];
  for (const typeVal of TYPE_KEYS) {
    const windows = (workingHours[typeVal] || {})[dayName] || [];
    for (const w of windows) {
      const key = `${w.start}-${w.end}`;
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(w);
      }
    }
  }
  return merged.sort((a, b) => a.start.localeCompare(b.start));
};

/**
 * Check if a day has any working hours across any type.
 */
const dayHasAnyWorkingHours = (workingHours, dayName) => {
  if (!workingHours) return false;
  if (!isPerTypeFormat(workingHours)) {
    return (workingHours[dayName] || []).length > 0;
  }
  for (const typeVal of TYPE_KEYS) {
    if (((workingHours[typeVal] || {})[dayName] || []).length > 0) return true;
  }
  return false;
};

const AvailabilityCalendar = ({
  availableDays = [],
  availableSlots = {},
  bookedSlots = {},
  onToggleDay,
  onUpdateSlots,
  onBulkUpdateSlots,
  workingHours = {},
  approvedWorkingDays = {},
  maxApprovedDuration = 0,
  slotPricing = [],
  approvalStatus = "not_submitted",
}) => {
  // A slot is "booked" when a patient appointment occupies its start time on
  // that date — it is then locked (can't be edited or removed).
  const isSlotBooked = (dateStr, start) =>
    Array.isArray(bookedSlots[dateStr]) &&
    bookedSlots[dateStr].includes((start || "").substring(0, 5));
  const bookedCountForDate = (dateStr) => {
    const starts = bookedSlots[dateStr];
    if (!Array.isArray(starts) || starts.length === 0) return 0;
    return (availableSlots[dateStr] || []).filter((s) => starts.includes((s.start || "").substring(0, 5))).length;
  };
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(null);
  const [slotDialogOpen, setSlotDialogOpen] = useState(false);

  // Dialog form state
  const [dialogStartTime, setDialogStartTime] = useState("09:00");
  const [dialogEndTime, setDialogEndTime] = useState("17:00");
  const [dialogSlotSize, setDialogSlotSize] = useState(15);
  const [dialogGap, setDialogGap] = useState(5);
  const [dialogError, setDialogError] = useState("");

  // ── Consultation type tab for slot generation ──
  const [dialogActiveType, setDialogActiveType] = useState(0); // tab index

  // Calendar filter: which type(s) to highlight on the calendar grid
  const [calendarTypeFilter, setCalendarTypeFilter] = useState("all");

  // ── Per-type readiness checks ──
  // Uses APPROVED snapshots from the backend (admin-approved data only).
  // This ensures the doctor cannot bypass admin approval by editing local state.
  // A type is "ready" for slot generation when:
  //   1. It has approved pricing (admin-approved snapshot) with at least one duration+price
  //   2. It has approved working hours (admin-approved snapshot) for at least one day
  //   3. Overall availability approval status is "approved"
  const typeReadiness = useMemo(() => {
    const result = {};
    // slotPricing is now approvedSlotPricing (passed from parent)
    const approvedPricing = slotPricing || [];
    const approvedHours = approvedWorkingDays || {};
    for (const ct of CONSULTATION_TYPES) {
      const hasPricing = hasTypePricing(approvedPricing, ct.value);
      // Check approved working hours — always per-type format from backend snapshot
      const hasHours = isPerTypeFormat(approvedHours)
        ? Object.values(approvedHours[ct.value] || {}).some((d) => d && d.length > 0)
        : Object.values(approvedHours || {}).some((d) => Array.isArray(d) && d.length > 0);
      const isApproved = approvalStatus === "approved";
      result[ct.value] = {
        hasPricing,
        hasHours,
        isApproved,
        canGenerate: hasPricing && hasHours && isApproved,
      };
    }
    return result;
  }, [slotPricing, approvedWorkingDays, approvalStatus]);

  // ── Per-type slot sizes from pricing ──
  const activeTypeValue = CONSULTATION_TYPES[dialogActiveType]?.value;

  const activeTypeDurations = useMemo(
    () => getConfiguredDurations(slotPricing, activeTypeValue),
    [slotPricing, activeTypeValue],
  );

  // Slot sizes: expand pricing ranges into all valid sizes (e.g. "10-20" → [10,15,20])
  const expandedSlotSizes = useMemo(
    () => getSlotSizesFromPricing(slotPricing, activeTypeValue),
    [slotPricing, activeTypeValue],
  );

  // Max duration from pricing range (slot_size + gap must fit within this)
  const maxPricedDuration = useMemo(() => {
    if (expandedSlotSizes.length > 0) return Math.max(...expandedSlotSizes);
    if (maxApprovedDuration > 0) return maxApprovedDuration;
    return Infinity;
  }, [expandedSlotSizes, maxApprovedDuration]);

  const MIN_GAP = GAP_OPTIONS[0]; // minimum gap (2 min)

  // Slot sizes: multiples of 5 within pricing range, but must leave room for min gap
  const availableSlotSizes = useMemo(() => {
    let sizes;
    if (expandedSlotSizes.length > 0) {
      sizes = expandedSlotSizes;
    } else if (maxApprovedDuration > 0) {
      sizes = SLOT_SIZE_OPTIONS.filter((s) => s <= maxApprovedDuration);
    } else {
      return SLOT_SIZE_OPTIONS;
    }
    // Exclude sizes where even the minimum gap won't fit in the range
    return sizes.filter((s) => s + MIN_GAP <= maxPricedDuration);
  }, [expandedSlotSizes, maxApprovedDuration, maxPricedDuration]);

  // Gap options: constrained so slot_size + gap <= max priced duration
  const availableGapOptions = useMemo(() => {
    if (maxPricedDuration === Infinity) return GAP_OPTIONS;
    const maxGap = maxPricedDuration - dialogSlotSize;
    return GAP_OPTIONS.filter((g) => g <= maxGap);
  }, [maxPricedDuration, dialogSlotSize]);

  // Clamp slot size / gap when filtered options change
  useEffect(() => {
    if (availableSlotSizes.length > 0) {
      setDialogSlotSize((prev) =>
        availableSlotSizes.includes(prev) ? prev : availableSlotSizes[0],
      );
    }
  }, [availableSlotSizes]);

  useEffect(() => {
    setDialogGap((prev) =>
      availableGapOptions.includes(prev) ? prev : availableGapOptions[0],
    );
  }, [availableGapOptions]);

  const [dayWorkingWindows, setDayWorkingWindows] = useState([]);

  // Navigation
  const nextMonth = () => setCurrentMonth(addMonths(currentMonth, 1));
  const prevMonth = () => setCurrentMonth(subMonths(currentMonth, 1));

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(monthStart);
  const startDate = startOfWeek(monthStart);
  const endDate = endOfWeek(monthEnd);
  const calendarDays = eachDayOfInterval({ start: startDate, end: endDate });

  const workingBounds = useMemo(() => {
    if (!dayWorkingWindows.length) return { min: "00:00", max: "23:59" };
    const earliest = dayWorkingWindows.reduce((min, w) => (w.start < min ? w.start : min), "23:59");
    const latest = dayWorkingWindows.reduce((max, w) => (w.end > max ? w.end : max), "00:00");
    return { min: earliest, max: latest };
  }, [dayWorkingWindows]);

  const computedSlotCount = useMemo(() => {
    const startMin = parseTimeToMinutes(dialogStartTime);
    const endMin = parseTimeToMinutes(dialogEndTime);
    if (endMin - startMin <= 0 || dialogSlotSize <= 0 || !dayWorkingWindows.length) return 0;
    const step = dialogSlotSize + dialogGap;
    const sortedWindows = [...dayWorkingWindows].sort(
      (a, b) => parseTimeToMinutes(a.start) - parseTimeToMinutes(b.start),
    );

    let count = 0;
    let cursor = ceilTo5(startMin);
    while (cursor + dialogSlotSize <= endMin) {
      const inWindow = sortedWindows.some((w) => {
        const wS = parseTimeToMinutes(w.start);
        const wE = parseTimeToMinutes(w.end);
        return cursor >= wS && cursor + dialogSlotSize <= wE;
      });
      if (inWindow) {
        count++;
        cursor = ceilTo5(cursor + step);
      } else {
        const nw = sortedWindows.find((w) => parseTimeToMinutes(w.start) > cursor);
        if (nw) {
          cursor = ceilTo5(Math.max(cursor + step, parseTimeToMinutes(nw.start)));
        } else {
          break;
        }
      }
    }
    return count;
  }, [dialogStartTime, dialogEndTime, dialogSlotSize, dialogGap, dayWorkingWindows]);

  // ── Recalculate working windows when active type tab changes ──
  // Uses approvedWorkingDays (admin-approved snapshot) for slot generation windows.
  // The doctor can only generate slots within admin-approved time ranges.
  useEffect(() => {
    if (!selectedDate || !slotDialogOpen) return;
    const dayName = format(new Date(selectedDate + "T00:00:00"), "EEEE");
    const typeVal = CONSULTATION_TYPES[dialogActiveType]?.value;
    // Use approved working days for slot generation constraints
    const windows = getWorkingWindowsForDay(approvedWorkingDays, dayName, typeVal);
    setDayWorkingWindows(windows);

    if (windows.length > 0) {
      const earliest = windows.reduce((min, w) => (w.start < min ? w.start : min), "23:59");
      const latest = windows.reduce((max, w) => (w.end > max ? w.end : max), "00:00");
      setDialogStartTime(earliest);
      setDialogEndTime(latest);
    }
  }, [dialogActiveType, selectedDate, slotDialogOpen, approvedWorkingDays]);

  // ── Day click ──
  const handleDayClick = (day) => {
    const dateStr = format(day, "yyyy-MM-dd");
    const dayName = format(day, "EEEE");

    // Find the first type tab that has approved working hours for this day
    let initialTab = 0;
    for (let i = 0; i < CONSULTATION_TYPES.length; i++) {
      const typeVal = CONSULTATION_TYPES[i].value;
      const typeWindows = getWorkingWindowsForDay(approvedWorkingDays, dayName, typeVal);
      if (typeWindows.length > 0 && typeReadiness[typeVal]?.canGenerate) {
        initialTab = i;
        break;
      }
    }

    const typeVal = CONSULTATION_TYPES[initialTab].value;
    const windows = getWorkingWindowsForDay(approvedWorkingDays, dayName, typeVal);

    setSelectedDate(dateStr);
    setDayWorkingWindows(windows);
    setDialogError("");

    if (windows.length > 0) {
      const earliest = windows.reduce((min, w) => (w.start < min ? w.start : min), "23:59");
      const latest = windows.reduce((max, w) => (w.end > max ? w.end : max), "00:00");
      setDialogStartTime(earliest);
      setDialogEndTime(latest);
      setDialogGap(5);

      if (!availableDays.includes(dateStr)) {
        onToggleDay(dateStr);
      }
    }

    setDialogActiveType(initialTab);
    setSlotDialogOpen(true);
  };

  // ── Generate slots ──
  const handleGenerateSlots = () => {
    setDialogError("");
    const startMin = parseTimeToMinutes(dialogStartTime);
    const endMin = parseTimeToMinutes(dialogEndTime);
    const boundsMin = parseTimeToMinutes(workingBounds.min);
    const boundsMax = parseTimeToMinutes(workingBounds.max);

    if (dayWorkingWindows.length > 0) {
      if (startMin < boundsMin) { setDialogError(`Start time must be >= ${workingBounds.min}`); return; }
      if (endMin > boundsMax) { setDialogError(`End time must be <= ${workingBounds.max}`); return; }
    }
    if (endMin <= startMin + 5) { setDialogError("End time must be at least 5 minutes after start"); return; }
    if (dialogSlotSize < 5) { setDialogError("Slot size must be >= 5 minutes"); return; }
    if (dialogGap < 0) { setDialogError("Gap must be >= 0 minutes"); return; }
    if (computedSlotCount === 0) { setDialogError("No slots fit with these settings"); return; }

    const activeTypeValue = CONSULTATION_TYPES[dialogActiveType].value;

    const newSlots = [];
    const step = dialogSlotSize + dialogGap;
    let cursor = ceilTo5(startMin);
    const sortedWindows = [...dayWorkingWindows].sort(
      (a, b) => parseTimeToMinutes(a.start) - parseTimeToMinutes(b.start),
    );

    while (cursor + dialogSlotSize <= endMin) {
      const inWindow = sortedWindows.some((w) => {
        const wS = parseTimeToMinutes(w.start);
        const wE = parseTimeToMinutes(w.end);
        return cursor >= wS && cursor + dialogSlotSize <= wE;
      });
      if (inWindow) {
        newSlots.push({
          start: minutesToTimeStr(cursor),
          end: minutesToTimeStr(cursor + dialogSlotSize),
          size: dialogSlotSize,
          gap: dialogGap,
          consultation_types: [activeTypeValue],
        });
        cursor = ceilTo5(cursor + step);
      } else {
        const nw = sortedWindows.find((w) => parseTimeToMinutes(w.start) > cursor);
        if (nw) {
          cursor = ceilTo5(Math.max(cursor + step, parseTimeToMinutes(nw.start)));
        } else {
          break;
        }
      }
    }

    // Merge with existing — if a slot with same start already exists, merge the
    // new consultation type into its consultation_types array
    const existingSlots = availableSlots[selectedDate] || [];
    const existingByStart = {};
    existingSlots.forEach((s, i) => { existingByStart[s.start] = i; });

    let addedCount = 0;
    let mergedTypeCount = 0;
    const updatedSlots = [...existingSlots];

    newSlots.forEach((ns) => {
      if (ns.start in existingByStart) {
        // Slot time exists — merge consultation type
        const idx = existingByStart[ns.start];
        const existingTypes = updatedSlots[idx].consultation_types || ["complete"];
        if (!existingTypes.includes(activeTypeValue)) {
          updatedSlots[idx] = {
            ...updatedSlots[idx],
            consultation_types: [...existingTypes, activeTypeValue],
          };
          mergedTypeCount++;
        }
      } else {
        updatedSlots.push(ns);
        existingByStart[ns.start] = updatedSlots.length - 1;
        addedCount++;
      }
    });

    const mergedSlots = updatedSlots.sort(
      (a, b) => parseTimeToMinutes(a.start) - parseTimeToMinutes(b.start),
    );

    onUpdateSlots(selectedDate, mergedSlots);

    if (addedCount > 0 || mergedTypeCount > 0) {
      const parts = [];
      if (addedCount > 0) parts.push(`${addedCount} new slot(s) added`);
      if (mergedTypeCount > 0) parts.push(`${mergedTypeCount} slot(s) updated with ${CONSULTATION_TYPE_MAP[activeTypeValue]?.label}`);
      setDialogError(parts.join(". "));
    } else {
      setDialogError(`All slots already have ${CONSULTATION_TYPE_MAP[activeTypeValue]?.label} assigned.`);
    }
  };

  const handleDeleteSlot = (index) => {
    if (!selectedDate) return;
    const all = availableSlots[selectedDate] || [];
    // A booked slot is locked — it can't be removed.
    if (all[index] && isSlotBooked(selectedDate, all[index].start)) return;
    const updatedSlots = all.filter((_, i) => i !== index);
    onUpdateSlots(selectedDate, updatedSlots);
  };

  // Remove only the active consultation type from a slot.
  // If it's the last type on that slot, remove the entire slot.
  const handleRemoveTypeFromSlot = (slotIndex) => {
    if (!selectedDate) return;
    const activeTypeValue = CONSULTATION_TYPES[dialogActiveType].value;
    const allSlots = [...(availableSlots[selectedDate] || [])];
    const slot = allSlots[slotIndex];
    if (!slot) return;
    // A booked slot is locked — it can't be edited or removed.
    if (isSlotBooked(selectedDate, slot.start)) return;

    const types = slot.consultation_types || ["complete"];
    if (types.length <= 1) {
      // Last type — remove the entire slot
      allSlots.splice(slotIndex, 1);
    } else {
      allSlots[slotIndex] = {
        ...slot,
        consultation_types: types.filter((t) => t !== activeTypeValue),
      };
    }
    onUpdateSlots(selectedDate, allSlots);
  };

  const handleDisableDay = () => {
    if (!selectedDate) return;
    onToggleDay(selectedDate);
    setSlotDialogOpen(false);
  };

  // ── Bulk copy helpers ──
  const filterSlotsByWorkingHours = (slots, dateObj) => {
    const dayName = format(dateObj, "EEEE");
    const windows = getWorkingWindowsForDay(workingHours, dayName, calendarTypeFilter);
    if (windows.length === 0) return [];
    return slots.filter((slot) => {
      const sS = parseTimeToMinutes(slot.start);
      const sE = parseTimeToMinutes(slot.end);
      return windows.some((w) => {
        const wS = parseTimeToMinutes(w.start);
        const wE = parseTimeToMinutes(w.end);
        return sS >= wS && sE <= wE;
      });
    });
  };

  const handleCopyToNext7Days = () => {
    if (!selectedDate || !onBulkUpdateSlots) return;
    const start = new Date(selectedDate);
    const slotsToCopy = availableSlots[selectedDate] || [];
    const updates = {};
    const today = startOfDay(new Date());
    const maxDate = addDays(today, 30);

    for (let i = 1; i <= 7; i++) {
      const nextDate = new Date(start);
      nextDate.setDate(start.getDate() + i);
      const nextDayStart = startOfDay(nextDate);
      if (!isBefore(nextDayStart, today) && !isAfter(nextDayStart, maxDate)) {
        updates[format(nextDate, "yyyy-MM-dd")] = filterSlotsByWorkingHours(slotsToCopy, nextDate);
      }
    }
    if (Object.keys(updates).length > 0) onBulkUpdateSlots(updates);
    setSlotDialogOpen(false);
  };

  const handleCopyToMonth = () => {
    if (!selectedDate || !onBulkUpdateSlots) return;
    const start = new Date(selectedDate);
    const end = endOfMonth(start);
    const slotsToCopy = availableSlots[selectedDate] || [];
    const updates = {};
    const today = startOfDay(new Date());
    const maxDate = addDays(today, 30);

    eachDayOfInterval({ start: new Date(start.setDate(start.getDate() + 1)), end }).forEach((day) => {
      const dayStart = startOfDay(day);
      if (!isBefore(dayStart, today) && !isAfter(dayStart, maxDate)) {
        updates[format(day, "yyyy-MM-dd")] = filterSlotsByWorkingHours(slotsToCopy, day);
      }
    });
    if (Object.keys(updates).length > 0) onBulkUpdateSlots(updates);
    setSlotDialogOpen(false);
  };

  const handleCopyPreviousMonth = () => {
    if (!onBulkUpdateSlots) return;
    const prevMonthDate = subMonths(currentMonth, 1);
    const updates = {};
    eachDayOfInterval({ start: startOfMonth(prevMonthDate), end: endOfMonth(prevMonthDate) }).forEach(
      (day) => {
        const dateStr = format(day, "yyyy-MM-dd");
        if (availableSlots[dateStr]?.length > 0) {
          const dayOfMonth = day.getDate();
          try {
            const target = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), dayOfMonth);
            if (target.getMonth() === currentMonth.getMonth()) {
              updates[format(target, "yyyy-MM-dd")] = [...availableSlots[dateStr]];
            }
          } catch { /* ignore */ }
        }
      },
    );
    if (Object.keys(updates).length > 0) onBulkUpdateSlots(updates);
  };

  // ──────────────────────────────────────────────────────────────────────
  // RENDER
  // ──────────────────────────────────────────────────────────────────────

  return (
    <Box className="calendar-container">
      {/* ── Calendar type filter tabs ── */}
      <Box display="flex" justifyContent="center" mb={2}>
        <ToggleButtonGroup
          value={calendarTypeFilter}
          exclusive
          onChange={(_, val) => val && setCalendarTypeFilter(val)}
          size="small"
        >
          <ToggleButton value="all">All</ToggleButton>
          {CONSULTATION_TYPES.map((ct) => (
            <ToggleButton key={ct.value} value={ct.value}>
              <Box
                component="span"
                sx={{
                  width: 8, height: 8, borderRadius: "50%",
                  bgcolor: ct.color, mr: 0.5, display: "inline-block",
                }}
              />
              {ct.label}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </Box>

      {/* ── Status legend: the three sections of the schedule ── */}
      {(() => {
        const isApproved = approvalStatus === "approved";
        const items = [
          {
            key: "approved",
            color: "#1B7F3B",
            label: isApproved ? "Approved — slots are live" : "Approved (live)",
            active: isApproved,
          },
          {
            key: "pending",
            color: "#E65100",
            label: "Pending admin approval",
            active: !isApproved,
          },
          { key: "booked", color: "#C62828", label: "Booked — locked", lock: true },
        ];
        return (
          <Box display="flex" justifyContent="center" gap={2.5} flexWrap="wrap" mb={2}>
            {items.map((it) => (
              <Box key={it.key} display="flex" alignItems="center" gap={0.75}
                sx={{ opacity: it.active === false ? 0.55 : 1 }}>
                {it.lock ? (
                  <LockIcon sx={{ fontSize: 16, color: it.color }} />
                ) : (
                  <Box sx={{ width: 14, height: 14, borderRadius: "50%", bgcolor: it.color,
                    border: it.active ? "2px solid" : "none", borderColor: it.color }} />
                )}
                <Typography variant="caption" fontWeight={it.active ? 700 : 500}
                  sx={{ color: it.active === false ? "text.secondary" : it.color }}>
                  {it.label}
                </Typography>
              </Box>
            ))}
          </Box>
        );
      })()}

      {/* ── Header ── */}
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
        <Box display="flex" alignItems="center">
          <IconButton onClick={prevMonth}><ArrowBackIosIcon /></IconButton>
          <Typography variant="h6" sx={{ minWidth: 150, textAlign: "center" }}>
            {format(currentMonth, "MMMM yyyy")}
          </Typography>
          <IconButton onClick={nextMonth}><ArrowForwardIosIcon /></IconButton>
        </Box>
        {onBulkUpdateSlots && (
          <Tooltip title="Copy schedule from previous month">
            <Button startIcon={<HistoryIcon />} size="small" onClick={handleCopyPreviousMonth} variant="outlined">
              Copy Prev Month
            </Button>
          </Tooltip>
        )}
      </Box>

      {/* ── Calendar Grid ── */}
      <Grid container spacing={1}>
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
          <Grid item xs={12 / 7} key={day}>
            <Typography variant="subtitle2" align="center" color="textSecondary">{day}</Typography>
          </Grid>
        ))}
        {calendarDays.map((day, i) => {
          const dateStr = format(day, "yyyy-MM-dd");
          const dayName = format(day, "EEEE");
          const isCurrentMonth = isSameMonth(day, currentMonth);
          const isSelected = selectedDate === dateStr;
          const dayStart = startOfDay(day);
          const today = startOfDay(new Date());
          const maxDate = startOfDay(addDays(today, 30));
          const isPast = isBefore(dayStart, today);
          const isTooFarFuture = isAfter(dayStart, maxDate);
          const isSelectable = !isPast && !isTooFarFuture && isCurrentMonth;

          const daySlots = availableSlots[dateStr] || [];
          const slotsCount = daySlots.length;
          const hasWorkingHours = dayHasAnyWorkingHours(workingHours, dayName);

          // Count slots per consultation type for this day
          const typeCounts = {};
          daySlots.forEach((s) => {
            (s.consultation_types || ["complete"]).forEach((t) => {
              typeCounts[t] = (typeCounts[t] || 0) + 1;
            });
          });
          const dayTypes = Object.keys(typeCounts);

          // Apply calendar filter
          let filteredCount = slotsCount;
          if (calendarTypeFilter !== "all" && slotsCount > 0) {
            filteredCount = typeCounts[calendarTypeFilter] || 0;
          }

          return (
            <Grid item xs={12 / 7} key={i}>
              <Paper
                elevation={isSelected ? 3 : 1}
                onClick={() => isSelectable && handleDayClick(day)}
                sx={{
                  p: 1,
                  height: "100%",
                  opacity: isSelectable ? 1 : 0.4,
                  bgcolor: isSelected ? "#1a237e" : hasWorkingHours ? "background.paper" : "action.disabledBackground",
                  color: isSelected ? "#fff" : "text.primary",
                  minHeight: 110,
                  cursor: isSelectable ? "pointer" : "not-allowed",
                  overflow: "hidden",
                  position: "relative",
                  border: isSameDay(day, new Date()) ? "2px solid" : isSelected ? "2px solid" : "none",
                  borderColor: isSameDay(day, new Date()) ? "secondary.main" : isSelected ? "#3949ab" : "transparent",
                }}
              >
                <Typography variant="body2" fontWeight="bold" p={0.5} color={isSelected ? "#fff" : "inherit"}>
                  {format(day, "d")}
                </Typography>
                {filteredCount > 0 && (
                  <Box mt={0.5} display="flex" justifyContent="center" gap={0.5} flexWrap="wrap">
                    <Chip
                      label={`${filteredCount} Slots`}
                      size="small"
                      sx={{
                        fontSize: "0.65rem",
                        height: 20,
                        bgcolor: isSelected ? "rgba(255,255,255,0.2)" : "primary.main",
                        color: "#fff",
                      }}
                    />
                    {bookedCountForDate(dateStr) > 0 && (
                      <Tooltip title={`${bookedCountForDate(dateStr)} booked (locked)`} arrow>
                        <Chip
                          icon={<LockIcon sx={{ fontSize: "0.7rem !important", color: "#fff !important" }} />}
                          label={bookedCountForDate(dateStr)}
                          size="small"
                          sx={{ fontSize: "0.65rem", height: 20, bgcolor: "#C62828", color: "#fff",
                            "& .MuiChip-icon": { ml: "4px" } }}
                        />
                      </Tooltip>
                    )}
                  </Box>
                )}
                {/* ── Per-type slot count list (vertical) ── */}
                {dayTypes.length > 0 && (
                  <Box display="flex" flexDirection="column" gap={0.2} mt={0.5} px={0.5}>
                    {CONSULTATION_TYPES
                      .filter((ct) =>
                        typeCounts[ct.value] &&
                        (calendarTypeFilter === 'all' || calendarTypeFilter === ct.value)
                      )
                      .map((ct) => {
                        // Lighten colors on dark selected background for visibility
                        const displayColor = isSelected
                          ? { '#4CAF50': '#81C784', '#2196F3': '#90CAF9', '#FF9800': '#FFB74D', '#9C27B0': '#CE93D8', '#009688': '#4DB6AC', '#FF5722': '#FF8A65' }[ct.color] || ct.color
                          : ct.color;
                        return (
                          <Tooltip key={ct.value} title={`${ct.label}: ${typeCounts[ct.value]} slots`} arrow>
                            <Box
                              sx={{
                                display: "flex",
                                alignItems: "center",
                                gap: "4px",
                              }}
                            >
                              <Box
                                sx={{
                                  width: 8, height: 8,
                                  borderRadius: "50%",
                                  bgcolor: displayColor,
                                  flexShrink: 0,
                                  border: isSelected ? "1px solid rgba(255,255,255,0.5)" : "none",
                                }}
                              />
                              <Typography
                                sx={{
                                  fontSize: "0.7rem",
                                  fontWeight: 600,
                                  color: displayColor,
                                  lineHeight: 1.2,
                                }}
                              >
                                {ct.shortLabel} {typeCounts[ct.value]}
                              </Typography>
                            </Box>
                          </Tooltip>
                        );
                      })}
                  </Box>
                )}
                {!hasWorkingHours && isCurrentMonth && (
                  <Typography variant="caption" color="text.disabled" sx={{ fontSize: "0.6rem", px: 0.5 }}>
                    Off
                  </Typography>
                )}
              </Paper>
            </Grid>
          );
        })}
      </Grid>

      {/* ── Slot Management Dialog ── */}
      <Dialog open={slotDialogOpen} onClose={() => setSlotDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>
          Manage Slots for{" "}
          {selectedDate && format(new Date(selectedDate + "T00:00:00"), "EEEE, MMMM d, yyyy")}
        </DialogTitle>
        <DialogContent dividers>
          <Box display="flex" flexDirection="column" gap={2}>
            {/* Working hours info */}
            {dayWorkingWindows.length > 0 ? (
              <Alert severity="info" sx={{ py: 0.5 }}>
                Working hours:{" "}
                {dayWorkingWindows.map((w, i) => (
                  <strong key={i}>{i > 0 && ", "}{w.start} – {w.end}</strong>
                ))}. Slots must be within this window.
              </Alert>
            ) : (
              <Alert severity="warning" sx={{ py: 0.5 }}>
                No working hours configured for this day. Set them in Weekly Working Hours first.
              </Alert>
            )}

            {/* ── Consultation Type Sub-Tabs (top-level) ── */}
            <Box sx={{ borderBottom: 1, borderColor: "divider" }}>
              <Tabs
                value={dialogActiveType}
                onChange={(_, v) => setDialogActiveType(v)}
                variant="scrollable"
                scrollButtons="auto"
                sx={{
                  minHeight: 40,
                  "& .MuiTab-root": { minHeight: 40, textTransform: "none", py: 0.5 },
                }}
              >
                {CONSULTATION_TYPES.map((ct, idx) => {
                  const allSlots = availableSlots[selectedDate] || [];
                  const typeCount = allSlots.filter(
                    (s) => (s.consultation_types || ["complete"]).includes(ct.value),
                  ).length;
                  const readiness = typeReadiness[ct.value] || {};
                  const isReady = readiness.canGenerate;
                  return (
                    <Tab
                      key={ct.value}
                      label={
                        <Box display="flex" alignItems="center" gap={0.5}>
                          <Box
                            sx={{
                              width: 8, height: 8, borderRadius: "50%",
                              bgcolor: isReady ? ct.color : "grey.400", flexShrink: 0,
                            }}
                          />
                          <Typography
                            variant="caption"
                            sx={{
                              fontWeight: 600,
                              color: dialogActiveType === idx
                                ? (isReady ? ct.color : "text.secondary")
                                : "text.secondary",
                              opacity: isReady ? 1 : 0.6,
                            }}
                          >
                            {ct.shortLabel}
                          </Typography>
                          {!isReady && (
                            <Typography variant="caption" sx={{ fontSize: "0.6rem", color: "error.main" }}>
                              !
                            </Typography>
                          )}
                          {typeCount > 0 && (
                            <Badge
                              badgeContent={typeCount}
                              sx={{
                                "& .MuiBadge-badge": {
                                  bgcolor: ct.color,
                                  color: "#fff",
                                  fontSize: "0.65rem",
                                  height: 16, minWidth: 16,
                                  position: "static",
                                  transform: "none",
                                  ml: 0.5,
                                },
                              }}
                            />
                          )}
                        </Box>
                      }
                      sx={{
                        borderBottom: dialogActiveType === idx ? `3px solid ${isReady ? ct.color : "grey.400"}` : "none",
                        "&.Mui-selected": { color: isReady ? ct.color : "text.secondary" },
                      }}
                    />
                  );
                })}
              </Tabs>
            </Box>

            {/* ── Active type readiness status ── */}
            {(() => {
              const ct = CONSULTATION_TYPES[dialogActiveType];
              const readiness = typeReadiness[ct.value] || {};
              return (
                <Box>
                  <Alert
                    severity={readiness.canGenerate ? "success" : "warning"}
                    sx={{ py: 0.5 }}
                    icon={false}
                  >
                    <Typography variant="body2" fontWeight="bold" sx={{ color: ct.color, mb: 0.5 }}>
                      {ct.icon} {ct.label}
                    </Typography>
                    <Box display="flex" flexDirection="column" gap={0.3}>
                      <Typography variant="caption" sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                        {readiness.hasPricing ? "✅" : "❌"} Pricing configured
                        {!readiness.hasPricing && (
                          <Typography component="span" variant="caption" color="error.main" fontWeight="bold">
                            {" — Set pricing in Consultation Pricing tab first"}
                          </Typography>
                        )}
                      </Typography>
                      <Typography variant="caption" sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                        {readiness.hasHours ? "✅" : "❌"} Working hours set
                        {!readiness.hasHours && (
                          <Typography component="span" variant="caption" color="error.main" fontWeight="bold">
                            {" — Set working hours in Weekly Working Hours tab first"}
                          </Typography>
                        )}
                      </Typography>
                      <Typography variant="caption" sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                        {readiness.isApproved ? "✅" : "⏳"} Admin approval
                        {!readiness.isApproved && (
                          <Typography component="span" variant="caption" color="text.secondary">
                            {approvalStatus === "pending" ? " — Pending review" : " — Submit for approval"}
                          </Typography>
                        )}
                      </Typography>
                    </Box>
                  </Alert>
                </Box>
              );
            })()}

            {/* ── Existing slots, grouped into status sections ── */}
            {(() => {
              const activeTypeValue = CONSULTATION_TYPES[dialogActiveType].value;
              const allSlots = availableSlots[selectedDate] || [];
              const filteredSlots = allSlots
                .map((slot, originalIndex) => ({ slot, originalIndex }))
                .filter(({ slot }) => (slot.consultation_types || ["complete"]).includes(activeTypeValue));

              // Bucket each slot: booked (a patient appointment holds it) →
              // approved (admin-approved, live) → waiting (pending admin review).
              const statusOf = ({ slot }) => {
                if (isSlotBooked(selectedDate, slot.start)) return "booked";
                return slot.approval_status === "approved" ? "approved" : "pending";
              };
              const groups = { booked: [], approved: [], pending: [] };
              filteredSlots.forEach((fs) => groups[statusOf(fs)].push(fs));

              const SECTIONS = [
                { key: "booked", label: "Booked — locked", color: "#C62828" },
                { key: "approved", label: "Approved — live", color: "#1B7F3B" },
                { key: "pending", label: "Waiting for admin approval", color: "#E65100" },
              ];

              const renderRow = ({ slot, originalIndex }, key) => {
                const booked = key === "booked";
                const color = SECTIONS.find((s) => s.key === key).color;
                return (
                  <Box
                    key={originalIndex}
                    display="flex"
                    alignItems="center"
                    gap={2}
                    p={1}
                    mb={0.5}
                    bgcolor={booked ? "rgba(198,40,40,0.08)" : "action.hover"}
                    borderRadius={1}
                    sx={{ borderLeft: `3px solid ${color}` }}
                  >
                    {booked
                      ? <LockIcon fontSize="small" sx={{ color }} />
                      : <AccessTimeIcon fontSize="small" sx={{ color }} />}
                    <Typography variant="body2" sx={{ flex: 1 }}>
                      {slot.start} – {slot.end}
                      {slot.size && (
                        <Typography component="span" variant="caption" color="text.secondary">
                          {" "}({slot.size}min)
                        </Typography>
                      )}
                    </Typography>
                    {/* Other consultation types this slot also serves */}
                    <Box display="flex" gap={0.3}>
                      {(slot.consultation_types || ["complete"])
                        .filter((t) => t !== activeTypeValue)
                        .map((t) => {
                          const meta = CONSULTATION_TYPE_MAP[t];
                          return meta ? (
                            <Tooltip key={t} title={`Also: ${meta.label}`} arrow>
                              <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: meta.color }} />
                            </Tooltip>
                          ) : null;
                        })}
                    </Box>
                    <Tooltip title={
                      booked
                        ? "This slot is booked by a patient and can't be changed"
                        : (slot.consultation_types || ["complete"]).length > 1
                          ? `Remove ${CONSULTATION_TYPES[dialogActiveType].shortLabel} from this slot`
                          : "Delete slot"
                    }>
                      <span>
                        <IconButton size="small" color="error" disabled={booked}
                          onClick={() => handleRemoveTypeFromSlot(originalIndex)}>
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                  </Box>
                );
              };

              return (
                <>
                  <Typography variant="subtitle2" sx={{ color: CONSULTATION_TYPES[dialogActiveType].color }}>
                    {CONSULTATION_TYPES[dialogActiveType].shortLabel} Slots ({filteredSlots.length}):
                  </Typography>
                  {filteredSlots.length > 0 ? (
                    <Box sx={{ maxHeight: 260, overflowY: "auto" }}>
                      {SECTIONS.map((sec) => groups[sec.key].length > 0 && (
                        <Box key={sec.key} mb={1}>
                          <Box display="flex" alignItems="center" gap={0.75} mt={1} mb={0.5}>
                            {sec.key === "booked"
                              ? <LockIcon sx={{ fontSize: 15, color: sec.color }} />
                              : <Box sx={{ width: 11, height: 11, borderRadius: "50%", bgcolor: sec.color }} />}
                            <Typography variant="caption" fontWeight={700} sx={{ color: sec.color }}>
                              {sec.label} ({groups[sec.key].length})
                            </Typography>
                          </Box>
                          {groups[sec.key].map((fs) => renderRow(fs, sec.key))}
                        </Box>
                      ))}
                    </Box>
                  ) : (
                    <Typography variant="body2" color="text.secondary">
                      No {CONSULTATION_TYPES[dialogActiveType].shortLabel.toLowerCase()} slots added yet.
                    </Typography>
                  )}
                </>
              );
            })()}

            {/* Generate new slots — only if type has pricing + working hours */}
            {(() => {
              const ct = CONSULTATION_TYPES[dialogActiveType];
              const readiness = typeReadiness[ct.value] || {};
              if (!readiness.canGenerate) return null;
              if (dayWorkingWindows.length === 0) return null;
              return true;
            })() && (
              <>
                <Divider sx={{ my: 1 }} />
                <Typography variant="subtitle2">Generate New Slots:</Typography>

                {/* Start / End time */}
                <Box display="flex" gap={2} alignItems="center">
                  <TextField
                    type="time" label="Start Time" value={dialogStartTime}
                    onChange={(e) => setDialogStartTime(e.target.value)}
                    InputLabelProps={{ shrink: true }}
                    inputProps={{ min: workingBounds.min, max: workingBounds.max }}
                    size="small" sx={{ flex: 1 }}
                  />
                  <Typography color="text.secondary">to</Typography>
                  <TextField
                    type="time" label="End Time" value={dialogEndTime}
                    onChange={(e) => setDialogEndTime(e.target.value)}
                    InputLabelProps={{ shrink: true }}
                    inputProps={{ min: workingBounds.min, max: workingBounds.max }}
                    size="small" sx={{ flex: 1 }}
                  />
                </Box>

                {/* Slot Size / Gap */}
                <Box display="flex" gap={2}>
                  <FormControl size="small" sx={{ flex: 1 }}>
                    <InputLabel>Slot Size</InputLabel>
                    {maxApprovedDuration > 0 && availableSlotSizes.length === 0 ? (
                      <Alert severity="warning" sx={{ py: 0.5, mt: 1 }}>
                        No matching slot sizes for approved pricing.
                      </Alert>
                    ) : (
                      <Select
                        value={availableSlotSizes.includes(dialogSlotSize) ? dialogSlotSize : availableSlotSizes[0] || 15}
                        label="Slot Size"
                        onChange={(e) => setDialogSlotSize(Number(e.target.value))}
                      >
                        {availableSlotSizes.map((opt) => (
                          <MenuItem key={opt} value={opt}>{opt} min</MenuItem>
                        ))}
                      </Select>
                    )}
                  </FormControl>
                  <FormControl size="small" sx={{ flex: 1 }}>
                    <InputLabel>Gap Between</InputLabel>
                    <Select
                      value={availableGapOptions.includes(dialogGap) ? dialogGap : (availableGapOptions[0] ?? dialogGap)}
                      label="Gap Between"
                      onChange={(e) => setDialogGap(Number(e.target.value))}
                    >
                      {availableGapOptions.map((opt) => (
                        <MenuItem key={opt} value={opt}>{opt} min</MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Box>

                {/* Preview */}
                <Alert severity={computedSlotCount > 0 ? "success" : "warning"} sx={{ py: 0.5 }}>
                  {computedSlotCount > 0 ? (
                    <>
                      Will generate <strong>{computedSlotCount}</strong> slot(s)
                      of <strong>{dialogSlotSize}min</strong> each with{" "}
                      <strong>{dialogGap}min</strong> gap
                      {" "}for <strong style={{ color: CONSULTATION_TYPES[dialogActiveType].color }}>
                        {CONSULTATION_TYPES[dialogActiveType].label}
                      </strong>
                    </>
                  ) : (
                    "No slots fit with current settings"
                  )}
                </Alert>

                {dialogError && (
                  <Alert severity={dialogError.includes("added") || dialogError.includes("updated") ? "info" : "error"} sx={{ py: 0.5 }}>
                    {dialogError}
                  </Alert>
                )}

                <Button
                  variant="contained" startIcon={<AutoFixHighIcon />}
                  onClick={handleGenerateSlots}
                  disabled={computedSlotCount === 0}
                  sx={{
                    bgcolor: CONSULTATION_TYPES[dialogActiveType].color,
                    "&:hover": { bgcolor: CONSULTATION_TYPES[dialogActiveType].color, opacity: 0.9 },
                  }}
                >
                  Generate {computedSlotCount} Slot{computedSlotCount !== 1 ? "s" : ""}
                </Button>
              </>
            )}

            {/* Bulk actions */}
            {onBulkUpdateSlots && (availableSlots[selectedDate] || []).length > 0 && (
              <Box mt={1} pt={2} borderTop="1px solid" sx={{ borderColor: "divider" }}>
                <Typography variant="subtitle2" gutterBottom>Quick Actions:</Typography>
                <Box display="flex" gap={2} flexWrap="wrap">
                  <Button variant="outlined" size="small" startIcon={<ContentCopyIcon />} onClick={handleCopyToNext7Days}>
                    Copy to Next 7 Days
                  </Button>
                  <Button variant="outlined" size="small" startIcon={<CalendarMonthIcon />} onClick={handleCopyToMonth}>
                    Copy to Rest of Month
                  </Button>
                </Box>
              </Box>
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button color="error" startIcon={<BlockIcon />} onClick={handleDisableDay}>
            Mark Unavailable
          </Button>
          <Button onClick={() => setSlotDialogOpen(false)} variant="contained">
            Done
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default AvailabilityCalendar;
