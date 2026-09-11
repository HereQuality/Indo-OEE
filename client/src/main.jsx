import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import App from "./App.jsx";
import "bootstrap/dist/css/bootstrap.min.css";
import "./index.css";
import { MenuProvider } from "./context/MenuContext";
import { AuthProvider } from "./context/AuthContext";
import { SocketProvider } from "./context/SocketContext";
import { AlertProvider } from "./context/AlertContext";
import { ThemeProvider } from "./context/ThemeContext";
import ErrorBoundary from "./Components/Common/ErrorBoundary";

// Shared cache for reference data (roles, departments, ...) that rarely
// changes. staleTime: 2 min means switching between pages that both need
// "the roles list" reuses the same cached copy instead of hitting the
// server again every time. A create/update/delete mutation still
// explicitly invalidates the relevant key, so edits show up immediately.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 2 * 60 * 1000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

ReactDOM.createRoot(document.getElementById("root")).render(
  <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <AlertProvider>
            <AuthProvider>
              <SocketProvider>
              <MenuProvider>
                <ThemeProvider>
                  <App />
                </ThemeProvider>
              </MenuProvider>
              </SocketProvider>
            </AuthProvider>
          </AlertProvider>
        </BrowserRouter>
    </QueryClientProvider>
  </ErrorBoundary>
);