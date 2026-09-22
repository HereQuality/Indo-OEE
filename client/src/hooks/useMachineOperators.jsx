import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getAllMachineOperators } from "../api/machineOperators.api";

export const MACHINE_OPERATORS_QUERY_KEY = ["machineOperators", "all"];

export const useMachineOperators = (options = {}) => {
  return useQuery({
    queryKey: MACHINE_OPERATORS_QUERY_KEY,
    queryFn: async () => {
      const response = await getAllMachineOperators();
      return response?.data?.data || [];
    },
    ...options,
  });
};

export const useInvalidateMachineOperators = () => {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: MACHINE_OPERATORS_QUERY_KEY });
};
