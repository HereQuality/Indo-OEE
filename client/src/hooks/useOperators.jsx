import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getAllOperators } from "../api/operators.api";

export const OPERATORS_QUERY_KEY = ["operators", "all"];

export const useOperators = (options = {}) => {
  return useQuery({
    queryKey: OPERATORS_QUERY_KEY,
    queryFn: async () => {
      const response = await getAllOperators();
      return response?.data?.data || [];
    },
    ...options,
  });
};

export const useInvalidateOperators = () => {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: OPERATORS_QUERY_KEY });
};
