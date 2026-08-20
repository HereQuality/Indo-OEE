import React, { useContext } from "react";
import { Navigate } from "react-router-dom";
import { AuthContext } from "../context/AuthContext";
import { getRoleSlug } from "../utils/roleUrl";

export default function NotFoundFallback() {
  const { adminData, isSessionVerified } = useContext(AuthContext);

  if (!isSessionVerified) return null; // Wait for session check to complete

  // If user is logged in, redirect them to their specific home
  if (adminData) {
    const slug = getRoleSlug(adminData) || "employee";
    return <Navigate to={adminData?.redirectUrl || `/${slug}/home`} replace />;
  }

  // If not logged in, redirect them to landing
  return <Navigate to="/" replace />;
}
