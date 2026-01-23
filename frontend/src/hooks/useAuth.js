import { useCallback } from "react";
import { useDispatch, useSelector } from "react-redux";

import { selectAuth } from "@/app/store";
import {
  clearAuthError,
  clearSession,
  loadMe,
  login,
  logout,
  register,
  googleLogin,
  setAuthError,
  setOtpRequired,
} from "@/features/auth/authSlice";

export default function useAuth() {
  const dispatch = useDispatch();
  const auth = useSelector(selectAuth);

  const doLogin = useCallback((payload) => dispatch(login(payload)), [dispatch]);
  const doRegister = useCallback((payload) => dispatch(register(payload)), [dispatch]);
  const doGoogleLogin = useCallback((payload) => dispatch(googleLogin(payload)), [dispatch]);
  const doLoadMe = useCallback(() => dispatch(loadMe()), [dispatch]);

  const doLogout = useCallback(async () => {
    await dispatch(logout());
    dispatch(clearSession());
  }, [dispatch]);

  const clearError = useCallback(() => dispatch(clearAuthError()), [dispatch]);
  const setError = useCallback((msg) => dispatch(setAuthError(msg)), [dispatch]);
  const setOtp = useCallback((v) => dispatch(setOtpRequired(v)), [dispatch]);

  return {
    ...auth,
    login: doLogin,
    register: doRegister,
    googleLogin: doGoogleLogin,
    loadMe: doLoadMe,
    logout: doLogout,
    clearError,
    setError,
    setOtpRequired: setOtp,
  };
}
