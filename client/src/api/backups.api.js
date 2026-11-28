/**
 * Administration › Backups (server routes/backup.routes.js, Super Admin only —
 * anyone else gets HTTP 403).
 * GET → { data: { backups: [{ name, size, createdAt, day }], running, status, disk, schedule } }
 */
import api from "./index";
import { ENDPOINTS } from "./endpoints";

export const getBackups = () => api.get(ENDPOINTS.BACKUPS.BASE);

/** Takes a backup now and answers when it is saved. */
export const createBackup = () => api.post(ENDPOINTS.BACKUPS.BASE, {}, { timeout: 30 * 60 * 1000 });

/** A download link for one backup, valid 5 minutes: { data: { url } } (a path under the API's own address). */
export const getBackupLink = (name) => api.post(ENDPOINTS.BACKUPS.LINK(name));

export const apiOrigin = () => import.meta.env.VITE_API_BASE_URL || "";
