import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getTeams } from '../api/teams.api';

export const useTeams = (options = {}) => {
    return useQuery({
        queryKey: ['teams'],
        queryFn: async () => {
            const response = await getTeams({ isActive: true });
            return response?.data?.data || [];
        },
        staleTime: 5 * 60 * 1000,
        ...options,
    });
};

export const useInvalidateTeams = () => {
    const queryClient = useQueryClient();
    return () => queryClient.invalidateQueries({ queryKey: ['teams'] });
};
