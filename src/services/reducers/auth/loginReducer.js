import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import { toast } from "react-toastify";
import authService from '../../actions/authAction';



const initialState = {
    user: null,
    loading: false,
    error: false,
    success: false,
    message: null,
    token: null,
}


//LOGIN USER

export const loginAction = createAsyncThunk(
    "loginAction",
    async ({email, password}, thunkAPI) => {
        try {
            return await authService.loginAccount({email, password});
        } catch (error) {
            const message =
              (error.response &&
                error.response.data &&
                error.response.data.message) ||
              error.message ||
              error.toString();
            toast.warning(`${message}`);
            return thunkAPI.rejectWithValue(message);
          }
    }
)

//CREATE THE SLICE

export const authLoginSlice = createSlice({
    name: "authLogin",
    initialState,
    reducers: {
        //non asynchronous reducers goes here   
        reset: (state) => {
            state.loading = false;
            state.error = false;
            state.success = false;
            state.message = "";
            state.user = {};
            state.token = null;
        },
    },


    extraReducers: (builder) => {
        builder
            .addCase(loginAction.pending, (state) => {
                state.loading = true;
            })
            .addCase(loginAction.fulfilled, (state, action) => {
                console.log(action.payload, "ON SUCCESS")
                state.loading = false;
                state.success = true;
                state.user = action.payload?.data?.user
                state.token = action.payload?.data.token
            })
            .addCase(loginAction.rejected, (state, action) => {
                state.loading = false;
                state.error = true;
                state.message = action.payload;
                state.user = null;
            })
    }
})


export const { reset } = authLoginSlice.actions;

export default authLoginSlice.reducer;