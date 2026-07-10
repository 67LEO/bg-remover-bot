import axios from 'axios';

function getAnonId() {
  let id = localStorage.getItem('anon_id');
  if (!id) {
    id = crypto.randomUUID ? crypto.randomUUID() : 'anon_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    localStorage.setItem('anon_id', id);
  }
  return id;
}

const api = axios.create({
  baseURL: '/api',
  timeout: 120000,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  } else {
    config.headers['x-anon-id'] = getAnonId();
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401 && localStorage.getItem('token')) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      if (window.location.pathname !== '/login' && window.location.pathname !== '/signup') {
        window.location.href = '/login';
      }
    }
    return Promise.reject(err);
  }
);

export default api;

export async function signup(email, password, displayName) {
  const { data } = await api.post('/auth/signup', { email, password, displayName });
  return data;
}

export async function login(email, password) {
  const { data } = await api.post('/auth/login', { email, password });
  return data;
}

export async function googleLogin(googleToken) {
  const { data } = await api.post('/auth/google', { googleToken });
  return data;
}

export async function getMe() {
  const { data } = await api.get('/auth/me');
  return data;
}

export async function getStats() {
  const { data } = await api.get('/user/stats');
  return data;
}

export async function bgRemove(imageFile) {
  const fd = new FormData();
  fd.append('image', imageFile);
  const { data } = await api.post('/process/bg-remove', fd, {
    responseType: 'blob',
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return { blob: data, remaining: data.type };
}

export async function upscale(imageFile) {
  const fd = new FormData();
  fd.append('image', imageFile);
  const { data } = await api.post('/process/upscale', fd, {
    responseType: 'blob',
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
}

export async function imagine(prompt, size = 'SQUARE_HD') {
  const { data } = await api.post('/process/imagine', { prompt, size }, {
    responseType: 'blob',
  });
  return data;
}

export async function generateVideo(prompt) {
  const { data } = await api.post('/process/video', { prompt }, {
    responseType: 'blob',
  });
  return data;
}

export async function getVoices() {
  const { data } = await api.get('/voices');
  return data;
}

export async function generateVoice(voiceId, text, language) {
  const { data } = await api.post('/process/voice', { voiceId, text, language }, {
    responseType: 'blob',
  });
  return data;
}

export async function createPremiumOrder(plan) {
  const { data } = await api.post('/premium/order', { plan });
  return data;
}

export async function uploadScreenshot(orderRef, imageFile) {
  const fd = new FormData();
  fd.append('orderRef', orderRef);
  fd.append('image', imageFile);
  const { data } = await api.post('/premium/screenshot', fd, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
}
