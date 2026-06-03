import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Calendar, ChevronLeft, ChevronRight, Clock, Filter, MapPin, Navigation, User, X } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Input } from '../components/ui/input';
import { api } from '../services/api';
import type { Appointment, Suggestion } from '../services/types';
import { formatDate, formatTime } from '../services/types';

type MapMarker = Appointment & { lat: number; lng: number };
type SearchPoint = { query: string; lat: number; lng: number; formattedAddress: string | null };
type NearbyMapSuggestion = {
  id: string;
  originAppointment: MapMarker;
  nearbyAppointment: MapMarker;
  distanceKm: number;
  durationMinutes: number;
  score: number;
  reason: string;
};

const COMPANY_BASE = {
  label: 'R. Reinaldo Raulino dos Santos, 107 - Éden, Sorocaba - SP',
  lat: -23.4388,
  lng: -47.50594
};

function normalizeColor(value?: string | null) {
  if (!value) return '#3b82f6';
  return value.startsWith('#') ? value : `#${value}`;
}

function markerIcon(color: string, label: string): google.maps.Icon {
  const safeLabel = (label || 'T').slice(0, 1).toUpperCase();
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40">
      <circle cx="20" cy="20" r="18" fill="${color}" stroke="#0b0f19" stroke-width="2" />
      <text x="20" y="25" text-anchor="middle" font-family="Arial, sans-serif" font-size="14" font-weight="700" fill="#ffffff">${safeLabel}</text>
    </svg>
  `;
  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new google.maps.Size(34, 34),
    anchor: new google.maps.Point(17, 17)
  };
}


function loadGoogleMapsScript(apiKey: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if ((window as unknown as { google?: unknown }).google) return resolve();
    const existing = document.querySelector<HTMLScriptElement>('script[data-google-maps-loader="true"]');
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('Falha ao carregar Google Maps')));
      return;
    }
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}`;
    script.async = true;
    script.defer = true;
    script.dataset.googleMapsLoader = 'true';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Falha ao carregar Google Maps'));
    document.head.appendChild(script);
  });
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

function isSameServiceDay(a: Appointment, b: Appointment) {
  const dateA = new Date(a.date);
  const dateB = new Date(b.date);
  return dateA.getFullYear() === dateB.getFullYear() && dateA.getMonth() === dateB.getMonth() && dateA.getDate() === dateB.getDate();
}

