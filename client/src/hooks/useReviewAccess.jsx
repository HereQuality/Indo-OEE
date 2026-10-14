import { useQuery } from "@tanstack/react-query";
import { getReviewAccess } from "../api/oeeReview.api";

// Whether the logged-in user is Admin / Super Admin — who may review OEE
// entries and change a process's Operator Planned Shift. The server enforces
// the same rule on every request; this only decides what the screens offer.
export const useReviewAccess = () => {
  const { data, isLoading } = useQuery({
    queryKey: ["oee-review", "access"],
    queryFn: async () => (await getReviewAccess())?.data?.data || { canReview: false },
    staleTime: 5 * 60 * 1000,
  });
  return { canReview: !!data?.canReview, loading: isLoading };
};
