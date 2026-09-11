/**
 * Form Builder API Service
 *
 * Drives the admin screen that configures Grinding Data Entry's fields.
 * See server/models/FormDefinition.js for what can and can't be changed.
 */
import api from "./index";
import { ENDPOINTS } from "./endpoints";

export const GRINDING_FORM_SLUG = "grinding-data-entry";

export const listFormDefinitions = async () => api.get(ENDPOINTS.FORM_DEFINITIONS.BASE);
export const getFormSchema = async (slug = GRINDING_FORM_SLUG) =>
  api.get(ENDPOINTS.FORM_DEFINITIONS.SCHEMA(slug));
export const createFormField = async (formId, data) =>
  api.post(ENDPOINTS.FORM_DEFINITIONS.FIELDS(formId), data);
export const updateFormField = async (fieldId, data) =>
  api.put(ENDPOINTS.FORM_DEFINITIONS.FIELD_BY_ID(fieldId), data);
export const deleteFormField = async (fieldId) =>
  api.delete(ENDPOINTS.FORM_DEFINITIONS.FIELD_BY_ID(fieldId));
export const reorderFormFields = async (fields) =>
  api.put(ENDPOINTS.FORM_DEFINITIONS.REORDER, { fields });

export default {
  listFormDefinitions,
  getFormSchema,
  createFormField,
  updateFormField,
  deleteFormField,
  reorderFormFields,
};
