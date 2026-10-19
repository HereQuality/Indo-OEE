import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getAllVendors } from "../api/vendors.api";

export const VENDORS_QUERY_KEY = ["vendors", "all"];

export const useVendors = (options = {}) => {
  return useQuery({
    queryKey: VENDORS_QUERY_KEY,
    queryFn: async () => {
      const response = await getAllVendors();
      return response?.data?.data || [];
    },
    ...options,
  });
};

export const useInvalidateVendors = () => {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: VENDORS_QUERY_KEY });
};
