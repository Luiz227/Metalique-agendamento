import { Injectable } from '@nestjs/common';

type GeocodeResult = {
  ok: boolean;
  query: string;
  lat: number | null;
  lng: number | null;
  formattedAddress: string | null;
};

@Injectable()
export class MapsService {
  health() {
    return { ok: true, module: 'maps' };
  }

  async geocode(query: string): Promise<GeocodeResult> {
    const trimmed = query.trim();
    if (!trimmed) return { ok: false, query, lat: null, lng: null, formattedAddress: null };

    const key = process.env.GOOGLE_MAPS_API_KEY;
    if (!key) return { ok: false, query: trimmed, lat: null, lng: null, formattedAddress: null };

    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(trimmed)}&key=${encodeURIComponent(key)}`;
    const response = await fetch(url);
    if (!response.ok) return { ok: false, query: trimmed, lat: null, lng: null, formattedAddress: null };

    const payload = (await response.json()) as {
      status?: string;
      results?: Array<{ formatted_address?: string; geometry?: { location?: { lat?: number; lng?: number } } }>;
    };

    const first = payload.results?.[0];
    const lat = first?.geometry?.location?.lat;
    const lng = first?.geometry?.location?.lng;
    if (typeof lat !== 'number' || typeof lng !== 'number') {
      return { ok: false, query: trimmed, lat: null, lng: null, formattedAddress: null };
    }

    return {
      ok: true,
      query: trimmed,
      lat,
      lng,
      formattedAddress: first?.formatted_address ?? null
    };
  }
}
