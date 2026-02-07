import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { authApi } from "@/api/authApi";

const initialState = {
  user: null,
  status: "idle", // idle | loading | succeeded | failed
  error: null,
  otp_required: false,
};

export const loadMe = createAsyncThunk("auth/me", async (_, { rejectWithValue }) => {
  try {
    const me = await authApi.me();
    return me;
  } catch (e) {
    return rejectWithValue(authApi.normalizeError(e));
  }
});

export const login = createAsyncThunk(
  "auth/login",
  async ({ email, password, otp }, { dispatch, rejectWithValue }) => {
    try {
      const data = await authApi.login({ email, password, otp });

      // 202 => requiere OTP (NO hay tokens todavía)
      if (data?.require_otp || data?.otp_required) {
        return { require_otp: true };
      }

      // 200 => sesión OK (cookies)
      await dispatch(loadMe());

      return data;
    } catch (e) {
      return rejectWithValue(authApi.normalizeError(e));
    }
  }
);

export const googleLogin = createAsyncThunk(
  "auth/googleLogin",
  async ({ idToken }, { dispatch, rejectWithValue }) => {
    try {
      const data = await authApi.googleLogin({ idToken });
      await dispatch(loadMe());
      return data;
    } catch (e) {
      return rejectWithValue(authApi.normalizeError(e));
    }
  }
);

export const register = createAsyncThunk("auth/register", async (payload, { rejectWithValue }) => {
  try {
    return await authApi.register(payload);
  } catch (e) {
    return rejectWithValue(authApi.normalizeError(e));
  }
});

export const logout = createAsyncThunk("auth/logout", async (_, { rejectWithValue }) => {
  try {
    await authApi.logout();
    return true;
  } catch (e) {
    return rejectWithValue(authApi.normalizeError(e));
  }
});

const authSlice = createSlice({
  name: "auth",
  initialState,
  reducers: {
    clearAuthError(state) {
      state.error = null;
    },
    setAuthError(state, action) {
      state.error = action.payload || "Error";
    },
    clearSession(state) {
      state.user = null;
      state.status = "idle";
      state.error = null;
      state.otp_required = false;
    },
    setOtpRequired(state, action) {
      state.otp_required = !!action.payload;
    },
  },
  extraReducers: (b) => {
    b
      // loadMe
      .addCase(loadMe.pending, (s) => {
        s.status = "loading";
        s.error = null;
      })
      .addCase(loadMe.fulfilled, (s, a) => {
        s.status = "succeeded";
        s.user = a.payload;
      })
      .addCase(loadMe.rejected, (s, a) => {
        s.status = "failed";
        s.user = null;
        s.error = a.payload || "No se pudo cargar el usuario.";
      })

      // login
      .addCase(login.pending, (s) => {
        s.status = "loading";
        s.error = null;
      })
      .addCase(login.fulfilled, (s, a) => {
        s.status = "succeeded";
        if (a.payload?.require_otp) {
          s.otp_required = true;
        } else {
          s.otp_required = false;
        }
      })
      .addCase(login.rejected, (s, a) => {
        s.status = "failed";
        s.error = a.payload || "Error al iniciar sesión.";
      })

      // googleLogin
      .addCase(googleLogin.pending, (s) => {
        s.status = "loading";
        s.error = null;
      })
      .addCase(googleLogin.fulfilled, (s) => {
        s.status = "succeeded";
        s.otp_required = false;
      })
      .addCase(googleLogin.rejected, (s, a) => {
        s.status = "failed";
        s.error = a.payload || "Error con Google.";
      })

      // register
      .addCase(register.pending, (s) => {
        s.status = "loading";
        s.error = null;
      })
      .addCase(register.fulfilled, (s) => {
        s.status = "succeeded";
      })
      .addCase(register.rejected, (s, a) => {
        s.status = "failed";
        s.error = a.payload || "Error al registrar.";
      })

      // logout
      .addCase(logout.fulfilled, (s) => {
        s.user = null;
        s.status = "idle";
        s.error = null;
        s.otp_required = false;
      });
  },
});

export const {
  clearAuthError,
  clearSession,
  setAuthError,
  setOtpRequired,
} = authSlice.actions;

export default authSlice.reducer;
