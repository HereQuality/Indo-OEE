import { useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getAppUpdateStatus, updateAppUpdate } from "../api/appUpdate.api";
import { useSocket } from "../context/SocketContext";

export const APP_UPDATE_QUERY_KEY = ["appUpdateStatus"];

// Admin-only config panel (Components/Common/AppUpdateModeCard, embedded in
// CompanyManagement) — the only consumer on web. No polling here: unlike
// Maintenance/Announcement this never gates the WEB app itself (a browser
// always serves the latest build on refresh), it only configures what the
// MOBILE app enforces — see app_update_provider.dart. A plain mount-time
// fetch covers the initial load; the socket listener below is just so
// `reportedVersion` (set by mobile/scripts/
// report_version.sh, not by anyone on this page) shows up live if an admin
// has this page open right when a build gets reported, instead of needing
// a manual refresh.
export const useAppUpdateStatus = () => {
  const queryClient = useQueryClient();
  const { socket } = useSocket();

  const query = useQuery({
    queryKey: APP_UPDATE_QUERY_KEY,
    queryFn: async () => {
      const res = await getAppUpdateStatus();
      if (res.data && res.data.data) return res.data.data;
      return {
        isActive: false,
        minVersion: "",
        latestVersion: "",
        reportedVersion: "",
        reportedAt: null,
        message: "",
        softMessage: "",
        updatedAt: null,
      };
    },
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  useEffect(() => {
    if (!socket) return undefined;
    const onUpdate = (payload) => {
      queryClient.setQueryData(APP_UPDATE_QUERY_KEY, payload);
    };
    socket.on("app-update:update", onUpdate);
    return () => socket.off("app-update:update", onUpdate);
  }, [socket, queryClient]);

  return query;
};

export const useUpdateAppUpdate = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data) => {
      const res = await updateAppUpdate(data);
      return res.data;
    },
    onSuccess: (res) => {
      if (res?.data) queryClient.setQueryData(APP_UPDATE_QUERY_KEY, res.data);
      queryClient.invalidateQueries({ queryKey: APP_UPDATE_QUERY_KEY });
    },
  });
};
