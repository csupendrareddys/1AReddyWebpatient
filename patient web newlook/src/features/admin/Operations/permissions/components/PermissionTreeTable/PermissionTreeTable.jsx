/**
 * PermissionTreeTable — the roles-and-permissions grid, drawn over a tree.
 *
 * Purely presentational: every piece of state and every decision about what a
 * tick means lives in ``usePermissionTree``. This file only decides how a row
 * LOOKS at its depth, and there are exactly three answers:
 *
 *   depth 0  group        a tinted full-width bar, expander only. No grants —
 *                         a group is a heading, not a thing you can do.
 *   depth 1+ branch       an indented roll-up row. Its checkboxes are derived
 *                         from the leaves below and show a dash when those
 *                         leaves disagree; ticking one fills every leaf in.
 *   leaf                  the real permission row — the row from the Roles &
 *                         Permissions screen this matrix is modelled on.
 *
 * That is what "go to the last possible sub-heading" means in practice: the
 * grant always lands on the deepest node, however deep that happens to be for
 * the branch you're looking at.
 */
import {
    Box, Checkbox, MenuItem, Paper, Select, Table, TableBody, TableCell,
    TableContainer, TableHead, TableRow, Typography,
} from '@mui/material';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowRightIcon from '@mui/icons-material/KeyboardArrowRight';

import { ACTION_COLUMNS, DATA_RANGES } from '../../constants/permissionTree';

// # + Module + every action + Data Range — the width a group bar spans.
const TOTAL_COLUMNS = ACTION_COLUMNS.length + 3;

const HEADER_BG = '#f8f9fa';
const GROUP_BG = '#f0f4ff';
const GROUP_FG = '#3b5998';
const BRANCH_BG = '#fbfcff';
const FULL_ACCESS_COLOR = '#7c3aed';
const CHECKED_COLOR = '#2563eb';

const Expander = ({ open }) => (open
    ? <KeyboardArrowDownIcon fontSize="small" sx={{ color: 'inherit' }} />
    : <KeyboardArrowRightIcon fontSize="small" sx={{ color: 'inherit' }} />);

const GrantCheckbox = ({ column, all, some, onChange }) => (
    <Checkbox
        size="small"
        checked={all}
        indeterminate={some}
        onChange={onChange}
        sx={{
            p: 0.5,
            color: column === 'full_access' ? FULL_ACCESS_COLOR : undefined,
            '&.Mui-checked, &.MuiCheckbox-indeterminate': {
                color: column === 'full_access' ? FULL_ACCESS_COLOR : CHECKED_COLOR,
            },
        }}
    />
);

const DataRangeSelect = ({ value, ranges, onChange }) => (
    <Select
        size="small"
        displayEmpty
        value={value}
        onChange={(e) => onChange(e.target.value)}
        // A blank value means the leaves below disagree. Saying "Mixed" is the
        // honest reading; picking one of them would misreport the rest.
        renderValue={(v) => (
            ranges.find((r) => r.value === v)?.label
            || <Box component="span" sx={{ color: 'text.disabled' }}>Mixed</Box>
        )}
        sx={{ fontSize: '0.8rem', minWidth: 130 }}
    >
        {ranges.map((range) => (
            <MenuItem key={range.value} value={range.value} sx={{ fontSize: '0.8rem' }}>
                {range.label}
            </MenuItem>
        ))}
    </Select>
);

