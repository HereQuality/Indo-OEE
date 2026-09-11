import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getAllMachines } from "../api/machines.api";

export const MACHINES_QUERY_KEY = ["machines", "all"];

export const useMachines = (options = {}) => {
  return useQuery({
    queryKey: MACHINES_QUERY_KEY,
    queryFn: async () => {
      const response = await getAllMachines();
      return response?.data?.data || [];
    },
    ...options,
  });
};

export const useInvalidateMachines = () => {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: MACHINES_QUERY_KEY });
};
