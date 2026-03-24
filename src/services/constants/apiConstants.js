const resolveBaseUrl = () => {
  if (typeof window === 'undefined') return 'https://backend.horleytech.com';

  const host = window.location.hostname;

  // Local frontend should call local backend directly.
  if (host === 'localhost' || host === '127.0.0.1') {
    return 'http://localhost:8000';
  }

  // Production frontend is reverse-proxied to backend on /api.
  // Using same-origin avoids browser CORS/preflight failures.
  if (host === 'scrapebot.horleytech.com' || host === 'www.scrapebot.horleytech.com') {
    return '';
  }

  return 'https://backend.horleytech.com';
};

export const BASE_URL = resolveBaseUrl();
