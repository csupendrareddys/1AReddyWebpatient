/**
 * Login Page Configuration API
 * Fetches dynamic login page configuration from backend
 */
import axios from '../../../api/axiosConfig';

/**
 * Fetch the active login page configuration
 * This is a public endpoint - no auth required
 * @returns {Promise<Object>} Login page configuration
 */
export const fetchLoginPageConfig = async () => {
    const response = await axios.get('/api/v1/config/login-page');
    return response.data;
};

/**
 * Admin: Get login page configuration for editing
 * Includes all fields regardless of is_present status
 * @returns {Promise<Object>} Full login page configuration
 */
export const fetchAdminLoginPageConfig = async () => {
    const response = await axios.get('/api/v1/config/admin/login-page');
    return response.data;
};

/**
 * Admin: Update login page configuration
 * @param {Object} data - Configuration fields to update
 * @returns {Promise<Object>} Updated configuration
 */
export const updateLoginPageConfig = async (data) => {
    const response = await axios.put('/api/v1/config/admin/login-page', data);
    return response.data;
};

/**
 * Admin: Add a new field to login page
 * @param {Object} fieldData - Field configuration
 * @returns {Promise<Object>} Created field
 */
export const addLoginField = async (fieldData) => {
    const response = await axios.post('/api/v1/config/admin/login-page/field', fieldData);
    return response.data;
};

/**
 * Admin: Update a field configuration
 * @param {string} fieldId - Field ID
 * @param {Object} data - Updated field data
 * @returns {Promise<Object>} Updated field
 */
export const updateLoginField = async (fieldId, data) => {
    const response = await axios.put(`/api/v1/config/admin/login-page/field/${fieldId}`, data);
    return response.data;
};

/**
 * Admin: Delete a field
 * @param {string} fieldId - Field ID to delete
 * @returns {Promise<Object>} Response
 */
export const deleteLoginField = async (fieldId) => {
    const response = await axios.delete(`/api/v1/config/admin/login-page/field/${fieldId}`);
    return response.data;
};

/**
 * Admin: Update a user type configuration
 * @param {string} userTypeId - User type ID
 * @param {Object} data - Updated user type data
 * @returns {Promise<Object>} Updated user type
 */
export const updateUserType = async (userTypeId, data) => {
    const response = await axios.put(`/api/v1/config/admin/login-page/user-type/${userTypeId}`, data);
    return response.data;
};

/**
 * Admin: Add a new extra button
 * @param {Object} buttonData - Button configuration
 * @returns {Promise<Object>} Created button
 */
export const addExtraButton = async (buttonData) => {
    const response = await axios.post('/api/v1/config/admin/login-page/extra-button', buttonData);
    return response.data;
};

/**
 * Admin: Update an extra button
 * @param {string} buttonId - Button ID
 * @param {Object} data - Updated button data
 * @returns {Promise<Object>} Updated button
 */
export const updateExtraButton = async (buttonId, data) => {
    const response = await axios.put(`/api/v1/config/admin/login-page/extra-button/${buttonId}`, data);
    return response.data;
};

/**
 * Admin: Delete an extra button
 * @param {string} buttonId - Button ID to delete
 * @returns {Promise<Object>} Response
 */
export const deleteExtraButton = async (buttonId) => {
    const response = await axios.delete(`/api/v1/config/admin/login-page/extra-button/${buttonId}`);
    return response.data;
};
