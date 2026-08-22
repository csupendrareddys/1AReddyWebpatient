import React, { useState, useMemo } from 'react';
import { Box, Typography, Tooltip, Chip } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import FiberManualRecordIcon from '@mui/icons-material/FiberManualRecord';
import DayHoursEditor from './DayHoursEditor';
import {
    DAYS, DAY_SHORT, toMins, formatHours, formatTime12h,
    slotsTotalHours, computeSharedWindow, sameDaySlots,
} from '../utils/scheduleTime';

const STATUS_COLOR = {
    pending: 'warning.main',
    rejected: 'error.main',
    approved: 'success.main',
};

/**
 * Interactive weekly working-hours matrix.
 *
 * Rows = weekdays, columns = consultation types. Each cell draws a mini
 * timeline of the draft hours on a shared 24h scale so cells are visually
 * comparable. Clicking a cell opens {@link DayHoursEditor} to edit that
 * day × type. The whole draft (`perTypeHours`) is what gets submitted for
 * admin approval; `approvedPerType` is the live snapshot shown for reference.
 *
 * @param {Object} perTypeHours   draft: { [typeValue]: { [day]: slot[] } }
 * @param {Object} approvedPerType approved/live snapshot, same shape
 * @param {Array}  types          consultation type objects to show as columns
 * @param {Object} granularStatus per-type approval status
 * @param {Function} onTypeChange (typeValue, newDayMap) => void
 */
