import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getFormSchema, GRINDING_FORM_SLUG } from "../api/formBuilder.api";

export const FORM_SCHEMA_QUERY_KEY = (slug) => ["formSchema", slug];

/**
 * The Form Builder schema that Grinding Data Entry renders itself from.
 *
 * Returns null while loading or if the form hasn't been seeded — callers
 * fall back to their built-in field list in that case, so the entry page
 * keeps working even before `npm run seed:forms` has ever been run.
 */
export const useFormSchema = (slug = GRINDING_FORM_SLUG, options = {}) => {
  return useQuery({
    queryKey: FORM_SCHEMA_QUERY_KEY(slug),
    queryFn: async () => {
      try {
        const response = await getFormSchema(slug);
        return response?.data?.data || null;
      } catch {
        return null;
      }
    },
    staleTime: 5 * 60 * 1000,
    ...options,
  });
};

export const useInvalidateFormSchema = () => {
  const queryClient = useQueryClient();
  return (slug = GRINDING_FORM_SLUG) =>
    queryClient.invalidateQueries({ queryKey: FORM_SCHEMA_QUERY_KEY(slug) });
};
