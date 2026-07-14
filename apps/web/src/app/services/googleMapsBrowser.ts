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

  return {
    ok: true,
    distanceText,
    durationText,
    durationSeconds,
    suggestedMode: mustFly ? 'AIR' : 'CAR',
    suggestedReason: mustFly
      ? 'Tempo estimado de carro acima de 10 horas. Recomendo viagem aérea.'
      : 'Tempo estimado de carro abaixo de 10 horas. Recomendo viagem de carro.',
    nearestAirport: null
  };
}
