import { useEffect, useMemo, useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { api, connectRealtime } from '../services/api';
import type { Appointment } from '../services/types';
import { formatDate, formatTime } from '../services/types';

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export default function TechnicianCalendar() {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [monthCursor, setMonthCursor] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState(() => new Date());

  async function load() {
    const rows = await api<Appointment[]>('/technician/appointments');
    setAppointments(rows);
  }

  useEffect(() => {
    load().catch(() => undefined);
  }, []);

  useEffect(() => {
    const disconnect = connectRealtime(() => load().catch(() => undefined));
    return () => disconnect();
  }, []);

  const monthAppointments = useMemo(() => {
    const month = monthCursor.getMonth();
    const year = monthCursor.getFullYear();
    return appointments.filter((item) => {
      const d = new Date(item.date);
      return d.getMonth() === month && d.getFullYear() === year;
    });
  }, [appointments, monthCursor]);

  const dayAppointments = useMemo(() => {
    return appointments
      .filter((item) => isSameDay(new Date(item.date), selectedDate))
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
  }, [appointments, selectedDate]);

  const monthGrid = useMemo(() => {
    const year = monthCursor.getFullYear();
    const month = monthCursor.getMonth();
    const first = new Date(year, month, 1);
    const startOffset = (first.getDay() + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells: Array<{ day: number; count: number; date: Date | null; key: string }> = [];
    for (let i = 0; i < startOffset; i++) cells.push({ day: 0, count: 0, date: null, key: `empty-${i}` });
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, month, day);
      const count = monthAppointments.filter((item) => new Date(item.date).getDate() === day).length;
      cells.push({ day, count, date, key: `d-${day}` });
    }
    return cells;
  }, [monthAppointments, monthCursor]);

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold">Calendário do Técnico</h1>
        <p className="text-sm text-muted-foreground">Visualize os atendimentos do mês e por dia.</p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-base sm:text-lg flex items-center gap-2">
              <CalendarDays className="h-5 w-5" />
              {monthCursor.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}
            </CardTitle>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => setMonthCursor((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))}>{"<"}</Button>
              <Button size="sm" variant="outline" onClick={() => setMonthCursor((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))}>{">"}</Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-7 gap-1 text-center text-xs text-muted-foreground mb-2">
            <div>Seg</div><div>Ter</div><div>Qua</div><div>Qui</div><div>Sex</div><div>Sab</div><div>Dom</div>
          </div>
          <div className="grid grid-cols-7 gap-1">
            {monthGrid.map((cell) => {
              const selected = cell.date ? isSameDay(cell.date, selectedDate) : false;
              return (
                <button
                  key={cell.key}
                  type="button"
                  disabled={!cell.date}
                  onClick={() => cell.date && setSelectedDate(cell.date)}
                  className={`rounded-lg border min-h-14 p-1 text-center ${cell.day === 0 ? 'border-transparent cursor-default' : selected ? 'border-blue-500 bg-blue-500/10' : 'border-border bg-card'}`}
                >
                  {cell.day > 0 && (
                    <>
                      <div className="text-xs">{cell.day}</div>
                      {cell.count > 0 && <div className="mt-1 text-[10px] rounded bg-blue-600 text-white px-1">{cell.count} ag.</div>}
                    </>
                  )}
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base sm:text-lg">Atendimentos de {formatDate(selectedDate.toISOString())}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {dayAppointments.length === 0 && <p className="text-sm text-muted-foreground">Sem atendimentos para este dia.</p>}
          {dayAppointments.map((apt) => (
            <div key={apt.id} className="rounded-lg border bg-card p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold">{apt.client?.name ?? 'Cliente'}</p>
                <Badge variant="outline">{apt.status}</Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-1">{apt.city} - {formatTime(apt.startTime)}</p>
              <p className="text-xs text-muted-foreground">Técnico: {apt.technician?.name ?? 'Não definido'}</p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

