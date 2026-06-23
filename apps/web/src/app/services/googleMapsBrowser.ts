export type BrowserLogisticsSuggestion = {
  ok: boolean;
  distanceText: string | null;
  durationText: string | null;
  durationSeconds: number | null;
  suggestedMode: 'CAR' | 'AIR' | null;
  suggestedReason: string | null;
  nearestAirport: {
    name: string | null;
    formattedAddress: string | null;
    distanceText: string | null;
  } | null;
};

declare global {
  interface Window {
    google?: typeof google;
  }
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

export function loadGoogleMapsBrowser(apiKey: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.google?.maps) {
      resolve();
      return;
    }

    const existing = document.querySelector<HTMLScriptElement>('script[data-google-maps-loader="true"]');
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('Falha ao carregar Google Maps no navegador.')), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}`;
    script.async = true;
    script.defer = true;
    script.dataset.googleMapsLoader = 'true';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Falha ao carregar Google Maps no navegador.'));
    document.head.appendChild(script);
  });
}

function geocode(geocoder: google.maps.Geocoder, address: string) {
  return geocoder.geocode({ address, region: 'BR' });
}

export async function calculateBrowserLogisticsSuggestion(
  apiKey: string,
  origin: string,
  destination: string
): Promise<BrowserLogisticsSuggestion> {
  await loadGoogleMapsBrowser(apiKey);

  if (!window.google?.maps) {
    throw new Error('Google Maps indisponivel no navegador.');
  }

  const directions = new google.maps.DirectionsService();
  const geocoder = new google.maps.Geocoder();

  const response = await directions.route({
    origin,
    destination,
    travelMode: google.maps.TravelMode.DRIVING,
    region: 'BR'
  });

  const leg = response.routes?.[0]?.legs?.[0];
  const distanceText = leg?.distance?.text ?? null;
  const durationText = leg?.duration?.text ?? null;
  const distanceMeters = leg?.distance?.value ?? null;
  const durationSeconds = leg?.duration?.value ?? null;

  if (distanceMeters == null || durationSeconds == null) {
    return {
      ok: false,
      distanceText: null,
      durationText: null,
      durationSeconds: null,
      suggestedMode: null,
      suggestedReason: null,
      nearestAirport: null
    };
  }

  const mustFly = durationSeconds > 10 * 60 * 60;
  let nearestAirport: BrowserLogisticsSuggestion['nearestAirport'] = null;

  if (mustFly) {
    try {
      const [clientGeo] = await geocode(geocoder, destination);
      const clientLocation = clientGeo.results?.[0]?.geometry?.location;
      const cityOnly = destination.split(',').slice(-3).join(', ').trim() || destination;
      const [airportGeo] = await geocode(geocoder, `Aeroporto, ${cityOnly}`);
      const airportResult = airportGeo.results?.[0];
      const airportLocation = airportResult?.geometry?.location;

      if (clientLocation && airportLocation) {
        const km = haversineKm(
          { lat: clientLocation.lat(), lng: clientLocation.lng() },
          { lat: airportLocation.lat(), lng: airportLocation.lng() }
        );

        nearestAirport = {
          name: airportResult?.address_components?.[0]?.long_name ?? airportResult?.formatted_address?.split(',')[0] ?? 'Aeroporto sugerido',
          formattedAddress: airportResult?.formatted_address ?? null,
          distanceText: `${km.toFixed(1)} km`
        };
      }
    } catch {
      nearestAirport = null;
    }
  }

  return {
    ok: true,
    distanceText,
    durationText,
    durationSeconds,
    suggestedMode: mustFly ? 'AIR' : 'CAR',
    suggestedReason: mustFly
      ? 'Tempo estimado de carro acima de 10 horas. Recomendo viagem aerea.'
      : 'Tempo estimado de carro abaixo de 10 horas. Recomendo viagem de carro.',
    nearestAirport
  };
}
