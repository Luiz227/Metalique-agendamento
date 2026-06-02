export type Client = {
  id: string;
  name: string;
  city: string;
  address: string;
  contact?: string;
  phone?: string;
  email?: string;
  latitude?: number | null;
  longitude?: number | null;
  salesOwnerId?: string | null;
  salesOwner?: {
    id: string;
    name: string;
    email: string;
  } | null;
};

export type Technician = {
  id: string;
  name: string;
  baseCity: string;
  baseAddress: string;
  specialties: string[];
  averageDailyCost: number;
  availability: string;
  hasOwnCar: boolean;
  canTravel: boolean;
  active: boolean;
  color?: string;
  latitude?: number | null;
  longitude?: number | null;
};

export type Vehicle = {
  id: string;
  name: string;
  plate: string;
  driverName?: string;
};

export type Hotel = {
  id: string;
  name: string;
  city: string;
  address: string;
  dailyRate: number;
};

export type Expense = {
  hotelPlanned?: number;
  transportPlanned?: number;
  fuelPlanned?: number;
  tollPlanned?: number;
  mealsPlanned?: number;
  otherPlanned?: number;
  hotelReal?: number;
  transportReal?: number;
  fuelReal?: number;
  tollReal?: number;
  mealsReal?: number;
  otherReal?: number;
};

export type Appointment = {
  id: string;
  client: Client;
  clientId: string;
  technician?: Technician | null;
  technicianId?: string | null;
  vehicle?: Vehicle | null;
  hotel?: Hotel | null;
  expense?: Expense | null;
  city: string;
  fullAddress: string;
  serviceType: string;
  problemDescription?: string | null;
  date: string;
  startTime: string;
  endTime: string;
  status: 'CRITICAL' | 'WAITING' | 'READY';
  needsHotel: boolean;
  needsTransport: boolean;
  daysOut?: number;
  osNumber?: string | null;
  hotelName?: string | null;
  hotelAddress?: string | null;
  hotelCheckIn?: string | null;
  hotelCheckOut?: string | null;
  hotelNotes?: string | null;
  clientChecklist?: string | null;
  notes?: string | null;
  schedulingChecklist?: {
    clientConfirmed: boolean;
    contactConfirmed: boolean;
    addressConfirmed: boolean;
    serviceTypeConfirmed: boolean;
    technicianSelected: boolean;
    technicianAvailability: boolean;
    dateTimeConfirmed: boolean;
    hotelNeedChecked: boolean;
    transportNeedChecked: boolean;
    osChecked: boolean;
    clientChecklistChecked: boolean;
  } | null;
  finalValidation?: Record<string, boolean | string> | null;
  latitude?: number | null;
  longitude?: number | null;
  statusLogs?: Array<{
    id: string;
    status: string;
    createdAt: string;
    observation?: string | null;
  }>;
};

export type Suggestion = {
  id: string;
  originAppointment: Appointment;
  nearbyAppointment: Appointment;
  distanceKm: number;
  durationMinutes: number;
  score: number;
  potentialSavings: number;
  reason: string;
  status: 'OPEN' | 'ACCEPTED' | 'IGNORED';
  justification?: string | null;
};

export function money(value?: number | string | null) {
  return `R$ ${Number(value ?? 0).toFixed(2)}`;
}

export function formatDate(value: string) {
  return new Intl.DateTimeFormat('pt-BR').format(new Date(value));
}

export function formatTime(value: string) {
  return new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

export function statusLabel(status: Appointment['status']) {
  return status === 'READY' ? 'Pronto' : status === 'CRITICAL' ? 'Crítico' : 'Aguardando';
}

export function statusTone(status: Appointment['status']) {
  return status === 'READY'
    ? { color: 'bg-green-500', text: 'text-green-400', border: 'border-green-500' }
    : status === 'CRITICAL'
      ? { color: 'bg-red-500', text: 'text-red-400', border: 'border-red-500' }
      : { color: 'bg-yellow-500', text: 'text-yellow-400', border: 'border-yellow-500' };
}
