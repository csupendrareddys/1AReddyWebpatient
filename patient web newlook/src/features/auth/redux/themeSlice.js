import { createSlice } from '@reduxjs/toolkit';

// Dark-mode kill switch.
//
// Set to ``false`` to lock the app to light mode. The MUI ``darkTheme``
// import + the per-component ``isDarkMode`` boolean still flow through
// the codebase (so we don't have to rip the wiring out yet), but the
// slice always reports ``false`` and the toggle reducers are no-ops.
// Most of the per-component dark palettes were never carried through
// the recent landing / page-config / admin redesigns; turning the
// toggle on right now visibly breaks colour combos across multiple
// pages. Re-enable by flipping this single constant once those
// palettes are restored end-to-end.
//
// To re-enable: set ``DARK_MODE_ENABLED = true`` and the existing
// toggle / persistence logic resumes. The toggle buttons in the
// top bars are also gated on this flag — they hide when disabled.
export const DARK_MODE_ENABLED = false;

// Check localStorage for saved theme preference (only consulted when
// the kill switch is OFF).
const getInitialTheme = () => {
    if (!DARK_MODE_ENABLED) return false;
    if (typeof window !== 'undefined') {
        const savedTheme = localStorage.getItem('theme');
        if (savedTheme) {
            return savedTheme === 'dark';
        }
        // Check system preference
        return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    return false;
};

const initialState = {
    isDarkMode: getInitialTheme(),
};

const themeSlice = createSlice({
    name: 'theme',
    initialState,
    reducers: {
        toggleTheme: (state) => {
            if (!DARK_MODE_ENABLED) {
                // Kill switch is on — refuse to switch into dark mode
                // even if a stale dispatch comes in. Leave any prior
                // localStorage value alone (re-enabling restores it).
                state.isDarkMode = false;
                return;
            }
            state.isDarkMode = !state.isDarkMode;
            localStorage.setItem('theme', state.isDarkMode ? 'dark' : 'light');
        },
        setDarkMode: (state, action) => {
            if (!DARK_MODE_ENABLED) {
                state.isDarkMode = false;
                return;
            }
            state.isDarkMode = action.payload;
            localStorage.setItem('theme', action.payload ? 'dark' : 'light');
        },
    },
});

export const { toggleTheme, setDarkMode } = themeSlice.actions;
export default themeSlice.reducer;
