import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getAllRoles } from "../api/roles.api";

// Shared across every page that needs "the full roles list" (Hierarchy,
// ManageRole, Employee dropdowns, ...). Previously each page fetched this
// independently on its own mount; now the first page to ask for it fetches
// once, and every other page reads the same cached copy until it goes
// stale or a mutation invalidates it.
export const ROLES_QUERY_KEY = ["roles", "all"];

export const useRoles = (options = {}) => {
  return useQuery({
    queryKey: ROLES_QUERY_KEY,
    queryFn: async () => {
      const response = await getAllRoles();
      return response?.data?.data || [];
    },
    ...options,
  });
};

// Call this after creating/updating/deleting a role so every page showing
// the roles list (not just the one that made the change) refetches.
export const useInvalidateRoles = () => {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ROLES_QUERY_KEY });
};
