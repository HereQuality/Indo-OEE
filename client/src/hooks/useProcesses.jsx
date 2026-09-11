import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getAllProcesses } from "../api/process.api";

export const PROCESSES_QUERY_KEY = ["processes", "all"];

export const useProcesses = (options = {}) => {
  return useQuery({
    queryKey: PROCESSES_QUERY_KEY,
    queryFn: async () => {
      const response = await getAllProcesses();
      return response?.data?.data || [];
    },
    ...options,
  });
};

export const useInvalidateProcesses = () => {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: PROCESSES_QUERY_KEY });
};
