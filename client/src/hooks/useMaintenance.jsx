import { useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getMaintenanceStatus, updateMaintenance } from "../api/maintenance.api";
import { useSocket } from "../context/SocketContext";

export const MAINTENANCE_QUERY_KEY = ["maintenanceStatus"];

// No more polling timer — updates arrive live via the "maintenance:update"
// socket push below instead. `staleTime: Infinity` means React Query never
// re-fetches this on its own; the only network calls left are the initial
// load and an explicit resync whenever the socket (re)connects (covers a
// dropped connection, or a change that landed in the gap before this
// tab's very first connect).
//
// `poll: false` for any call site that's just READING the cache (e.g. a
// settings-page card) rather than owning the app-wide check — App.jsx
// already owns the socket listener + resync for the whole session, so a
// second listener/resync on the same query key would be redundant.
export const useMaintenanceStatus = ({ poll = true } = {}) => {
  const queryClient = useQueryClient();
  const { socket } = useSocket();

  const query = useQuery({
    queryKey: MAINTENANCE_QUERY_KEY,
    queryFn: async () => {
      const res = await getMaintenanceStatus();
      if (res.data && res.data.data) return res.data.data;
      return { isActive: false, message: "", scheduledAt: null, updatedAt: null };
    },
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    // A failed check must never itself block the app — fall back to
    // whatever was last known (react-query keeps serving the last good
    // `data` while an error sits alongside it) rather than throwing.
    retry: 1,
  });

  useEffect(() => {
    if (!socket || !poll) return undefined;

    // server/socket/index.js emits this on every save — reacts instantly
    // instead of waiting for anything.
    const onUpdate = (payload) => {
      queryClient.setQueryData(MAINTENANCE_QUERY_KEY, payload);
    };
    socket.on("maintenance:update", onUpdate);

    // Resync once per (re)connect — not a timer, only fires on an actual
    // connection event (first login, reconnect after a dropped socket,
    // laptop wake from sleep, ...), so it can never turn into a recurring
    // background poll.
    const onConnect = () => queryClient.invalidateQueries({ queryKey: MAINTENANCE_QUERY_KEY });
    socket.on("connect", onConnect);

    return () => {
      socket.off("maintenance:update", onUpdate);
      socket.off("connect", onConnect);
    };
  }, [socket, poll, queryClient]);

  return query;
};

export const useUpdateMaintenance = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data) => {
      const res = await updateMaintenance(data);
      return res.data;
    },
    onSuccess: (res) => {
      if (res?.data) queryClient.setQueryData(MAINTENANCE_QUERY_KEY, res.data);
      queryClient.invalidateQueries({ queryKey: MAINTENANCE_QUERY_KEY });
    },
  });
};
