import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getWeeklyOff } from "../api/companyHolidays.api";

/**
 * Weekly-off configuration, used by Grinding Data Entry's advisory
 * edit-window check. Indo serves this from the Company Holidays route
 * (server/routes/companyHoliday.routes.js) rather than a separate
 * company-settings endpoint.
 */
export const COMPANY_SETTINGS_QUERY_KEY = ["companySettings"];

export const useCompanySettings = (options = {}) => {
  return useQuery({
    queryKey: COMPANY_SETTINGS_QUERY_KEY,
    queryFn: async () => {
      const response = await getWeeklyOff();
      return response?.data?.data || { weeklyOffDays: [] };
    },
    ...options,
  });
};

export const useInvalidateCompanySettings = () => {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: COMPANY_SETTINGS_QUERY_KEY });
};
