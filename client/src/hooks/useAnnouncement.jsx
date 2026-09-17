import { useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getAnnouncementStatus, updateAnnouncement } from "../api/announcement.api";
import { useSocket } from "../context/SocketContext";

export const ANNOUNCEMENT_QUERY_KEY = ["announcementStatus"];

// Same no-more-polling design as useMaintenanceStatus — see that file for
// the full reasoning. Updates arrive live via the "announcement:update"
// socket push; the only other network calls are the initial load and a
// resync on socket (re)connect.
export const useAnnouncementStatus = ({ poll = true } = {}) => {
  const queryClient = useQueryClient();
  const { socket } = useSocket();

  const query = useQuery({
    queryKey: ANNOUNCEMENT_QUERY_KEY,
    queryFn: async () => {
      const res = await getAnnouncementStatus();
      if (res.data && res.data.data) return res.data.data;
      return { isActive: false, message: "", startDate: null, endDate: null, updatedAt: null, isLive: false };
    },
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  useEffect(() => {
    if (!socket || !poll) return undefined;

    // server emits this on every save.
    const onUpdate = (payload) => {
      queryClient.setQueryData(ANNOUNCEMENT_QUERY_KEY, payload);
    };
    socket.on("announcement:update", onUpdate);

    // Resync once per (re)connect, not a timer — see useMaintenanceStatus.
    const onConnect = () => queryClient.invalidateQueries({ queryKey: ANNOUNCEMENT_QUERY_KEY });
    socket.on("connect", onConnect);

    return () => {
      socket.off("announcement:update", onUpdate);
      socket.off("connect", onConnect);
    };
  }, [socket, poll, queryClient]);

  return query;
};

export const useUpdateAnnouncement = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data) => {
      const res = await updateAnnouncement(data);
      return res.data;
    },
    onSuccess: (res) => {
      if (res?.data) queryClient.setQueryData(ANNOUNCEMENT_QUERY_KEY, res.data);
      queryClient.invalidateQueries({ queryKey: ANNOUNCEMENT_QUERY_KEY });
    },
  });
};