const WeeklyHoursGraph = ({
    perTypeHours = {},
    approvedPerType = {},
    types = [],
    granularStatus = null,
    onTypeChange,
}) => {
    const [editing, setEditing] = useState(null); // { day, type, anchorEl }

    const window = useMemo(() => computeSharedWindow(perTypeHours), [perTypeHours]);
    const span = window.end - window.start || 1;

    const openCell = (e, day, type) => {
        setEditing({ day, type, anchorEl: e.currentTarget });
    };
    const closeCell = () => setEditing(null);

    const changeDay = (typeValue, day, newSlots) => {
        const dayMap = { ...(perTypeHours[typeValue] || {}) };
        if (newSlots.length > 0) dayMap[day] = newSlots;
        else delete dayMap[day];
        onTypeChange(typeValue, dayMap);
    };

    const copyToAllDays = (typeValue, slots) => {
        const dayMap = {};
        DAYS.forEach((d) => { dayMap[d] = slots.map((s) => ({ ...s })); });
        onTypeChange(typeValue, dayMap);
        closeCell();
    };

    const gridTemplateColumns = `72px repeat(${types.length}, minmax(112px, 1fr))`;

    return (
        <Box>
            {/* Scale legend */}
            <Box display="flex" justifyContent="flex-end" mb={0.5}>
                <Typography variant="caption" color="text.secondary">
                    Timeline: {formatTime12h(`${String(window.start / 60 | 0).padStart(2, '0')}:00`)}
                    {' – '}
                    {formatTime12h(`${String(window.end / 60 | 0).padStart(2, '0')}:00`)}
                    {' · click any cell to edit'}
                </Typography>
            </Box>

            <Box sx={{ overflowX: 'auto', pb: 1 }}>
                <Box sx={{ minWidth: 72 + types.length * 112, display: 'grid', gridTemplateColumns, gap: 1 }}>
                    {/* ── Header row ── */}
                    <Box />
                    {types.map((t) => {
                        const status = granularStatus?.working_hours?.[t.value]?.status;
                        const weekHours = DAYS.reduce(
                            (sum, d) => sum + slotsTotalHours(perTypeHours[t.value]?.[d] || []),
                            0,
                        );
                        return (
                            <Box
                                key={t.value}
                                sx={{ textAlign: 'center', px: 0.5, pb: 0.5 }}
                            >
                                <Box display="flex" alignItems="center" justifyContent="center" gap={0.5}>
                                    <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: t.color }} />
                                    <Typography variant="caption" fontWeight="bold" noWrap>
                                        {t.shortLabel || t.label}
                                    </Typography>
                                    {status && STATUS_COLOR[status] && (
                                        <Tooltip title={`Working hours: ${status}`}>
                                            <FiberManualRecordIcon sx={{ fontSize: 8, color: STATUS_COLOR[status] }} />
                                        </Tooltip>
                                    )}
                                </Box>
                                <Typography variant="caption" color="text.secondary">
                                    {weekHours > 0 ? `${formatHours(weekHours)}/wk` : '—'}
                                </Typography>
                            </Box>
                        );
                    })}

                    {/* ── Day rows ── */}
                    {DAYS.map((day) => (
                        <React.Fragment key={day}>
                            <Box
                                sx={{
                                    display: 'flex', alignItems: 'center',
                                    fontWeight: 600, fontSize: '0.8rem', color: 'text.secondary',
                                }}
                            >
                                {DAY_SHORT[day]}
                            </Box>
                            {types.map((t) => {
                                const slots = perTypeHours[t.value]?.[day] || [];
                                const approved = approvedPerType[t.value]?.[day] || [];
                                const hasSlots = slots.length > 0;
                                const hours = slotsTotalHours(slots);
                                const modified = !sameDaySlots(slots, approved);
                                const isOpen = editing?.day === day && editing?.type?.value === t.value;

                                return (
                                    <Box
                                        key={t.value}
                                        onClick={(e) => openCell(e, day, t)}
                                        sx={{
                                            cursor: 'pointer',
                                            borderRadius: 1.5,
                                            border: '1px solid',
                                            borderColor: isOpen ? t.color : 'divider',
                                            bgcolor: hasSlots ? 'background.paper' : 'action.hover',
                                            p: 0.75,
                                            minHeight: 52,
                                            display: 'flex',
                                            flexDirection: 'column',
                                            justifyContent: 'center',
                                            gap: 0.5,
                                            transition: 'border-color .15s, box-shadow .15s',
                                            '&:hover': {
                                                borderColor: t.color,
                                                boxShadow: 1,
                                                '& .add-hint': { opacity: 0.6 },
                                            },
                                        }}
                                    >
                                        {hasSlots ? (
                                            <>
                                                <Box display="flex" alignItems="center" justifyContent="space-between">
                                                    <Typography variant="caption" fontWeight="bold">
                                                        {formatHours(hours)}
                                                    </Typography>
                                                    {modified && (
                                                        <Tooltip title="Differs from approved — will be submitted for approval">
                                                            <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: 'warning.main' }} />
                                                        </Tooltip>
                                                    )}
                                                </Box>
                                                {/* Timeline bar */}
                                                <Tooltip
                                                    title={slots.map((s) => `${formatTime12h(s.start)} – ${formatTime12h(s.end)}`).join(', ')}
                                                >
                                                    <Box
                                                        sx={{
                                                            position: 'relative', height: 10, borderRadius: 5,
                                                            bgcolor: 'action.selected', overflow: 'hidden',
                                                        }}
                                                    >
                                                        {slots.map((s, i) => {
                                                            const st = toMins(s.start);
                                                            const en = toMins(s.end);
                                                            if (en <= st) return null;
                                                            const left = ((st - window.start) / span) * 100;
                                                            const width = ((en - st) / span) * 100;
                                                            return (
                                                                <Box
                                                                    key={i}
                                                                    sx={{
                                                                        position: 'absolute', top: 0, bottom: 0,
                                                                        left: `${Math.max(0, left)}%`,
                                                                        width: `${Math.min(100 - Math.max(0, left), width)}%`,
                                                                        bgcolor: t.color, borderRadius: 5,
                                                                    }}
                                                                />
                                                            );
                                                        })}
                                                    </Box>
                                                </Tooltip>
                                            </>
                                        ) : (
                                            <Box
                                                className="add-hint"
                                                sx={{
                                                    opacity: 0, transition: 'opacity .15s',
                                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                    color: 'text.secondary', gap: 0.25,
                                                }}
                                            >
                                                <AddIcon sx={{ fontSize: 14 }} />
                                                <Typography variant="caption">Add</Typography>
                                            </Box>
                                        )}
                                    </Box>
                                );
                            })}
                        </React.Fragment>
                    ))}
                </Box>
            </Box>

            {/* Cell editor */}
            {editing && (
                <DayHoursEditor
                    open
                    anchorEl={editing.anchorEl}
                    onClose={closeCell}
                    day={editing.day}
                    type={editing.type}
                    slots={perTypeHours[editing.type.value]?.[editing.day] || []}
                    approvedSlots={approvedPerType[editing.type.value]?.[editing.day] || []}
                    status={granularStatus?.working_hours?.[editing.type.value]?.status}
                    onChangeDay={(newSlots) => changeDay(editing.type.value, editing.day, newSlots)}
                    onCopyToAllWeekdays={(slots) => copyToAllDays(editing.type.value, slots)}
                />
            )}
        </Box>
    );
};

export default WeeklyHoursGraph;
