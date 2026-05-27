import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Plane, Users } from 'lucide-react';
import { Card, CardContent } from '../components/ui/card';
import { api } from '../services/api';
import type { Appointment, Technician } from '../services/types';
import { formatDate } from '../services/types';

function isInCurrentWeek(dateValue: string) {
  const date = new Date(dateValue);
  const now = new Date();
  const day = now.getDay();
  const mondayShift = day === 0 ? -6 : 1 - day;
  const start = new Date(now);
  start.setDate(now.getDate() + mondayShift);
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);

  return date >= start && date <= end;
}

export default function Technicians() {
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [activeView, setActiveView] = useState<'WEEK' | 'FINISHED'>('WEEK');

  async function load() {
    const [techs, apps] = await Promise.all([api<Technician[]>('/technicians'), api<Appointment[]>('/appointments')]);
    setTechnicians(techs);
    setAppointments(apps);
  }

  useEffect(() => {
    load().catch(() => {
      setTechnicians([]);
      setAppointments([]);
    });

    const interval = setInterval(() => {
      load().catch(() => undefined);
    }, 30000);

    return () => clearInterval(interval);
  }, []);

  const weeklyTrips = useMemo(
    () => appointments.filter((appointment) => appointment.technicianId && isInCurrentWeek(appointment.date)),
    [appointments]
  );

  const finishedWeeklyTrips = useMemo(
    () => weeklyTrips.filter((appointment) => appointment.status === 'READY'),
    [weeklyTrips]
  );

  const finishedAllTrips = useMemo(
    () => appointments.filter((appointment) => appointment.status === 'READY' && appointment.technicianId),
    [appointments]
  );

  const visibleTrips = activeView === 'WEEK' ? weeklyTrips : finishedAllTrips;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Users className="h-7 w-7 text-blue-400" />
        <div>
          <h1 className="text-2xl font-bold text-white">Técnicos</h1>
          <p className="text-zinc-400">Lista dos técnicos cadastrados pelo administrador.</p>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Card
          className={`bg-zinc-900/50 border-zinc-800 cursor-pointer transition-colors ${activeView === 'WEEK' ? 'ring-1 ring-blue-500/70' : ''}`}
          onClick={() => setActiveView('WEEK')}
        >
          <CardContent className="p-5 flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-blue-500/15 flex items-center justify-center">
              <Plane className="h-5 w-5 text-blue-400" />
            </div>
            <div>
              <p className="text-xs text-zinc-400">Viagens da semana</p>
              <p className="text-2xl font-bold text-white">{weeklyTrips.length}</p>
            </div>
          </CardContent>
        </Card>
        <Card
          className={`bg-zinc-900/50 border-zinc-800 cursor-pointer transition-colors ${activeView === 'FINISHED' ? 'ring-1 ring-green-500/70' : ''}`}
          onClick={() => setActiveView('FINISHED')}
        >
          <CardContent className="p-5 flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-green-500/15 flex items-center justify-center">
              <CheckCircle2 className="h-5 w-5 text-green-400" />
            </div>
            <div>
              <p className="text-xs text-zinc-400">Viagens finalizadas</p>
              <p className="text-2xl font-bold text-white">{finishedWeeklyTrips.length}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-zinc-900/50 border-zinc-800">
        <CardContent className="p-5 space-y-3">
          <p className="text-sm font-semibold text-white">
            {activeView === 'WEEK' ? 'Agendamentos da semana' : 'Viagens finalizadas'}
          </p>
          {visibleTrips.length === 0 && (
            <p className="text-sm text-zinc-500">
              {activeView === 'WEEK'
                ? 'Nenhum agendamento para a semana atual.'
                : 'Nenhuma viagem finalizada encontrada.'}
            </p>
          )}
          {visibleTrips
            .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
            .map((appointment) => (
              <div key={appointment.id} className="rounded-lg border border-zinc-800 bg-zinc-800/30 p-3">
                <p className="text-sm text-white font-medium">{appointment.technician?.name ?? 'Sem tecnico'}</p>
                <p className="text-xs text-zinc-300 mt-1">{appointment.client?.name ?? 'Cliente'} - {appointment.city}</p>
                <p className="text-xs text-zinc-500 mt-1">{formatDate(appointment.date)}</p>
              </div>
            ))}
        </CardContent>
      </Card>

      {technicians.length === 0 && (
        <Card className="bg-zinc-900/50 border-zinc-800">
          <CardContent className="p-8 text-center text-sm text-zinc-500">
            Nenhum técnico cadastrado ainda.
          </CardContent>
        </Card>
      )}

      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
        {technicians.map((technician) => (
          <Card key={technician.id} className="bg-zinc-900/50 border-zinc-800">
            <CardContent className="p-5 flex items-center gap-3">
              <span
                className="h-4 w-4 rounded-full border border-white/40"
                style={{ backgroundColor: technician.color ?? '#3b82f6' }}
              />
              <h2 className="font-semibold text-white">{technician.name}</h2>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
