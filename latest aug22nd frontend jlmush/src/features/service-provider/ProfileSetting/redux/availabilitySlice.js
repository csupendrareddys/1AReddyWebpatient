import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  availableDays: [],
  availableSlots: {},
  
};

const availabilitySlice = createSlice({
  name: 'availability',
  initialState,
  reducers: {
    toggleDay: (state, action) => {
      const date = action.payload;
      if (state.availableDays.includes(date)) {
        state.availableDays = state.availableDays.filter(d => d !== date);
        delete state.availableSlots[date];
      } else {
        state.availableDays.push(date);
      }
    },

    updateSlots: (state, action) => {
      const { date, slots } = action.payload;
      state.availableSlots[date] = slots;
    },

    bulkUpdateSlots: (state, action) => {
      const updates = action.payload;
      Object.keys(updates).forEach(date => {
        state.availableSlots[date] = updates[date];
        if (!state.availableDays.includes(date)) {
          state.availableDays.push(date);
        }
      });
    }
  }
});

export const {
  toggleDay,
  updateSlots,
  bulkUpdateSlots
} = availabilitySlice.actions;

export default availabilitySlice.reducer;