function normalizeCityForMaps(city?: string | null) {
  return String(city ?? '')
    .replace(/\s*\/\s*/g, ', ')
    .replace(/\s+-\s+/g, ', ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildMapsQuery(address?: string | null, city?: string | null) {
  return [address?.trim(), normalizeCityForMaps(city), 'Brasil'].filter(Boolean).join(', ');
}

export default function MapView() {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [selectedMarker, setSelectedMarker] = useState<string | null>(null);
  const [filterTechnician, setFilterTechnician] = useState<string>('all');
  const [period, setPeriod] = useState<'week' | 'month'>('week');
  const [referenceDate, setReferenceDate] = useState(() => new Date());
  const [searchAddress, setSearchAddress] = useState('');
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [mapError, setMapError] = useState('');
  const [searchedPoint, setSearchedPoint] = useState<SearchPoint | null>(null);
  const [resolvedCoordsById, setResolvedCoordsById] = useState<Record<string, { lat: number; lng: number }>>({});
  const [routeInfo, setRouteInfo] = useState<{ distanceText: string; durationText: string } | null>(null);

  const mapElementRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<google.maps.Marker[]>([]);
  const polylinesRef = useRef<google.maps.Polyline[]>([]);
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null);
  const directionsRendererRef = useRef<google.maps.DirectionsRenderer | null>(null);

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
      if (appointment.status === 'CRITICAL') return false;
      const date = new Date(appointment.date);
      if (date < start || date > end) return false;
      if (filterTechnician !== 'all' && appointment.technician?.name !== filterTechnician) return false;
      return true;
    });
  }, [appointments, filterTechnician, period, referenceDate]);

  useEffect(() => {
    let cancelled = false;
    async function resolveMissingCoords() {
      const candidates = filteredAppointments.filter(
        (appointment) =>
          !resolvedCoordsById[appointment.id] &&
          (appointment.latitude == null || appointment.longitude == null) &&
          (appointment.fullAddress || appointment.client?.address)
      );
      for (const appointment of candidates.slice(0, 200)) {
        const query = buildMapsQuery(appointment.fullAddress || appointment.client?.address || '', appointment.city);
        try {
          const geo = await api<{ ok: boolean; lat: number | null; lng: number | null }>(`/maps/geocode?q=${encodeURIComponent(query)}`);
          if (cancelled) return;
          if (geo.ok && geo.lat != null && geo.lng != null) {
            setResolvedCoordsById((prev) => ({ ...prev, [appointment.id]: { lat: geo.lat as number, lng: geo.lng as number } }));
          }
        } catch {
          // ignore
        }
      }
    }
    resolveMissingCoords();
    return () => {
      cancelled = true;
    };
  }, [filteredAppointments, resolvedCoordsById]);

  const markers = useMemo<MapMarker[]>(
    () =>
      filteredAppointments
        .filter((appointment) => {
          const resolved = resolvedCoordsById[appointment.id];
          const lat = resolved?.lat ?? appointment.latitude ?? appointment.client?.latitude ?? appointment.technician?.latitude;
          const lng = resolved?.lng ?? appointment.longitude ?? appointment.client?.longitude ?? appointment.technician?.longitude;
          return lat != null && lng != null;
        })
        .map((appointment) => ({
          ...appointment,
          lat: Number(resolvedCoordsById[appointment.id]?.lat ?? appointment.latitude ?? appointment.client?.latitude ?? appointment.technician?.latitude),
          lng: Number(resolvedCoordsById[appointment.id]?.lng ?? appointment.longitude ?? appointment.client?.longitude ?? appointment.technician?.longitude)
        }))
        .filter((a) => Number.isFinite(a.lat) && Number.isFinite(a.lng)),
    [filteredAppointments, resolvedCoordsById]
  );

  const selectedData = selectedMarker ? markers.find((marker) => marker.id === selectedMarker) : null;
  const technicians = Array.from(new Set(filteredAppointments.map((appointment) => appointment.technician?.name).filter(Boolean))) as string[];

  const scheduleByTechnician = useMemo(
    () =>
      technicians.map((technicianName) => ({
        technicianName,
        appointments: filteredAppointments
          .filter((appointment) => appointment.technician?.name === technicianName)
          .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
      })),
    [filteredAppointments, technicians]
  );

  const periodAppointmentsWithDistance = useMemo(
    () =>
      [...filteredAppointments]
        .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
        .map((appointment) => {
          const lat = resolvedCoordsById[appointment.id]?.lat ?? appointment.latitude ?? appointment.client?.latitude ?? appointment.technician?.latitude;
          const lng = resolvedCoordsById[appointment.id]?.lng ?? appointment.longitude ?? appointment.client?.longitude ?? appointment.technician?.longitude;
          if (lat == null || lng == null) return { ...appointment, distanceFromBaseKm: null as number | null, estimatedMinutesFromBase: null as number | null };
          const km = haversineKm(COMPANY_BASE, { lat: Number(lat), lng: Number(lng) });
          return { ...appointment, distanceFromBaseKm: km, estimatedMinutesFromBase: Math.round(km) };
        }),
    [filteredAppointments, resolvedCoordsById]
  );

  const searchContextCity = useMemo(() => {
    const cities = Array.from(new Set(filteredAppointments.map((appointment) => appointment.city).filter(Boolean)));
    return cities.length === 1 ? cities[0] : '';
  }, [filteredAppointments]);

  const visibleSuggestions = useMemo(
    () =>
      suggestions.filter((suggestion) =>
        filteredAppointments.some((apt) => apt.id === suggestion.originAppointment.id || apt.id === suggestion.nearbyAppointment.id)
      ),
    [suggestions, filteredAppointments]
  );

  const nearbyMapSuggestions = useMemo<NearbyMapSuggestion[]>(() => {
    const rows: NearbyMapSuggestion[] = [];

    for (let i = 0; i < markers.length; i += 1) {
      for (let j = i + 1; j < markers.length; j += 1) {
        const a = markers[i];
        const b = markers[j];
        const techA = a.technician?.id ?? a.technician?.name;
        const techB = b.technician?.id ?? b.technician?.name;
        if (!techA || !techB || techA === techB) continue;
        if (!isSameServiceDay(a, b)) continue;

        const distanceKm = haversineKm(a, b);
        if (!Number.isFinite(distanceKm) || distanceKm > 30) continue;

        rows.push({
          id: [a.id, b.id].sort().join(':'),
          originAppointment: a,
          nearbyAppointment: b,
          distanceKm,
          durationMinutes: Math.max(5, Math.round((distanceKm / 50) * 60)),
          score: Math.max(45, Math.min(100, Math.round(100 - distanceKm * 2))),
          reason: 'Atendimentos proximos na mesma data com tecnicos diferentes'
        });
      }
    }

    return rows.sort((a, b) => a.distanceKm - b.distanceKm);
  }, [markers]);

  const periodLabel = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(referenceDate);

  useEffect(() => {
    let disposed = false;
    const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;
    if (!mapElementRef.current || mapRef.current) return;
    if (!key) {
      setMapError('VITE_GOOGLE_MAPS_API_KEY não configurada no frontend.');
      return;
    }
    loadGoogleMapsScript(key)
      .then(() => {
        if (disposed || !mapElementRef.current) return;
        mapRef.current = new google.maps.Map(mapElementRef.current, {
          center: { lat: -14.235, lng: -51.9253 },
          zoom: 4,
          mapTypeControl: false,
          streetViewControl: false
        });
        infoWindowRef.current = new google.maps.InfoWindow();
        directionsRendererRef.current = new google.maps.DirectionsRenderer({
          suppressMarkers: true,
          polylineOptions: { strokeColor: '#22c55e', strokeOpacity: 0.9, strokeWeight: 4 }
        });
        directionsRendererRef.current.setMap(mapRef.current);
        setMapError('');
      })
      .catch((err: Error) => {
        setMapError(err.message || 'Falha ao carregar Google Maps.');
      });
    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    markersRef.current.forEach((m) => m.setMap(null));
    polylinesRef.current.forEach((l) => l.setMap(null));
    markersRef.current = [];
    polylinesRef.current = [];

    const bounds = new google.maps.LatLngBounds();
    markers.forEach((marker) => {
      const techName = marker.technician?.name ?? 'Sem técnico';
      const techColor = normalizeColor(marker.technician?.color);
      const pin = new google.maps.Marker({
        position: { lat: marker.lat, lng: marker.lng },
        map,
        icon: markerIcon(techColor, techName),
        title: `${marker.client?.name ?? 'Cliente'} - ${techName}`
      });
      pin.addListener('click', () => {
        setSelectedMarker(marker.id);
        infoWindowRef.current?.setContent(
          `<strong>${marker.client?.name ?? 'Cliente'}</strong><br/>${marker.city}<br/>${techName} - ${formatTime(marker.startTime)}`
        );
        infoWindowRef.current?.open({ map, anchor: pin });
      });
      markersRef.current.push(pin);
      bounds.extend({ lat: marker.lat, lng: marker.lng });
    });

    visibleSuggestions.slice(0, 8).forEach((suggestion) => {
      const a = markers.find((m) => m.id === suggestion.originAppointment.id);
      const b = markers.find((m) => m.id === suggestion.nearbyAppointment.id);
      if (!a || !b) return;
      const line = new google.maps.Polyline({
        path: [
          { lat: a.lat, lng: a.lng },
          { lat: b.lat, lng: b.lng }
        ],
        strokeColor: '#38bdf8',
        strokeOpacity: 0.8,
        strokeWeight: 3,
        map
      });
      polylinesRef.current.push(line);
      bounds.extend({ lat: a.lat, lng: a.lng });
      bounds.extend({ lat: b.lat, lng: b.lng });
    });

    nearbyMapSuggestions.slice(0, 12).forEach((suggestion) => {
      const line = new google.maps.Polyline({
        path: [
          { lat: suggestion.originAppointment.lat, lng: suggestion.originAppointment.lng },
          { lat: suggestion.nearbyAppointment.lat, lng: suggestion.nearbyAppointment.lng }
        ],
        strokeColor: '#f59e0b',
        strokeOpacity: 0.9,
        strokeWeight: 4,
        map
      });
      polylinesRef.current.push(line);
      bounds.extend({ lat: suggestion.originAppointment.lat, lng: suggestion.originAppointment.lng });
      bounds.extend({ lat: suggestion.nearbyAppointment.lat, lng: suggestion.nearbyAppointment.lng });
    });

    if (!bounds.isEmpty()) map.fitBounds(bounds, 80);
  }, [markers, visibleSuggestions, nearbyMapSuggestions]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !window.google?.maps || markers.length > 0 || filteredAppointments.length === 0) return;

    const geocoder = new google.maps.Geocoder();
    const candidates = filteredAppointments.slice(0, 200);
    let cancelled = false;

    (async () => {
      for (const appointment of candidates) {
        if (cancelled) return;
        if (resolvedCoordsById[appointment.id]) continue;
        const query = buildMapsQuery(appointment.fullAddress || appointment.client?.address || '', appointment.city);
        if (!query) continue;
        try {
          const result = await geocoder.geocode({ address: query });
          const loc = result.results?.[0]?.geometry?.location;
          if (!loc) continue;
          setResolvedCoordsById((prev) => ({ ...prev, [appointment.id]: { lat: loc.lat(), lng: loc.lng() } }));
        } catch {
          // ignora erro individual
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [filteredAppointments, markers.length, resolvedCoordsById]);

  async function handleSearchAddress() {
    const query = searchAddress.trim();
    if (!query) return;
    setSearchLoading(true);
    setSearchError('');
    try {
      const searchQuery = searchContextCity && !query.toLowerCase().includes(searchContextCity.toLowerCase())
        ? buildMapsQuery(query, searchContextCity)
        : query;
      const geo = await api<{ ok: boolean; lat: number | null; lng: number | null; formattedAddress: string | null }>(
        `/maps/geocode?q=${encodeURIComponent(searchQuery)}`
      );
      if (!geo.ok || geo.lat == null || geo.lng == null) {
        setSearchError('Endereço não encontrado.');
        return;
      }
      const point = { query: searchQuery, lat: geo.lat, lng: geo.lng, formattedAddress: geo.formattedAddress };
      setSearchedPoint(point);
      const map = mapRef.current;
      if (map) {
        const marker = new google.maps.Marker({ position: { lat: point.lat, lng: point.lng }, map });
        markersRef.current.push(marker);
        infoWindowRef.current?.setContent(`<strong>Busca</strong><br/>${point.formattedAddress ?? point.query}`);
        infoWindowRef.current?.open({ map, anchor: marker });
        map.setCenter({ lat: point.lat, lng: point.lng });
        map.setZoom(13);
      }
      await drawRouteTo(point.lat, point.lng);
    } finally {
      setSearchLoading(false);
    }
  }

  async function drawRouteTo(lat: number, lng: number) {
    if (!window.google?.maps || !directionsRendererRef.current) return;
    const service = new google.maps.DirectionsService();
    const response = await service.route({
      origin: { lat: COMPANY_BASE.lat, lng: COMPANY_BASE.lng },
      destination: { lat, lng },
      travelMode: google.maps.TravelMode.DRIVING
    });
    directionsRendererRef.current.setDirections(response);
    const leg = response.routes?.[0]?.legs?.[0];
    if (leg?.distance?.text && leg?.duration?.text) {
      setRouteInfo({ distanceText: leg.distance.text, durationText: leg.duration.text });
    } else {
      setRouteInfo(null);
    }
  }

  const searchedDistance = useMemo(() => {
    if (!searchedPoint) return null;
    const km = haversineKm(COMPANY_BASE, { lat: searchedPoint.lat, lng: searchedPoint.lng });
    return { km, min: Math.round(km) };
  }, [searchedPoint]);

  function goPreviousPeriod() {
    setReferenceDate((prev) => {
      const next = new Date(prev);
      if (period === 'week') next.setDate(next.getDate() - 7);
      else next.setMonth(next.getMonth() - 1);
      return next;
    });
  }

  function goNextPeriod() {
    setReferenceDate((prev) => {
      const next = new Date(prev);
      if (period === 'week') next.setDate(next.getDate() + 7);
      else next.setMonth(next.getMonth() + 1);
      return next;
    });
  }

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
              <Button variant={period === 'week' ? 'default' : 'outline'} size="sm" onClick={() => setPeriod('week')}>Semana</Button>
              <Button variant={period === 'month' ? 'default' : 'outline'} size="sm" onClick={() => setPeriod('month')}>Mês</Button>
            </div>
          </div>
          <div className="flex items-center justify-between rounded-lg border border-zinc-700 bg-zinc-800/40 p-2">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={goPreviousPeriod}><ChevronLeft className="h-4 w-4" /></Button>
            <div className="flex items-center gap-2 text-xs text-zinc-200 capitalize"><Calendar className="h-3.5 w-3.5 text-zinc-400" />{periodLabel}</div>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={goNextPeriod}><ChevronRight className="h-4 w-4" /></Button>
          </div>
          <div>
            <label className="text-sm text-zinc-400 mb-1.5 block">Técnico</label>
            <Select value={filterTechnician} onValueChange={setFilterTechnician}>
              <SelectTrigger className="bg-zinc-800/50 border-zinc-700"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {technicians.map((technician) => <SelectItem key={technician} value={technician}>{technician}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-sm text-zinc-400 mb-1.5 block">Pesquisar endereço</label>
            <div className="flex gap-2">
              <Input value={searchAddress} onChange={(e) => setSearchAddress(e.target.value)} placeholder="Rua, número, cidade" className="bg-zinc-800/50 border-zinc-700" />
              <Button onClick={handleSearchAddress} disabled={searchLoading}>{searchLoading ? '...' : 'Buscar'}</Button>
            </div>
            {searchedPoint && <p className="text-xs text-zinc-400 mt-2">{searchedPoint.formattedAddress ?? searchedPoint.query}{searchedDistance ? ` • ${searchedDistance.km.toFixed(1)} km (~${searchedDistance.min} min)` : ''}</p>}
            {searchError && <p className="text-xs text-red-400 mt-2">{searchError}</p>}
            {routeInfo && <p className="text-xs text-green-400 mt-2">Rota: {routeInfo.distanceText} • {routeInfo.durationText}</p>}
          </div>
        </div>
        <Card className="bg-zinc-800/30 border-zinc-700">
          <CardHeader><CardTitle className="text-sm text-white">Todas as agendas do período</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <p className="text-[11px] text-zinc-500 mb-2">Base: {COMPANY_BASE.label}</p>
            {periodAppointmentsWithDistance.length === 0 && <p className="text-xs text-zinc-500">Sem agendamentos no período.</p>}
            {periodAppointmentsWithDistance.map((appointment) => (
              <div key={appointment.id} className="rounded-lg border border-zinc-700/60 p-3 text-xs">
                <p className="text-zinc-100 font-medium">{formatDate(appointment.date)} - {formatTime(appointment.startTime)}</p>
                <p className="text-zinc-300 mt-1">Técnico: {appointment.technician?.name ?? 'Sem técnico'}</p>
                <p className="text-zinc-400 mt-1">{[appointment.fullAddress, appointment.city].filter(Boolean).join(' - ')}</p>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card className="bg-zinc-800/30 border-zinc-700">
          <CardHeader><CardTitle className="text-sm text-white">Sugestoes proximas</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {nearbyMapSuggestions.length === 0 && (
              <p className="text-xs text-zinc-500">Nenhuma sugestao encontrada para atendimentos proximos na mesma data.</p>
            )}
            {nearbyMapSuggestions.slice(0, 8).map((suggestion) => (
              <div key={suggestion.id} className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
                <p className="font-medium text-amber-100">
                  {suggestion.distanceKm.toFixed(1)} km - cerca de {suggestion.durationMinutes} min
                </p>
                <p className="mt-1 text-zinc-200">
                  {suggestion.originAppointment.technician?.name ?? 'Sem tecnico'} + {suggestion.nearbyAppointment.technician?.name ?? 'Sem tecnico'}
                </p>
                <p className="mt-1 text-zinc-400">
                  {suggestion.originAppointment.client?.name ?? 'Cliente'} / {suggestion.nearbyAppointment.client?.name ?? 'Cliente'}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
      <div className="flex-1 relative bg-zinc-950">
        <div ref={mapElementRef} className="absolute inset-0 z-0" />
        {mapError && (
          <div className="absolute top-4 right-4 z-[600] max-w-md rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-300">
            {mapError}
            <div className="mt-2 text-red-200/90">
              Verifique restrição da chave no Google Cloud (HTTP referrer) para:
              <br />
              <code className="text-red-100">https://sistema-metalique-agenda-frontend.eweu2u.easypanel.host/*</code>
            </div>
          </div>
        )}
        {selectedData && (
          <div className="absolute bottom-4 right-4 w-96 z-[500]">
            <Card className="bg-zinc-900/95 backdrop-blur border-zinc-800">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2"><MapPin className="h-5 w-5 text-blue-400" /><CardTitle className="text-white text-base">{selectedData.client?.name}</CardTitle></div>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setSelectedMarker(null)}><X className="h-4 w-4" /></Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="flex items-center gap-2"><User className="h-4 w-4 text-zinc-400" /><span className="text-zinc-300">{selectedData.technician?.name ?? 'Sem técnico'}</span></div>
                  <div className="flex items-center gap-2"><Clock className="h-4 w-4 text-zinc-400" /><span className="text-zinc-300">{formatTime(selectedData.startTime)}</span></div>
                  <div className="flex items-center gap-2"><MapPin className="h-4 w-4 text-zinc-400" /><span className="text-zinc-300">{selectedData.city}</span></div>
                </div>
                <div className="flex gap-2 pt-2">
                  <Link to={`/appointments/${selectedData.id}`} className="flex-1"><Button className="w-full bg-blue-500 hover:bg-blue-600" size="sm">Ver Detalhes</Button></Link>
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

