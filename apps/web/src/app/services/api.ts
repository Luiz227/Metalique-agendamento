export type ApiUser = {
  id: string;
  name: string;
  email: string;
  role: 'ADMIN' | 'LOGISTICS' | 'TECHNICIAN' | 'VALIDATOR' | 'SALES';
};

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') || '/api';
const TOKEN_KEY = 'servicePlannerToken';
const USER_KEY = 'servicePlannerUser';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function getUser(): ApiUser | null {
  const raw = localStorage.getItem(USER_KEY);
  return raw ? JSON.parse(raw) : null;
}

export function setSession(token: string, user: ApiUser) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function connectRealtime(onAppointmentsChanged: () => void) {
  const token = getToken();
  if (!token) return () => undefined;

  const source = new EventSource(`${API_URL}/events/stream?token=${encodeURIComponent(token)}`);
  const handler = () => onAppointmentsChanged();
  source.addEventListener('appointments_changed', handler);

  return () => {
    source.removeEventListener('appointments_changed', handler);
    source.close();
  };
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers = new Headers(init.headers);
  if (!(init.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const response = await fetch(`${API_URL}${path}`, { ...init, headers, cache: 'no-store' });
  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(payload?.message ?? 'Erro na API', response.status);
  }
  return payload as T;
}
