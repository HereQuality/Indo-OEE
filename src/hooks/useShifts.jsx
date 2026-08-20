import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getAllShifts } from "../api/shifts.api";

export const SHIFTS_QUERY_KEY = ["shifts", "all"];

export const useShifts = (options = {}) => {
  return useQuery({
    queryKey: SHIFTS_QUERY_KEY,
    queryFn: async () => {
      const response = await getAllShifts();
      return response?.data?.data || [];
    },
    ...options,
  });
};

export const useInvalidateShifts = () => {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: SHIFTS_QUERY_KEY });
};
