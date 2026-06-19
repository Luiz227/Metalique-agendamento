import { Injectable } from '@nestjs/common';

type GeocodeResult = {
  ok: boolean;
  query: string;
  lat: number | null;
  lng: number | null;
  formattedAddress: string | null;
  provider?: 'google' | 'nominatim';
};

type TravelTimeResult = {
  ok: boolean;
  origin: string;
  destination: string;
  distanceMeters: number | null;
  distanceText: string | null;
  durationSeconds: number | null;
  durationText: string | null;
};

type AirportSuggestion = {
  name: string | null;
  formattedAddress: string | null;
  lat: number | null;
  lng: number | null;
  distanceMeters: number | null;
  distanceText: string | null;
};

type LogisticsSuggestionResult = TravelTimeResult & {
  suggestedMode: 'CAR' | 'AIR' | null;
  suggestedReason: string | null;
  nearestAirport: AirportSuggestion | null;
};

@Injectable()
export class MapsService {
  health() {
    return { ok: true, module: 'maps' };
  }

  async geocode(query: string): Promise<GeocodeResult> {
    const trimmed = this.normalizeQuery(query);
    if (!trimmed) return { ok: false, query, lat: null, lng: null, formattedAddress: null };

    const candidates = this.buildGeocodeCandidates(trimmed);
    const key = process.env.GOOGLE_MAPS_API_KEY;

    if (key) {
      for (const candidate of candidates) {
        const google = await this.tryGoogle(candidate, key);
        if (google.ok) return google;
      }
    }

    for (const candidate of candidates) {
      const nominatim = await this.tryNominatim(candidate);
      if (nominatim.ok) return nominatim;
    }

    return { ok: false, query: trimmed, lat: null, lng: null, formattedAddress: null };
  }

  async travelTime(originInput: string, destinationInput: string): Promise<TravelTimeResult> {
    const origin = this.normalizeQuery(originInput);
    const destination = this.normalizeQuery(destinationInput);
    if (!origin || !destination) {
      return {
        ok: false,
        origin,
        destination,
        distanceMeters: null,
        distanceText: null,
        durationSeconds: null,
        durationText: null
      };
    }

    const key = process.env.GOOGLE_MAPS_API_KEY;
    if (key) {
      const googleRoute = await this.tryGoogleRoute(origin, destination, key);
      if (googleRoute.ok) return googleRoute;
    }

    const from = await this.geocode(origin);
    const to = await this.geocode(destination);
    if (!from.ok || !to.ok || from.lat == null || from.lng == null || to.lat == null || to.lng == null) {
      return {
        ok: false,
        origin,
        destination,
        distanceMeters: null,
        distanceText: null,
        durationSeconds: null,
        durationText: null
      };
    }

    const meters = this.haversineKm(from.lat, from.lng, to.lat, to.lng) * 1000;
    const minutes = Math.max(1, Math.round((meters / 1000) * 1.4));
    return {
      ok: true,
      origin,
      destination,
      distanceMeters: Math.round(meters),
      distanceText: `${(meters / 1000).toFixed(1)} km`,
      durationSeconds: minutes * 60,
      durationText: `${minutes} min`
    };
  }

  async logisticsSuggestion(originInput: string, destinationInput: string): Promise<LogisticsSuggestionResult> {
    const route = await this.travelTime(originInput, destinationInput);
    if (!route.ok) {
      return {
        ...route,
        suggestedMode: null,
        suggestedReason: null,
        nearestAirport: null
      };
    }

    const mustFly = (route.durationSeconds ?? 0) > 10 * 60 * 60;
    const nearestAirport = mustFly ? await this.findNearestAirport(route.destination) : null;

    return {
      ...route,
      suggestedMode: mustFly ? 'AIR' : 'CAR',
      suggestedReason: mustFly
        ? 'Tempo estimado de carro acima de 10 horas. Recomendo viagem aerea.'
        : 'Tempo estimado de carro abaixo de 10 horas. Recomendo viagem de carro.',
      nearestAirport
    };
  }

