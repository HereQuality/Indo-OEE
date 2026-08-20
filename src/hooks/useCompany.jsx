import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getCompanyDetails, updateCompany } from "../api/companies.api";

export const useCompany = (options = {}) => {
  return useQuery({
    queryKey: ["companyDetails"],
    queryFn: async () => {
      const res = await getCompanyDetails();
      if (res.data && res.data.isOk && res.data.data) {
        return res.data.data;
      }
      return null;
    },
    ...options
  });
};

export const useUpdateCompany = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data) => {
      const res = await updateCompany(data);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["companyDetails"] });
    }
  });
};
