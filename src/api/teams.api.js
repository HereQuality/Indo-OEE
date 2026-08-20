import api from "./index";

export const getTeams = (params = {}) => api.get("/api/v1/teams", { params });
export const searchTeams = (data) => api.post("/api/v1/teams/search", data);
export const getTeamById = (id) => api.get(`/api/v1/teams/${id}`);
export const createTeam = (data) => api.post("/api/v1/teams", data);
export const updateTeam = (id, data) => api.put(`/api/v1/teams/${id}`, data);
export const deleteTeam = (id) => api.delete(`/api/v1/teams/${id}`);