  private async tryGoogle(query: string, key: string): Promise<GeocodeResult> {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&region=br&components=country:BR&key=${encodeURIComponent(key)}`;
    const response = await fetch(url);
    if (!response.ok) return { ok: false, query, lat: null, lng: null, formattedAddress: null };

    const payload = (await response.json()) as {
      status?: string;
      results?: Array<{ formatted_address?: string; geometry?: { location?: { lat?: number; lng?: number } } }>;
    };
    if (payload.status !== 'OK') return { ok: false, query, lat: null, lng: null, formattedAddress: null };
    const first = payload.results?.[0];
    const lat = first?.geometry?.location?.lat;
    const lng = first?.geometry?.location?.lng;
    if (typeof lat !== 'number' || typeof lng !== 'number') return { ok: false, query, lat: null, lng: null, formattedAddress: null };

    return {
      ok: true,
      query,
      lat,
      lng,
      formattedAddress: first?.formatted_address ?? null,
      provider: 'google'
    };
  }

  private async tryNominatim(query: string): Promise<GeocodeResult> {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1&addressdetails=1&countrycodes=br`;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'metalique-agendamento/1.0 (ops@metalique.com.br)' }
    });
    if (!response.ok) return { ok: false, query, lat: null, lng: null, formattedAddress: null };

    const rows = (await response.json()) as Array<{ lat?: string; lon?: string; display_name?: string }>;
    const first = rows?.[0];
    const lat = first?.lat ? Number(first.lat) : NaN;
    const lng = first?.lon ? Number(first.lon) : NaN;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { ok: false, query, lat: null, lng: null, formattedAddress: null };

    return {
      ok: true,
      query,
      lat,
      lng,
      formattedAddress: first?.display_name ?? null,
      provider: 'nominatim'
    };
  }

  private async tryGoogleRoute(origin: string, destination: string, key: string): Promise<TravelTimeResult> {
    const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&mode=driving&region=br&key=${encodeURIComponent(key)}`;
    const response = await fetch(url);
    if (!response.ok) {
      return {
        ok: false,
        origin,
        destination,
        distanceMeters: null,
        distanceText: null,
        durationSeconds: null,
        durationText: null
      };
    }

    const payload = (await response.json()) as {
      status?: string;
      routes?: Array<{
        legs?: Array<{
          distance?: { value?: number; text?: string };
          duration?: { value?: number; text?: string };
        }>;
      }>;
    };

    if (payload.status !== 'OK') {
      return {
        ok: false,
        origin,
        destination,
        distanceMeters: null,
        distanceText: null,
        durationSeconds: null,
        durationText: null
      };
    }

    const leg = payload.routes?.[0]?.legs?.[0];
    const distanceMeters = leg?.distance?.value ?? null;
    const distanceText = leg?.distance?.text ?? null;
    const durationSeconds = leg?.duration?.value ?? null;
    const durationText = leg?.duration?.text ?? null;

    return {
      ok: distanceMeters != null && durationSeconds != null,
      origin,
      destination,
      distanceMeters,
      distanceText,
      durationSeconds,
      durationText
    };
  }

  private async findNearestAirport(destination: string): Promise<AirportSuggestion | null> {
    const place = await this.geocode(destination);
    if (!place.ok || place.lat == null || place.lng == null) return null;

    const key = process.env.GOOGLE_MAPS_API_KEY;
    if (key) {
      const googleAirport = await this.tryGoogleNearbyAirport(place.lat, place.lng, key);
      if (googleAirport) return googleAirport;
    }

    const fallback = await this.geocode(`Aeroporto, ${destination}`);
    if (!fallback.ok || fallback.lat == null || fallback.lng == null) return null;

    const meters = this.haversineKm(place.lat, place.lng, fallback.lat, fallback.lng) * 1000;
    return {
      name: fallback.formattedAddress?.split(',')[0] ?? 'Aeroporto sugerido',
      formattedAddress: fallback.formattedAddress,
      lat: fallback.lat,
      lng: fallback.lng,
      distanceMeters: Math.round(meters),
      distanceText: `${(meters / 1000).toFixed(1)} km`
    };
  }

  private async tryGoogleNearbyAirport(lat: number, lng: number, key: string): Promise<AirportSuggestion | null> {
    const url =
      `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${encodeURIComponent(`${lat},${lng}`)}` +
      `&rankby=distance&type=airport&key=${encodeURIComponent(key)}`;
    const response = await fetch(url);
    if (!response.ok) return null;

    const payload = (await response.json()) as {
      status?: string;
      results?: Array<{
        name?: string;
        vicinity?: string;
        formatted_address?: string;
        geometry?: { location?: { lat?: number; lng?: number } };
      }>;
    };

    if (payload.status !== 'OK' && payload.status !== 'ZERO_RESULTS') return null;
    const first = payload.results?.[0];
    const airportLat = first?.geometry?.location?.lat;
    const airportLng = first?.geometry?.location?.lng;
    if (typeof airportLat !== 'number' || typeof airportLng !== 'number') return null;

    const meters = this.haversineKm(lat, lng, airportLat, airportLng) * 1000;
    return {
      name: first?.name ?? 'Aeroporto sugerido',
      formattedAddress: first?.formatted_address ?? first?.vicinity ?? null,
      lat: airportLat,
      lng: airportLng,
      distanceMeters: Math.round(meters),
      distanceText: `${(meters / 1000).toFixed(1)} km`
    };
  }

  private haversineKm(lat1: number, lon1: number, lat2: number, lon2: number) {
    const radius = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * radius * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  private normalizeQuery(input: string): string {
    return input
      .replace(/t[eéê]cnico\s*:/i, '')
      .replace(/cep\s*:\s*/gi, ' ')
      .replace(/bairro\s*:\s*/gi, ', ')
      .replace(/\s*\/\s*/g, '/')
      .replace(/\s*-\s*/g, ' - ')
      .replace(/\s*,\s*/g, ', ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private buildGeocodeCandidates(input: string) {
    const normalized = input.trim();
    const withoutCountry = normalized.replace(/,?\s*brasil$/i, '').trim();
    const base = withoutCountry
      .replace(/\b([A-ZÀ-ÿ][A-Za-zÀ-ÿ]+)\s*\/\s*([A-Z]{2})\b/g, '$1, $2')
      .replace(/\b([A-ZÀ-ÿ][A-Za-zÀ-ÿ]+)\s*-\s*([A-Z]{2})\b/g, '$1, $2')
      .replace(/\s{2,}/g, ' ')
      .trim();

    const withoutZipCode = base
      .replace(/\b\d{5}-?\d{3}\b/g, ' ')
      .replace(/\s+,/g, ',')
      .replace(/,\s*,+/g, ', ')
      .replace(/\s{2,}/g, ' ')
      .trim()
      .replace(/,\s*$/, '');

    return Array.from(
      new Set(
        [
          `${base}, Brasil`,
          base,
          `${withoutZipCode}, Brasil`,
          withoutZipCode
        ]
          .map((value) =>
            value
              .replace(/,\s*,+/g, ', ')
              .replace(/\s{2,}/g, ' ')
              .trim()
              .replace(/,\s*$/, '')
          )
          .filter(Boolean)
      )
    );
  }
}
