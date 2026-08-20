import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getAllEmployees } from "../api/employees.api";

export const EMPLOYEES_QUERY_KEY = ["employees", "all"];

export const useEmployees = (options = {}) => {
  return useQuery({
    queryKey: EMPLOYEES_QUERY_KEY,
    queryFn: async () => {
      const response = await getAllEmployees();
      return response?.data?.data || [];
    },
    ...options,
  });
};

export const useInvalidateEmployees = () => {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: EMPLOYEES_QUERY_KEY });
};
