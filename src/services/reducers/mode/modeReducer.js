import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  isOnline: true,
};

export const modeSlice = createSlice({
  name: 'mode',
  initialState,
  reducers: {
    toggleMode: (state) => {
      state.isOnline = !state.isOnline;
    },
  },
});

export const { toggleMode } = modeSlice.actions;
export default modeSlice.reducer;
