import axios from 'axios';
import { toast } from 'react-toastify';
import { BASE_URL } from '../constants/apiConstants';

export const AUTH_STORAGE_KEY = 'scrapebot_auth';

export const getStoredAuth = () => {
  try {
    const rawData = localStorage.getItem(AUTH_STORAGE_KEY);
    return rawData ? JSON.parse(rawData) : null;
  } catch (error) {
    console.error('Failed to parse auth state from localStorage:', error);
    return null;
  }
};

export const persistAuth = (authData) => {
  try {
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(authData));
  } catch (error) {
    console.error('Failed to save auth state to localStorage:', error);
  }
};

export const clearStoredAuth = () => {
  localStorage.removeItem(AUTH_STORAGE_KEY);
};

const loginAccount = async ({ email, password }) => {
  const config = {
    headers: {
      'Content-Type': 'application/json',
    },
  };

  try {
    const { data } = await axios.post(`${BASE_URL}/auth/login`, { email, password }, config);
    return data;
  } catch (error) {
    const message =
      (error.response && error.response.data && error.response.data.message) ||
      error.message ||
      error.toString();
    toast.error(`${message}`);
    throw error;
  }
};

const authService = {
  loginAccount,
};

export default authService;
