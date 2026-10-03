import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getAllWorkOrders } from "../api/workOrders.api";

export const WORK_ORDERS_QUERY_KEY = ["work-orders", "all"];

export const useWorkOrders = (options = {}) => {
  return useQuery({
    queryKey: WORK_ORDERS_QUERY_KEY,
    queryFn: async () => {
      const response = await getAllWorkOrders();
      return response?.data?.data || [];
    },
    ...options,
  });
};

export const useInvalidateWorkOrders = () => {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: WORK_ORDERS_QUERY_KEY });
};
