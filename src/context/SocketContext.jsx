import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import { AuthContext } from "./AuthContext";

/**
 * context/SocketContext.jsx
 * ────────────────────────────
 * One socket.io connection for the whole app, created once the session is
 * verified and torn down on logout. Notifications (bell) and the support
 * chat (Support.jsx) both read from this same connection instead of each
 * opening their own — avoids duplicate connections and duplicate "join"
 * race conditions.
 *
 * The server only lets a socket join a specific person's room after
 * verifying the same JWT the REST API uses (see server/socket/index.js) —
 * so this reads the same "token" cookie api/index.jsx sends as the
 * Authorization header.
 */
const SocketContext = createContext({ socket: null, connected: false });

const getCookieValue = (name) => {
  const match = document.cookie.split("; ").find((row) => row.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.split("=")[1]) : null;
};

export const SocketProvider = ({ children }) => {
  const { adminData, isSessionVerified } = useContext(AuthContext);
  const [connected, setConnected] = useState(false);
  const socketRef = useRef(null);

  useEffect(() => {
    if (!isSessionVerified || !adminData?._id) {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
        setConnected(false);
      }
      return undefined;
    }

    const base = String(import.meta.env.VITE_API_BASE_URL || "").trim();
    if (!base) return undefined;

    const socket = io(base, { transports: ["websocket", "polling"] });
    socketRef.current = socket;

    const doJoin = () => {
      const token = getCookieValue("token") || localStorage.getItem("token");
      if (token) socket.emit("join", token);
    };

    socket.on("connect", () => {
      setConnected(true);
      doJoin();
    });
    socket.on("disconnect", () => setConnected(false));

    return () => {
      socket.off("connect");
      socket.off("disconnect");
      socket.disconnect();
      socketRef.current = null;
      setConnected(false);
    };
  }, [isSessionVerified, adminData?._id]);

  return (
    <SocketContext.Provider value={{ socket: socketRef.current, connected }}>
      {children}
    </SocketContext.Provider>
  );
};

export const useSocket = () => useContext(SocketContext);
