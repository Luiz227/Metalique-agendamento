import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Link } from 'react-router-dom';
import { Calendar, ChevronLeft, ChevronRight, Clock, Filter, MapPin, Navigation, User, X } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { api } from '../services/api';
import type { Appointment, Suggestion } from '../services/types';
import { formatDate, formatTime } from '../services/types';

type MapMarker = Appointment & {
  lat: number;
  lng: number;
};

const COMPANY_BASE = {
  label: "R. Reinaldo Raulino dos Santos, 107 - Éden, Sorocaba - SP",
  lat: -23.4388,
  lng: -47.50594
};

function markerHtml(color = '#3b82f6') {
  return `<div style="width:18px;height:18px;border-radius:999px;background:${color};border:3px solid white;box-shadow:0 8px 24px rgba(0,0,0,.45);"></div>`;
}

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const radius = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * radius * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

export default function MapView() {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [selectedMarker, setSelectedMarker] = useState<string | null>(null);
  const [filterTechnician, setFilterTechnician] = useState<string>('all');
  const [period, setPeriod] = useState<'week' | 'month'>('week');
  const [referenceDate, setReferenceDate] = useState(() => new Date());
  const mapElementRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    const start = new Date(referenceDate);
    const end = new Date(referenceDate);
    if (period === 'week') {
      const day = start.getDay();
      const mondayShift = day === 0 ? -6 : 1 - day;
      start.setDate(start.getDate() + mondayShift);
      start.setHours(0, 0, 0, 0);
      end.setDate(start.getDate() + 6);
      end.setHours(23, 59, 59, 999);
    } else {
      start.setDate(1);
      start.setHours(0, 0, 0, 0);
      end.setMonth(start.getMonth() + 1, 0);
      end.setHours(23, 59, 59, 999);
    }

    const query = `?from=${encodeURIComponent(start.toISOString())}&to=${encodeURIComponent(end.toISOString())}`;
    Promise.all([api<Appointment[]>(`/appointments${query}`), api<Suggestion[]>(`/suggestions${query}`)])
      .then(([apps, suggs]) => {
        setAppointments(apps);
        setSuggestions(suggs);
      })
      .catch(() => {
        setAppointments([]);
        setSuggestions([]);
      });
  }, [period, referenceDate]);

  const filteredAppointments = useMemo(() => {
    const start = new Date(referenceDate);
    const end = new Date(referenceDate);

    if (period === 'week') {
      const day = start.getDay();
      const mondayShift = day === 0 ? -6 : 1 - day;
      start.setDate(start.getDate() + mondayShift);
      start.setHours(0, 0, 0, 0);
      end.setDate(start.getDate() + 6);
      end.setHours(23, 59, 59, 999);
    } else {
      start.setDate(1);
      start.setHours(0, 0, 0, 0);
      end.setMonth(start.getMonth() + 1, 0);
      end.setHours(23, 59, 59, 999);
    }

    return appointments.filter((appointment) => {
      const date = new Date(appointment.date);
      if (date < start || date > end) return false;
      if (filterTechnician !== 'all' && appointment.technician?.name !== filterTechnician) return false;
      return true;
    });
  }, [appointments, filterTechnician, period, referenceDate]);

  const markers = useMemo<MapMarker[]>(() => {
    return filteredAppointments
      .filter((appointment) => {
        const lat = appointment.latitude ?? appointment.client?.latitude ?? appointment.technician?.latitude;
        const lng = appointment.longitude ?? appointment.client?.longitude ?? appointment.technician?.longitude;
        return lat !== null && lat !== undefined && lng !== null && lng !== undefined;
      })
      .map((appointment) => ({
        ...appointment,
        lat: Number(appointment.latitude ?? appointment.client?.latitude ?? appointment.technician?.latitude),
        lng: Number(appointment.longitude ?? appointment.client?.longitude ?? appointment.technician?.longitude)
      }))
      .filter((appointment) => Number.isFinite(appointment.lat) && Number.isFinite(appointment.lng));
  }, [filteredAppointments]);

  const selectedData = selectedMarker ? markers.find((marker) => marker.id === selectedMarker) : null;
  const technicians = Array.from(new Set(filteredAppointments.map((appointment) => appointment.technician?.name).filter(Boolean))) as string[];

  const scheduleByTechnician = useMemo(() => {
    return technicians.map((technicianName) => ({
      technicianName,
      appointments: filteredAppointments
        .filter((appointment) => appointment.technician?.name === technicianName)
        .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
    }));
  }, [filteredAppointments, technicians]);

  const periodAppointments = useMemo(
    () =>
      [...filteredAppointments].sort(
        (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
      ),
    [filteredAppointments]
  );

  const periodAppointmentsWithDistance = useMemo(
    () =>
      periodAppointments.map((appointment) => {
        const lat = appointment.latitude ?? appointment.client?.latitude ?? appointment.technician?.latitude;
        const lng = appointment.longitude ?? appointment.client?.longitude ?? appointment.technician?.longitude;
        if (lat == null || lng == null) {
          return { ...appointment, distanceFromBaseKm: null as number | null, estimatedMinutesFromBase: null as number | null };
        }
        const distanceFromBaseKm = haversineKm(COMPANY_BASE, { lat: Number(lat), lng: Number(lng) });
        const estimatedMinutesFromBase = Math.round((distanceFromBaseKm / 60) * 60);
        return { ...appointment, distanceFromBaseKm, estimatedMinutesFromBase };
      }),
    [periodAppointments]
  );

  const visibleSuggestions = useMemo(
    () =>
      suggestions.filter((suggestion) =>
        filteredAppointments.some((apt) => apt.id === suggestion.originAppointment.id || apt.id === suggestion.nearbyAppointment.id)
      ),
    [suggestions, filteredAppointments]
  );

  const periodLabel = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(referenceDate);

  function goPreviousPeriod() {
    setReferenceDate((prev) => {
      const next = new Date(prev);
      if (period === 'week') next.setDate(next.getDate() - 7);
      else next.setMonth(next.getMonth() - 1);
      return next;
    });
    setSelectedMarker(null);
  }

  function goNextPeriod() {
    setReferenceDate((prev) => {
      const next = new Date(prev);
      if (period === 'week') next.setDate(next.getDate() + 7);
      else next.setMonth(next.getMonth() + 1);
      return next;
    });
    setSelectedMarker(null);
  }

  useEffect(() => {
    if (!mapElementRef.current || mapRef.current) return;

    const map = L.map(mapElementRef.current, { zoomControl: true }).setView([-14.235, -51.9253], 4);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap'
    }).addTo(map);
    mapRef.current = map;
    layerRef.current = L.layerGroup().addTo(map);

    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;

    layer.clearLayers();
    const bounds = L.latLngBounds([]);

    markers.forEach((marker) => {
      const icon = L.divIcon({
        html: markerHtml(marker.technician?.color),
        className: '',
        iconSize: [18, 18],
        iconAnchor: [9, 9]
      });
      const leafletMarker = L.marker([marker.lat, marker.lng], { icon })
        .bindPopup(`
          <strong>${marker.client?.name ?? 'Cliente'}</strong><br/>
          ${marker.city}<br/>
          ${marker.technician?.name ?? 'Sem técnico'} - ${formatTime(marker.startTime)}<br/>
          OS ${marker.osNumber ?? 'pendente'}
        `)
        .on('click', () => setSelectedMarker(marker.id));
      leafletMarker.addTo(layer);
      bounds.extend([marker.lat, marker.lng]);
    });

    visibleSuggestions.slice(0, 8).forEach((suggestion) => {
      const origin = markers.find((marker) => marker.id === suggestion.originAppointment.id);
      const nearby = markers.find((marker) => marker.id === suggestion.nearbyAppointment.id);
      if (!origin || !nearby) return;
      L.polyline([[origin.lat, origin.lng], [nearby.lat, nearby.lng]], {
        color: '#38bdf8',
        weight: 4,
        opacity: 0.75,
        dashArray: '8 8'
      }).addTo(layer);
    });

    if (bounds.isValid()) map.fitBounds(bounds.pad(0.35));
  }, [markers, visibleSuggestions]);

  return (
    <div className="h-[calc(100vh-4rem)] flex">
      <div className="w-80 bg-zinc-900/50 border-r border-zinc-800 p-4 space-y-4 overflow-y-auto">
        <div className="flex items-center gap-2 mb-4">
          <Filter className="h-5 w-5 text-blue-400" />
          <h2 className="font-semibold text-white">Filtros</h2>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-sm text-zinc-400 mb-1.5 block">Período</label>
            <div className="flex gap-2">
              <Button variant={period === 'week' ? 'default' : 'outline'} size="sm" className={period === 'week' ? 'bg-blue-500 hover:bg-blue-600' : 'border-zinc-700'} onClick={() => setPeriod('week')}>
                Semana
              </Button>
              <Button variant={period === 'month' ? 'default' : 'outline'} size="sm" className={period === 'month' ? 'bg-blue-500 hover:bg-blue-600' : 'border-zinc-700'} onClick={() => setPeriod('month')}>
                Mês
              </Button>
            </div>
          </div>
          <div className="flex items-center justify-between rounded-lg border border-zinc-700 bg-zinc-800/40 p-2">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={goPreviousPeriod}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="flex items-center gap-2 text-xs text-zinc-200 capitalize">
              <Calendar className="h-3.5 w-3.5 text-zinc-400" />
              {periodLabel}
            </div>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={goNextPeriod}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <div>
            <label className="text-sm text-zinc-400 mb-1.5 block">Técnico</label>
            <Select value={filterTechnician} onValueChange={setFilterTechnician}>
              <SelectTrigger className="bg-zinc-800/50 border-zinc-700"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {technicians.map((technician) => (
                  <SelectItem key={technician} value={technician}>{technician}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <Card className="bg-zinc-800/30 border-zinc-700 mt-6">
          <CardHeader><CardTitle className="text-sm text-white">Sugestões próximas</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {visibleSuggestions.length === 0 && <p className="text-xs text-zinc-500">Nenhuma sugestão encontrada.</p>}
            {visibleSuggestions.slice(0, 5).map((suggestion) => (
              <div key={suggestion.id} className="rounded-lg border border-blue-500/20 bg-blue-500/10 p-3 text-xs">
                <p className="font-medium text-blue-300">{suggestion.durationMinutes} min - {suggestion.distanceKm.toFixed(1)} km</p>
                <p className="text-zinc-400 mt-1">{suggestion.originAppointment.city} / {suggestion.nearbyAppointment.city}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="bg-zinc-800/30 border-zinc-700">
          <CardHeader><CardTitle className="text-sm text-white">Técnicos no mapa</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {technicians.length === 0 && <p className="text-xs text-zinc-500">Nenhum técnico com atendimento no período.</p>}
            {technicians.map((technicianName) => {
              const technician = filteredAppointments.find((appointment) => appointment.technician?.name === technicianName)?.technician;
              return (
                <div key={technicianName} className="flex items-center gap-2 text-xs text-zinc-300">
                  <span className="h-3 w-3 rounded-full" style={{ backgroundColor: technician?.color ?? '#3b82f6' }} />
                  {technicianName}
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card className="bg-zinc-800/30 border-zinc-700">
          <CardHeader><CardTitle className="text-sm text-white">Agenda por técnico</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {scheduleByTechnician.length === 0 && <p className="text-xs text-zinc-500">Sem agenda no período para exibir.</p>}
            {scheduleByTechnician.map((item) => (
              <div key={item.technicianName} className="rounded-lg border border-zinc-700/60 p-3">
                <p className="text-xs font-semibold text-zinc-200 mb-2">{item.technicianName}</p>
                {item.appointments.length === 0 && <p className="text-xs text-zinc-500">Sem agendamentos no período.</p>}
                {item.appointments.map((appointment) => (
                  <div key={appointment.id} className="text-xs text-zinc-300 mb-1">
                    {formatDate(appointment.date)} - {appointment.client?.name ?? 'Cliente'}
                  </div>
                ))}
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="bg-zinc-800/30 border-zinc-700">
          <CardHeader><CardTitle className="text-sm text-white">Todas as agendas do período</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <p className="text-[11px] text-zinc-500 mb-2">Base: {COMPANY_BASE.label}</p>
            {periodAppointmentsWithDistance.length === 0 && <p className="text-xs text-zinc-500">Sem agendamentos no período.</p>}
            {periodAppointmentsWithDistance.map((appointment) => (
              <div key={appointment.id} className="rounded-lg border border-zinc-700/60 p-3 text-xs">
                <p className="text-zinc-100 font-medium">{formatDate(appointment.date)} - {formatTime(appointment.startTime)}</p>
                <p className="text-zinc-300 mt-1">Técnico: {appointment.technician?.name ?? 'Sem técnico'}</p>
                <p className="text-zinc-400 mt-1">{appointment.fullAddress}</p>
                <p className="text-zinc-400 mt-1">
                  Distância da base:{" "}
                  {appointment.distanceFromBaseKm == null
                    ? "coordenada indisponível"
                    : `${appointment.distanceFromBaseKm.toFixed(1)} km (~${appointment.estimatedMinutesFromBase} min)`}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="flex-1 relative bg-zinc-950">
        <div ref={mapElementRef} className="absolute inset-0 z-0" />

        {markers.length === 0 && (
          <div className="absolute inset-x-4 bottom-4 z-[500]">
            <Card className="bg-zinc-900/95 border-zinc-800">
              <CardContent className="p-4 text-sm text-zinc-400">
                Nenhum atendimento com localização cadastrado para exibir no mapa.
              </CardContent>
            </Card>
          </div>
        )}

        <div className="absolute top-4 left-4 right-4 flex gap-4 pointer-events-none z-[500]">
          <Card className="bg-zinc-900/90 backdrop-blur border-zinc-800 pointer-events-auto">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
                <MapPin className="h-5 w-5 text-blue-400" />
              </div>
              <div>
                <div className="text-2xl font-bold text-white">{markers.length}</div>
                <div className="text-xs text-zinc-400">Atendimentos no mapa</div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-zinc-900/90 backdrop-blur border-zinc-800 pointer-events-auto">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center">
                <User className="h-5 w-5 text-green-400" />
              </div>
              <div>
                <div className="text-2xl font-bold text-white">{technicians.length}</div>
                <div className="text-xs text-zinc-400">Técnicos envolvidos</div>
              </div>
            </CardContent>
          </Card>
        </div>

        {selectedData && (
          <div className="absolute bottom-4 right-4 w-96 z-[500]">
            <Card className="bg-zinc-900/95 backdrop-blur border-zinc-800">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <MapPin className="h-5 w-5 text-blue-400" />
                    <CardTitle className="text-white text-base">{selectedData.client?.name}</CardTitle>
                  </div>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setSelectedMarker(null)}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="flex items-center gap-2"><User className="h-4 w-4 text-zinc-400" /><span className="text-zinc-300">{selectedData.technician?.name ?? 'Sem técnico'}</span></div>
                  <div className="flex items-center gap-2"><Clock className="h-4 w-4 text-zinc-400" /><span className="text-zinc-300">{formatTime(selectedData.startTime)}</span></div>
                  <div className="flex items-center gap-2"><MapPin className="h-4 w-4 text-zinc-400" /><span className="text-zinc-300">{selectedData.city}</span></div>
                </div>
                <div className="flex gap-2 pt-2">
                  <Link to={`/appointments/${selectedData.id}`} className="flex-1">
                    <Button className="w-full bg-blue-500 hover:bg-blue-600" size="sm">Ver Detalhes</Button>
                  </Link>
                  <a href={`https://www.google.com/maps/dir/?api=1&destination=${selectedData.lat},${selectedData.lng}`} target="_blank" rel="noreferrer">
                    <Button variant="outline" size="sm" className="border-zinc-700"><Navigation className="h-4 w-4" /></Button>
                  </a>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
