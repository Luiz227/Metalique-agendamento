import { Injectable } from '@nestjs/common';
import { AppointmentStatus } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  health() {
    return { ok: true, module: 'dashboard' };
  }

  async data() {
    const now = new Date();
    const startToday = new Date(now);
    startToday.setHours(0, 0, 0, 0);
    const endToday = new Date(now);
    endToday.setHours(23, 59, 59, 999);

    const startWeek = new Date(startToday);
    startWeek.setDate(startToday.getDate() - ((startToday.getDay() + 6) % 7));
    const endWeek = new Date(startWeek);
    endWeek.setDate(startWeek.getDate() + 6);
    endWeek.setHours(23, 59, 59, 999);

    const [todayCount, weekCount, critical, waiting, ready, technicians, appointments, suggestions] = await Promise.all([
      this.prisma.appointment.count({ where: { date: { gte: startToday, lte: endToday } } }),
      this.prisma.appointment.count({ where: { date: { gte: startWeek, lte: endWeek } } }),
      this.prisma.appointment.count({ where: { status: AppointmentStatus.CRITICAL } }),
      this.prisma.appointment.count({ where: { status: AppointmentStatus.WAITING } }),
      this.prisma.appointment.count({ where: { status: AppointmentStatus.READY } }),
      this.prisma.technician.findMany({ where: { active: true }, select: { id: true, name: true } }),
      this.prisma.appointment.findMany({
        where: { date: { gte: startWeek, lte: endWeek } },
        select: { date: true, technician: { select: { name: true } } }
      }),
      this.prisma.routeSuggestion.count({ where: { status: 'OPEN' } })
    ]);

    const weekdays = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'];
    const appointmentsByWeekday = weekdays.map((label, day) => ({
      label,
      total: appointments.filter((a) => new Date(a.date).getDay() === day).length
    }));

    const technicianUsage = technicians.map((t) => ({
      label: t.name,
      total: appointments.filter((a) => a.technician?.name === t.name).length
    }));

    return {
      todayCount,
      weekCount,
      critical,
      awaitingValidation: waiting,
      techniciansInField: technicianUsage.filter((t) => t.total > 0).length,
      techniciansAvailable: technicians.length,
      hotelsPending: 0,
      transportsPending: 0,
      osPending: 0,
      openSuggestions: suggestions,
      estimatedSavings: suggestions * 250,
      weekPlanned: 0,
      weekReal: 0,
      weekDifference: 0,
      monthPlanned: 0,
      monthReal: 0,
      alerts: critical > 0 ? [{ type: 'critical', message: `${critical} atendimento(s) crítico(s).`, severity: 'high' }] : [],
      charts: {
        appointmentsByWeekday,
        status: [
          { label: 'CRITICAL', total: critical },
          { label: 'WAITING', total: waiting },
          { label: 'READY', total: ready }
        ],
        technicianUsage
      }
    };
  }
}
