import api from "./index";

export const getSkills = async (params) => {
    return await api.get('/api/v1/skills', { params });
};

export const getSkillById = async (id) => {
    return await api.get(`/api/v1/skills/${id}`);
};

export const createSkill = async (data) => {
    return await api.post('/api/v1/skills', data);
};

export const updateSkill = async (id, data) => {
    return await api.put(`/api/v1/skills/${id}`, data);
};

export const deleteSkill = async (id) => {
    return await api.delete(`/api/v1/skills/${id}`);
};
