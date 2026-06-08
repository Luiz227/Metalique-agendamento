import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, Plus, MapPin, User, Clock } from 'lucide-react';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { api } from '../services/api';
import type { Appointment } from '../services/types';
import { formatDate, formatTime, statusLabel } from '../services/types';

const weekDays = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

const statusConfig = {
  ready: { color: 'bg-green-500' },
  waiting: { color: 'bg-yellow-500' },
  critical: { color: 'bg-red-500' }
};

function normalizeTechnicianColor(color?: string | null) {
  return color || '#2563eb';
}

function shortCompanyName(name: string) {
  return name.length > 22 ? `${name.slice(0, 22).trim()}...` : name;
}

function weekStartMonday(baseDate: Date) {
  const monday = new Date(baseDate);
  const day = monday.getDay();
  monday.setDate(monday.getDate() - (day === 0 ? 6 : day - 1));
  monday.setHours(0, 0, 0, 0);
  return monday;
}

function dayRange(date: Date) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

export default function Schedule() {
  const [selectedDay, setSelectedDay] = useState(0);
  const [view, setView] = useState<'week' | 'month'>('week');
  const [referenceDate, setReferenceDate] = useState(() => new Date());
  const [selectedMonthDate, setSelectedMonthDate] = useState(() => new Date());
  const [apiAppointments, setApiAppointments] = useState<Appointment[]>([]);

  useEffect(() => {
    const start = new Date(referenceDate);
    const end = new Date(referenceDate);

    if (view === 'week') {
      const monday = weekStartMonday(referenceDate);
      start.setTime(monday.getTime());
      end.setTime(monday.getTime());
      end.setDate(end.getDate() + 6);
      end.setHours(23, 59, 59, 999);
    } else {
      start.setDate(1);
      start.setHours(0, 0, 0, 0);
      end.setMonth(start.getMonth() + 1, 0);
      end.setHours(23, 59, 59, 999);
    }

    const query = `?from=${encodeURIComponent(start.toISOString())}&to=${encodeURIComponent(end.toISOString())}`;
    api<Appointment[]>(`/appointments${query}`).then(setApiAppointments).catch(() => setApiAppointments([]));
  }, [referenceDate, view]);

  useEffect(() => {
    const first = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), 1);
    setSelectedMonthDate(first);
  }, [referenceDate]);

  const currentWeek = useMemo(() => {
    const monday = weekStartMonday(referenceDate);

    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(monday);
      date.setDate(monday.getDate() + index);
      const { start, end } = dayRange(date);

      return {
        day: weekDays[date.getDay()],
        date: date.getDate(),
        fullDate: date,
        appointments: apiAppointments.filter((appointment) => {
          const appointmentDate = new Date(appointment.date);
          return appointmentDate >= start && appointmentDate <= end;
        }).length
      };
    });
  }, [apiAppointments, referenceDate]);

  const selectedWeekDate = currentWeek[selectedDay]?.fullDate ?? currentWeek[0]?.fullDate ?? new Date();

  function appointmentsForDate(date: Date) {
    const { start, end } = dayRange(date);

    return apiAppointments
      .filter((appointment) => {
        const appointmentDate = new Date(appointment.date);
        return appointmentDate >= start && appointmentDate <= end;
      })
      .map((appointment) => ({
        id: appointment.id,
        time: formatTime(appointment.startTime),
        technician: appointment.technician?.name ?? 'Sem técnico',
        technicianColor: normalizeTechnicianColor(appointment.technician?.color),
        client: appointment.client?.name ?? 'Cliente',
        city: appointment.city,
        status: appointment.status === 'READY' ? 'ready' : appointment.status === 'CRITICAL' ? 'critical' : 'waiting',
        duration: Math.max(1, Math.round((new Date(appointment.endTime).getTime() - new Date(appointment.startTime).getTime()) / 3600000)),
        label: statusLabel(appointment.status)
      }));
  }

  const weekAppointments = useMemo(() => appointmentsForDate(selectedWeekDate), [apiAppointments, selectedWeekDate]);
  const monthAppointments = useMemo(() => appointmentsForDate(selectedMonthDate), [apiAppointments, selectedMonthDate]);

  const monthLabel = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(referenceDate);

  function goPreviousPeriod() {
    setReferenceDate((prev) => {
      const next = new Date(prev);
      if (view === 'week') next.setDate(next.getDate() - 7);
      else next.setMonth(next.getMonth() - 1);
      return next;
    });
    setSelectedDay(0);
  }

  function goNextPeriod() {
    setReferenceDate((prev) => {
      const next = new Date(prev);
      if (view === 'week') next.setDate(next.getDate() + 7);
      else next.setMonth(next.getMonth() + 1);
      return next;
    });
    setSelectedDay(0);
  }

  const monthGrid = useMemo(() => {
    const year = referenceDate.getFullYear();
    const month = referenceDate.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const lastDate = new Date(year, month + 1, 0).getDate();

    return Array.from({ length: 42 }, (_, i) => {
      const dayNum = i - firstDay + 1;
      const isCurrentMonth = dayNum > 0 && dayNum <= lastDate;
      const date = isCurrentMonth ? new Date(year, month, dayNum) : null;
      const dayAppointments = isCurrentMonth
        ? apiAppointments.filter((appointment) => {
            const aptDate = new Date(appointment.date);
            return aptDate.getFullYear() === year && aptDate.getMonth() === month && aptDate.getDate() === dayNum;
          })
        : [];
      const appointmentCount = dayAppointments.length;

      const isSelected =
        !!date &&
        selectedMonthDate.getFullYear() === date.getFullYear() &&
        selectedMonthDate.getMonth() === date.getMonth() &&
        selectedMonthDate.getDate() === date.getDate();

      return { key: i, dayNum, isCurrentMonth, appointmentCount, date, isSelected, dayAppointments };
    });
  }, [apiAppointments, referenceDate, selectedMonthDate]);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <CalendarIcon className="h-6 w-6 text-blue-400" />
            <h1 className="text-2xl font-bold text-white">Agenda Operacional</h1>
          </div>
          <div className="flex items-center gap-2 ml-6">
            <Button variant="outline" size="icon" className="h-8 w-8 border-zinc-700" onClick={goPreviousPeriod}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm text-zinc-300 min-w-[180px] text-center capitalize">{monthLabel}</span>
            <Button variant="outline" size="icon" className="h-8 w-8 border-zinc-700" onClick={goNextPeriod}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <Link to="/appointments/manage">
          <Button className="bg-blue-500 hover:bg-blue-600">
            <Plus className="h-4 w-4 mr-2" />
            Novo Agendamento
          </Button>
        </Link>
      </div>

      <Tabs value={view} onValueChange={(v) => setView(v as 'week' | 'month')}>
        <TabsList className="bg-zinc-900 border-zinc-800">
          <TabsTrigger value="week">Semana</TabsTrigger>
          <TabsTrigger value="month">Mês</TabsTrigger>
        </TabsList>

        <TabsContent value="week" className="space-y-6 mt-6">
          <div className="grid grid-cols-7 gap-3">
            {currentWeek.map((day, idx) => (
              <Card
                key={`${day.day}-${day.date}`}
                className={`cursor-pointer transition-all ${selectedDay === idx ? 'bg-blue-500/20 border-blue-500' : 'bg-zinc-900/50 border-zinc-800 hover:border-zinc-700'}`}
                onClick={() => setSelectedDay(idx)}
              >
                <CardContent className="p-4 text-center">
                  <div className="text-xs text-zinc-400 mb-1">{day.day}</div>
                  <div className="text-2xl font-bold text-white mb-2">{day.date}</div>
                  <Badge variant="secondary" className={day.appointments > 0 ? 'bg-blue-500/20 text-blue-400' : 'bg-zinc-800 text-zinc-500'}>
                    {day.appointments} agend.
                  </Badge>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card className="bg-zinc-900/50 border-zinc-800">
            <CardContent className="p-6">
              <h3 className="text-lg font-semibold text-white mb-4">{formatDate(selectedWeekDate.toISOString())}</h3>

              <div className="space-y-3">
                {weekAppointments.length === 0 && (
                  <div className="rounded-lg border border-zinc-800 bg-zinc-800/30 p-8 text-center text-sm text-zinc-500">
                    Nenhum agendamento cadastrado para este dia.
                  </div>
                )}

                {weekAppointments.map((apt) => (
                  <Link key={apt.id} to={`/appointments/${apt.id}`}>
                    <div className="flex items-start gap-4 p-4 rounded-lg bg-zinc-800/50 border border-zinc-700 hover:border-zinc-600 transition-all group">
                      <div className="flex flex-col items-center gap-1 min-w-[60px]">
                        <Clock className="h-4 w-4 text-zinc-400" />
                        <span className="text-sm font-medium text-white">{apt.time}</span>
                        <span className="text-xs text-zinc-500">{apt.duration}h</span>
                      </div>
                      <div className="w-1 self-stretch rounded-full" style={{ backgroundColor: apt.technicianColor }} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <h4 className="font-medium text-white group-hover:text-blue-400 transition-colors">{apt.client}</h4>
                          <Badge className={`${statusConfig[apt.status as keyof typeof statusConfig].color} shrink-0`}>{apt.label}</Badge>
                        </div>
                        <div className="flex flex-wrap gap-4 text-sm text-zinc-400">
                          <div className="flex items-center gap-1.5">
                            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: apt.technicianColor }} />
                            <User className="h-3.5 w-3.5" />
                            <span>{apt.technician}</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <MapPin className="h-3.5 w-3.5" />
                            <span>{apt.city}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="month" className="space-y-6 mt-6">
          <Card className="bg-zinc-900/50 border-zinc-800">
            <CardContent className="p-6">
              <div className="grid grid-cols-7 gap-2">
                {weekDays.map((day) => (
                  <div key={day} className="text-center text-sm font-medium text-zinc-400 py-2">{day}</div>
                ))}
                {monthGrid.map(({ key, dayNum, isCurrentMonth, appointmentCount, date, isSelected, dayAppointments }) => (
                  <button
                    key={key}
                    type="button"
                    disabled={!isCurrentMonth || !date}
                    onClick={() => date && setSelectedMonthDate(date)}
                    className={`min-h-36 rounded-lg border text-left ${isCurrentMonth ? 'bg-zinc-800/30 border-zinc-700 hover:border-zinc-500' : 'bg-zinc-900/20 border-zinc-800'} ${isSelected ? 'ring-2 ring-blue-500 border-blue-500' : ''}`}
                  >
                    {isCurrentMonth && (
                      <div className="h-full flex flex-col p-2">
                        <span className="text-sm text-white mb-1">{dayNum}</span>
                        {appointmentCount > 0 && (
                          <div className="flex-1 space-y-1 overflow-hidden">
                            {dayAppointments.slice(0, 3).map((appointment) => (
                              <div
                                key={appointment.id}
                                className="rounded px-2 py-1 text-[11px] leading-tight text-white"
                                style={{
                                  backgroundColor: `${normalizeTechnicianColor(appointment.technician?.color)}33`,
                                  borderLeft: `3px solid ${normalizeTechnicianColor(appointment.technician?.color)}`
                                }}
                              >
                                <span className="font-semibold">{appointment.technician?.name ?? 'Sem tecnico'}</span>
                                <span className="text-white/85"> / {shortCompanyName(appointment.client?.name ?? 'Cliente')}</span>
                              </div>
                            ))}
                            {appointmentCount > 3 && (
                              <Badge variant="secondary" className="text-xs bg-blue-500/20 text-blue-400">+{appointmentCount - 3}</Badge>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="bg-zinc-900/50 border-zinc-800">
            <CardContent className="p-6">
              <h3 className="text-lg font-semibold text-white mb-4">Agendamentos do dia {formatDate(selectedMonthDate.toISOString())}</h3>

              <div className="space-y-3">
                {monthAppointments.length === 0 && (
                  <div className="rounded-lg border border-zinc-800 bg-zinc-800/30 p-8 text-center text-sm text-zinc-500">
                    Nenhum agendamento cadastrado para este dia.
                  </div>
                )}

                {monthAppointments.map((apt) => (
                  <Link key={apt.id} to={`/appointments/${apt.id}`}>
                    <div className="flex items-start gap-4 p-4 rounded-lg bg-zinc-800/50 border border-zinc-700 hover:border-zinc-600 transition-all group">
                      <div className="flex flex-col items-center gap-1 min-w-[60px]">
                        <Clock className="h-4 w-4 text-zinc-400" />
                        <span className="text-sm font-medium text-white">{apt.time}</span>
                        <span className="text-xs text-zinc-500">{apt.duration}h</span>
                      </div>
                      <div className="w-1 self-stretch rounded-full" style={{ backgroundColor: apt.technicianColor }} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <h4 className="font-medium text-white group-hover:text-blue-400 transition-colors">{apt.client}</h4>
                          <Badge className={`${statusConfig[apt.status as keyof typeof statusConfig].color} shrink-0`}>{apt.label}</Badge>
                        </div>
                        <div className="flex flex-wrap gap-4 text-sm text-zinc-400">
                          <div className="flex items-center gap-1.5">
                            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: apt.technicianColor }} />
                            <User className="h-3.5 w-3.5" />
                            <span>{apt.technician}</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <MapPin className="h-3.5 w-3.5" />
                            <span>{apt.city}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
