import { Injectable } from '@nestjs/common';

type GeocodeResult = {
  ok: boolean;
  query: string;
  lat: number | null;
  lng: number | null;
  formattedAddress: string | null;
  provider?: 'google' | 'nominatim';
};

@Injectable()
export class MapsService {
  health() {
    return { ok: true, module: 'maps' };
  }

  async geocode(query: string): Promise<GeocodeResult> {
    const trimmed = this.normalizeQuery(query);
    if (!trimmed) return { ok: false, query, lat: null, lng: null, formattedAddress: null };

    const key = process.env.GOOGLE_MAPS_API_KEY;
    if (key) {
      const google = await this.tryGoogle(trimmed, key);
      if (google.ok) return google;
    }

    const nominatim = await this.tryNominatim(trimmed);
    if (!nominatim.ok) return { ok: false, query: trimmed, lat: null, lng: null, formattedAddress: null };
    return nominatim;
  }

  private async tryGoogle(query: string, key: string): Promise<GeocodeResult> {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&key=${encodeURIComponent(key)}`;
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
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1&addressdetails=1`;
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

  private normalizeQuery(input: string): string {
    return input
      .replace(/t[eé]cnico\s*:/i, '')
      .replace(/\s+/g, ' ')
      .trim();
  }
}
