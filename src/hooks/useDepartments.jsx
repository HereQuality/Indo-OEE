import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getAllDepartments } from "../api/departments.api";

export const DEPARTMENTS_QUERY_KEY = ["departments", "all"];

export const useDepartments = (options = {}) => {
  return useQuery({
    queryKey: DEPARTMENTS_QUERY_KEY,
    queryFn: async () => {
      const response = await getAllDepartments();
      return response?.data?.data || [];
    },
    ...options,
  });
};

export const useInvalidateDepartments = () => {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: DEPARTMENTS_QUERY_KEY });
};