export default function PermissionTreeTable({
    rows, expanded, onToggleExpand, grantFor, columnState, onToggle,
    onToggleColumnAll, dataRangeOf, onDataRangeChange, dataRanges,
}) {
    // The live verticals get the range list from the backend catalog, so
    // adding a window there needs no frontend change. The local constant is
    // the fallback for the preview entities, which have no catalog to fetch.
    const ranges = dataRanges?.length ? dataRanges : DATA_RANGES;
    // Numbering restarts inside each group, like the screen this mirrors.
    let rowNumber = 0;

    return (
        <TableContainer component={Paper} sx={{ borderRadius: 2, maxHeight: '68vh' }}>
            <Table stickyHeader size="small">
                <TableHead>
                    <TableRow>
                        <TableCell sx={{ fontWeight: 700, width: 56, bgcolor: HEADER_BG }}>#</TableCell>
                        {/* Wide enough for a third-level label at its indent,
                            narrow enough that Data Range still lands inside a
                            laptop viewport before the container has to scroll. */}
                        <TableCell sx={{ fontWeight: 700, minWidth: 270, bgcolor: HEADER_BG }}>
                            Module
                        </TableCell>
                        {ACTION_COLUMNS.map((col) => (
                            <TableCell
                                key={col.key}
                                align="center"
                                onClick={() => onToggleColumnAll(col.key)}
                                title={`Toggle ${col.label} for every module`}
                                sx={{
                                    fontWeight: 700,
                                    bgcolor: HEADER_BG,
                                    minWidth: 72,
                                    cursor: 'pointer',
                                    userSelect: 'none',
                                    '&:hover': { bgcolor: '#e9ecef' },
                                }}
                            >
                                {col.label}
                            </TableCell>
                        ))}
                        <TableCell sx={{ fontWeight: 700, minWidth: 140, bgcolor: HEADER_BG }}>
                            Data Range
                        </TableCell>
                    </TableRow>
                </TableHead>
                <TableBody>
                    {rows.map((row) => {
                        // Group bar — a heading, so it resets the counter and
                        // carries no grants of its own.
                        if (row.depth === 0 && !row.isLeaf) {
                            rowNumber = 0;
                            const open = expanded.has(row.path);
                            return (
                                <TableRow key={row.path}>
                                    <TableCell
                                        colSpan={TOTAL_COLUMNS}
                                        onClick={() => onToggleExpand(row.path)}
                                        sx={{
                                            bgcolor: GROUP_BG,
                                            color: GROUP_FG,
                                            fontWeight: 700,
                                            fontSize: '0.85rem',
                                            py: 1,
                                            cursor: 'pointer',
                                            userSelect: 'none',
                                            '&:hover': { bgcolor: '#e6ecff' },
                                        }}
                                    >
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                            <Expander open={open} />
                                            {row.label}
                                        </Box>
                                    </TableCell>
                                </TableRow>
                            );
                        }

                        rowNumber += 1;
                        const open = expanded.has(row.path);
                        const grant = row.isLeaf ? grantFor(row.path) : null;

                        return (
                            <TableRow
                                key={row.path}
                                hover
                                sx={row.isLeaf ? undefined : { bgcolor: BRANCH_BG }}
                            >
                                <TableCell sx={{ color: '#6b7280' }}>{rowNumber}</TableCell>
                                <TableCell
                                    sx={{
                                        pl: 1 + row.depth * 3,
                                        fontWeight: row.isLeaf ? 500 : 600,
                                        cursor: row.isLeaf ? 'default' : 'pointer',
                                        userSelect: 'none',
                                    }}
                                    onClick={row.isLeaf ? undefined : () => onToggleExpand(row.path)}
                                >
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                        {/* Leaves keep the same left edge as
                                            their siblings — the spacer stands
                                            in for the missing chevron. */}
                                        {row.isLeaf
                                            ? <Box sx={{ width: 20 }} />
                                            : <Expander open={open} />}
                                        {row.label}
                                    </Box>
                                </TableCell>
                                {ACTION_COLUMNS.map((col) => {
                                    const state = row.isLeaf
                                        ? { all: !!grant[col.key], some: false }
                                        : columnState(row.path, col.key);
                                    return (
                                        <TableCell key={col.key} align="center">
                                            <GrantCheckbox
                                                column={col.key}
                                                all={state.all}
                                                some={state.some}
                                                onChange={() => onToggle(row.path, col.key)}
                                            />
                                        </TableCell>
                                    );
                                })}
                                <TableCell>
                                    <DataRangeSelect
                                        value={row.isLeaf ? grant.data_range : dataRangeOf(row.path)}
                                        ranges={ranges}
                                        onChange={(value) => onDataRangeChange(row.path, value)}
                                    />
                                </TableCell>
                            </TableRow>
                        );
                    })}
                    {!rows.length && (
                        <TableRow>
                            <TableCell colSpan={TOTAL_COLUMNS} align="center" sx={{ py: 6 }}>
                                <Typography color="text.secondary">
                                    No modules defined for this entity yet.
                                </Typography>
                            </TableCell>
                        </TableRow>
                    )}
                </TableBody>
            </Table>
        </TableContainer>
    );
}
