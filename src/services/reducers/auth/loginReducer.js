import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { toast } from 'react-toastify';
import authService, { clearStoredAuth, getStoredAuth, persistAuth } from '../../actions/authAction';

const cachedAuth = getStoredAuth();

const initialState = {
  user: cachedAuth?.user || null,
  loading: false,
  error: false,
  success: false,
  message: null,
  token: cachedAuth?.token || null,
  isAuthenticated: Boolean(cachedAuth?.token),
};

export const loginAction = createAsyncThunk('loginAction', async ({ email, password }, thunkAPI) => {
  try {
    return await authService.loginAccount({ email, password });
  } catch (error) {
    const message =
      (error.response && error.response.data && error.response.data.message) ||
      error.message ||
      error.toString();
    toast.warning(`${message}`);
    return thunkAPI.rejectWithValue(message);
  }
});

export const authLoginSlice = createSlice({
  name: 'authLogin',
  initialState,
  reducers: {
    reset: (state) => {
      state.loading = false;
      state.error = false;
      state.success = false;
      state.message = '';
    },
    setAuthenticatedUser: (state, action) => {
      state.user = action.payload.user;
      state.token = action.payload.token;
      state.isAuthenticated = true;
      persistAuth({ user: action.payload.user, token: action.payload.token });
    },
    logout: (state) => {
      state.user = null;
      state.token = null;
      state.isAuthenticated = false;
      state.loading = false;
      state.error = false;
      state.success = false;
      state.message = null;
      clearStoredAuth();
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(loginAction.pending, (state) => {
        state.loading = true;
      })
      .addCase(loginAction.fulfilled, (state, action) => {
        state.loading = false;
        state.success = true;
        state.user = action.payload?.data?.user;
        state.token = action.payload?.data?.token;
        state.isAuthenticated = Boolean(action.payload?.data?.token);
        persistAuth({
          user: action.payload?.data?.user,
          token: action.payload?.data?.token,
        });
      })
      .addCase(loginAction.rejected, (state, action) => {
        state.loading = false;
        state.error = true;
        state.message = action.payload;
        state.user = null;
        state.token = null;
        state.isAuthenticated = false;
      });
  },
});

export const { reset, logout, setAuthenticatedUser } = authLoginSlice.actions;

export default authLoginSlice.reducer;
