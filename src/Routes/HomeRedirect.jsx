import React, { useContext } from "react";
import { Navigate } from "react-router-dom";
import { AuthContext } from "../context/AuthContext";
import { getRoleSlug } from "../utils/roleUrl";
import FullPageLoader from "../Components/Common/FullPageLoader";

export default function HomeRedirect() {
  const { adminData, isSessionVerified } = useContext(AuthContext);

  if (!isSessionVerified) return <FullPageLoader label="Verifying your session..." />;

  if (!adminData) return <Navigate to="/login" replace />;

  const slug = getRoleSlug(adminData) || "employee";

  // Everyone goes to /home
  const homePath = `/${slug}/home`;

  return <Navigate to={homePath} replace />;
}