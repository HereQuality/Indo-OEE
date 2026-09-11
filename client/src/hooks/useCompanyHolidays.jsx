import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getCompanyHolidays } from "../api/companyHolidays.api";

export const COMPANY_HOLIDAYS_QUERY_KEY = ["companyHolidays", "all"];

export const useCompanyHolidays = (options = {}) => {
  return useQuery({
    queryKey: COMPANY_HOLIDAYS_QUERY_KEY,
    queryFn: async () => {
      const response = await getCompanyHolidays();
      return response?.data?.data || [];
    },
    ...options,
  });
};

export const useInvalidateCompanyHolidays = () => {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: COMPANY_HOLIDAYS_QUERY_KEY });
};
