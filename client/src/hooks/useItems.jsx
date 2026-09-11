import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getAllItems } from "../api/items.api";

export const ITEMS_QUERY_KEY = ["items", "all"];

export const useItems = (options = {}) => {
  return useQuery({
    queryKey: ITEMS_QUERY_KEY,
    queryFn: async () => {
      const response = await getAllItems();
      return response?.data?.data || [];
    },
    ...options,
  });
};

export const useInvalidateItems = () => {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ITEMS_QUERY_KEY });
};
