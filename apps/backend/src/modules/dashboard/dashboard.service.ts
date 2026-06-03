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
    await this.rebuildSuggestionsFromAppointments();

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
      alerts: critical > 0 ? [{ type: 'finished', message: `${critical} visita(s) finalizada(s).`, severity: 'low' }] : [],
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

  private async rebuildSuggestionsFromAppointments() {
    const appointments = await this.prisma.appointment.findMany({
      where: {
        status: { in: [AppointmentStatus.WAITING, AppointmentStatus.READY] }
      },
      select: {
        id: true,
        date: true,
        latitude: true,
        longitude: true,
        city: true,
        fullAddress: true,
        client: { select: { address: true, latitude: true, longitude: true } }
      },
      orderBy: [{ date: 'asc' }, { startTime: 'asc' }]
    });

    const keepPairs = new Set<string>();
    const pointsByAppointmentId = new Map<string, { lat: number; lng: number } | null>();

    for (let i = 0; i < appointments.length; i += 1) {
      for (let j = i + 1; j < appointments.length; j += 1) {
        const a = appointments[i];
        const b = appointments[j];

        const pointA = pointsByAppointmentId.has(a.id)
          ? pointsByAppointmentId.get(a.id)
          : await this.resolvePoint(a);
        pointsByAppointmentId.set(a.id, pointA ?? null);

        const pointB = pointsByAppointmentId.has(b.id)
          ? pointsByAppointmentId.get(b.id)
          : await this.resolvePoint(b);
        pointsByAppointmentId.set(b.id, pointB ?? null);

        if (!pointA || !pointB) continue;

        const distanceKm = this.haversineKm(pointA, pointB);
        if (!Number.isFinite(distanceKm) || distanceKm > 60) continue;

        const durationMinutes = Math.max(5, Math.round((distanceKm / 50) * 60));
        const score = Math.max(45, Math.min(100, Math.round(100 - distanceKm * 2)));
        const [originAppointmentId, nearbyAppointmentId] = [a.id, b.id].sort();
        keepPairs.add(`${originAppointmentId}:${nearbyAppointmentId}`);

        await this.prisma.routeSuggestion.upsert({
          where: { originAppointmentId_nearbyAppointmentId: { originAppointmentId, nearbyAppointmentId } },
          update: { distanceKm, durationMinutes, score, status: 'OPEN' },
          create: { originAppointmentId, nearbyAppointmentId, distanceKm, durationMinutes, score }
        });
      }
    }

    const openSuggestions = await this.prisma.routeSuggestion.findMany({
      where: { status: 'OPEN' },
      select: { id: true, originAppointmentId: true, nearbyAppointmentId: true }
    });

    const staleIds = openSuggestions
      .filter((item) => !keepPairs.has([item.originAppointmentId, item.nearbyAppointmentId].sort().join(':')))
      .map((item) => item.id);

    if (staleIds.length) {
      await this.prisma.routeSuggestion.deleteMany({ where: { id: { in: staleIds } } });
    }
  }

  private async resolvePoint(row: {
    id: string;
    city: string;
    fullAddress: string;
    latitude: number | null;
    longitude: number | null;
    client: { address: string | null; latitude: number | null; longitude: number | null };
  }) {
    const lat = row.latitude ?? row.client.latitude;
    const lng = row.longitude ?? row.client.longitude;
    if (lat != null && lng != null) return { lat: Number(lat), lng: Number(lng) };

    const point = await this.geocodeAddress(row.fullAddress || row.client.address || '', row.city);
    if (!point) return null;

    void this.prisma.appointment.update({
      where: { id: row.id },
      data: { latitude: point.lat, longitude: point.lng }
    }).catch(() => undefined);

    return point;
  }

  private buildMapsQuery(address?: string | null, city?: string | null) {
    const normalizedCity = String(city ?? '')
      .replace(/\s*\/\s*/g, ', ')
      .replace(/\s+-\s+/g, ', ')
      .replace(/\s+/g, ' ')
      .trim();
    return [String(address ?? '').trim(), normalizedCity, 'Brasil'].filter(Boolean).join(', ');
  }

  private async geocodeAddress(address?: string | null, city?: string | null) {
    const key = process.env.GOOGLE_MAPS_API_KEY;
    const query = this.buildMapsQuery(address, city);
    if (!key || !query) return null;

    try {
      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&key=${encodeURIComponent(key)}`;
      const response = await fetch(url);
      if (!response.ok) return null;
      const payload = (await response.json()) as {
        status?: string;
        results?: Array<{ geometry?: { location?: { lat?: number; lng?: number } } }>;
      };
      if (payload.status !== 'OK') return null;
      const location = payload.results?.[0]?.geometry?.location;
      if (typeof location?.lat !== 'number' || typeof location?.lng !== 'number') return null;
      return { lat: location.lat, lng: location.lng };
    } catch {
      return null;
    }
  }

  private isSameDay(a: Date, b: Date) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }

  private haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
    const radius = 6371;
    const dLat = ((b.lat - a.lat) * Math.PI) / 180;
    const dLng = ((b.lng - a.lng) * Math.PI) / 180;
    const lat1 = (a.lat * Math.PI) / 180;
    const lat2 = (b.lat * Math.PI) / 180;
    const x = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
    return 2 * radius * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  }
}

