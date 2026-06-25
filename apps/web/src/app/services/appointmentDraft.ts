import { api } from './api';
import type { Client } from './types';

type DraftAppointmentResponse = {
  id: string;
};

function localDateNoonIso(date: string) {
  return new Date(`${date}T12:00:00`).toISOString();
}

export async function createAppointmentDraft() {
  const today = new Date().toISOString().slice(0, 10);
  const now = new Date();
  const end = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  const suffix = Date.now().toString().slice(-6);

  const client = await api<Client>('/clients', {
    method: 'POST',
    body: JSON.stringify({
      name: `Novo agendamento ${suffix}`,
      cnpj: null,
      ie: null,
      email: null,
      city: 'A definir',
      state: null,
      district: null,
      zipCode: null,
      phone: null,
      address: 'Endereco a definir',
      notes: null
    })
  });

  return api<DraftAppointmentResponse>('/appointments', {
    method: 'POST',
    body: JSON.stringify({
      clientId: client.id,
      technicianId: null,
      city: 'A definir',
      fullAddress: 'Endereco a definir',
      serviceType: 'Pendente definicao',
      problemDescription: 'Pendente descricao do servico',
      date: localDateNoonIso(today),
      startTime: now.toISOString(),
      endTime: end.toISOString(),
      daysOut: 1,
      status: 'WAITING',
      osNumber: '',
      clientChecklist: '',
      notes: 'Rascunho criado na central de agendamentos',
      schedulingChecklist: {
        clientConfirmed: false,
        contactConfirmed: false,
        addressConfirmed: false,
        serviceTypeConfirmed: false,
        technicianSelected: false,
        technicianAvailability: false,
        dateTimeConfirmed: false,
        hotelNeedChecked: false,
        transportNeedChecked: false,
        osChecked: false,
        clientChecklistChecked: false
      }
    })
  });
}
