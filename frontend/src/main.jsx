// src/main.jsx
import React from "react";
import ReactDOM from "react-dom/client";
import { Provider } from "react-redux";
import { store } from "@/app/store";
import { BrowserRouter } from "react-router-dom";
import { GoogleOAuthProvider } from "@react-oauth/google";
import { ToastProvider } from "@/contexts/ToastContext";
import ErrorBoundary from "@/components/util/ErrorBoundary";
import AppRoutes from "./routes.jsx";

import "@/styles/reset.css";
import "@/styles/base.css";
import "@/styles/loader.css";
import "@/styles/toast.css";

const googleEnabled =
  import.meta.env.VITE_ENABLE_GOOGLE === "true" &&
  Boolean(import.meta.env.VITE_GOOGLE_CLIENT_ID);

const appTree = (
  <Provider store={store}>
    <ToastProvider>
      <BrowserRouter>
        <ErrorBoundary>
          <AppRoutes />
        </ErrorBoundary>
      </BrowserRouter>
    </ToastProvider>
  </Provider>
);

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {googleEnabled ? (
      <GoogleOAuthProvider clientId={import.meta.env.VITE_GOOGLE_CLIENT_ID}>
        {appTree}
      </GoogleOAuthProvider>
    ) : (
      appTree
    )}
  </React.StrictMode>
);
