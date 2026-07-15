import { Injectable } from '@nestjs/common';
import { ApiUsageService } from '../api-usage/api-usage.service';

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
  constructor(private readonly apiUsage: ApiUsageService) {}

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

    // Do not estimate route time by straight-line distance. The frontend can
    // still fall back to the browser Google Maps SDK for an actual road route.
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

    return {
      ...route,
      suggestedMode: mustFly ? 'AIR' : 'CAR',
      suggestedReason: mustFly
        ? 'Tempo estimado de carro acima de 10 horas. Recomendo viagem aérea.'
        : 'Tempo estimado de carro abaixo de 10 horas. Recomendo viagem de carro.',
      nearestAirport: null
    };
  }

  private async tryGoogle(query: string, key: string): Promise<GeocodeResult> {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&region=br&components=country:BR&key=${encodeURIComponent(key)}`;
    const response = await fetch(url);
    if (!response.ok) {
      void this.trackUsage('google', 'maps-geocoding', 'geocode', 'ERROR', { query, httpStatus: response.status });
      return { ok: false, query, lat: null, lng: null, formattedAddress: null };
    }

    const payload = (await response.json()) as {
      status?: string;
      results?: Array<{ formatted_address?: string; geometry?: { location?: { lat?: number; lng?: number } } }>;
    };
    void this.trackUsage('google', 'maps-geocoding', 'geocode', payload.status === 'OK' ? 'SUCCESS' : 'ERROR', {
      query,
      apiStatus: payload.status ?? 'UNKNOWN'
    });
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
    if (!response.ok) {
      void this.trackUsage('nominatim', 'geocoding-fallback', 'geocode', 'ERROR', { query, httpStatus: response.status });
      return { ok: false, query, lat: null, lng: null, formattedAddress: null };
    }

    const rows = (await response.json()) as Array<{ lat?: string; lon?: string; display_name?: string }>;
    void this.trackUsage('nominatim', 'geocoding-fallback', 'geocode', rows?.[0] ? 'SUCCESS' : 'ERROR', { query });
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
      void this.trackUsage('google', 'maps-directions', 'driving-route', 'ERROR', {
        origin,
        destination,
        httpStatus: response.status
      });
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

    void this.trackUsage('google', 'maps-directions', 'driving-route', payload.status === 'OK' ? 'SUCCESS' : 'ERROR', {
      origin,
      destination,
      apiStatus: payload.status ?? 'UNKNOWN'
    });

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

    const strippedVenue = this.stripVenuePrefix(base);

    const withoutZipCode = base
      .replace(/\b\d{5}-?\d{3}\b/g, ' ')
      .replace(/\s+,/g, ',')
      .replace(/,\s*,+/g, ', ')
      .replace(/\s{2,}/g, ' ')
      .trim()
      .replace(/,\s*$/, '');

    const strippedVenueWithoutZipCode = strippedVenue
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
          `${strippedVenue}, Brasil`,
          strippedVenue,
          `${withoutZipCode}, Brasil`,
          withoutZipCode,
          `${strippedVenueWithoutZipCode}, Brasil`,
          strippedVenueWithoutZipCode
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

  private stripVenuePrefix(input: string) {
    const normalized = input.trim();
    const looksLikeStreet = (value: string) =>
      /(^|\b)(rua|r\.|avenida|av\.|rodovia|rod\.|estrada|alameda|travessa|tv\.|praca|praça|loteamento|condominio|condomínio|viela)\b/i.test(
        value
      ) || /\d/.test(value);

    const dashParts = normalized.split(/\s+-\s+/).map((part) => part.trim()).filter(Boolean);
    if (dashParts.length > 1 && !looksLikeStreet(dashParts[0]) && looksLikeStreet(dashParts.slice(1).join(' - '))) {
      return dashParts.slice(1).join(' - ');
    }

    const commaParts = normalized.split(',').map((part) => part.trim()).filter(Boolean);
    if (commaParts.length > 1 && !looksLikeStreet(commaParts[0]) && looksLikeStreet(commaParts.slice(1).join(', '))) {
      return commaParts.slice(1).join(', ');
    }

    return normalized;
  }

  private async trackUsage(
    provider: string,
    service: string,
    action: string,
    status: 'SUCCESS' | 'ERROR',
    metadata?: Record<string, string | number | null>
  ) {
    await this.apiUsage.track({ provider, service, action, status, metadata });
  }
}
