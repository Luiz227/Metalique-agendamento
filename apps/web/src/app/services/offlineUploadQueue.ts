export type OfflineUploadMode = 'report' | 'attachments';

export type OfflineQueuedAttachment = {
  id: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  lastModified: number;
  displayName: string;
  attachmentType: string;
  category: string;
  blob: Blob;
};

export type OfflineReportPayload = {
  summary: string;
  internalNote?: string;
  clientSignatureRefused?: boolean;
  clientSignatureDataUrl?: string;
  technicianSignatureDataUrl?: string;
  finishedAt?: string;
};

export type OfflineUploadItem = {
  id: string;
  mode: OfflineUploadMode;
  appointmentId: string;
  appointmentLabel?: string;
  createdAt: string;
  updatedAt: string;
  attempts: number;
  reportPayload?: OfflineReportPayload;
  attachments: OfflineQueuedAttachment[];
};

const DB_NAME = 'agenda-metalique-offline-uploads';
const DB_VERSION = 1;
const STORE_NAME = 'technicianUploads';

function canUseIndexedDb() {
  return typeof window !== 'undefined' && typeof indexedDB !== 'undefined';
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    if (!canUseIndexedDb()) {
      reject(new Error('Armazenamento offline indisponivel neste navegador.'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('appointmentId', 'appointmentId', { unique: false });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Nao foi possivel abrir a fila offline.'));
  });
}

function withStore<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T> | void) {
  return new Promise<T>((resolve, reject) => {
    openDatabase()
      .then((db) => {
        const transaction = db.transaction(STORE_NAME, mode);
        const store = transaction.objectStore(STORE_NAME);
        let request: IDBRequest<T> | void;

        transaction.oncomplete = () => {
          db.close();
          if (!request) resolve(undefined as T);
        };
        transaction.onerror = () => {
          db.close();
          reject(transaction.error ?? new Error('Falha ao acessar a fila offline.'));
        };

        request = action(store);
        if (request) {
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error ?? new Error('Falha ao acessar a fila offline.'));
        }
      })
      .catch(reject);
  });
}

export function createOfflineUploadId(mode: OfflineUploadMode, appointmentId: string) {
  return `${mode}-${appointmentId}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export async function enqueueOfflineUpload(item: OfflineUploadItem) {
  await withStore('readwrite', (store) => store.put(item));
}

export async function listOfflineUploads() {
  const rows = await withStore<OfflineUploadItem[]>('readonly', (store) => store.getAll());
  return [...(rows ?? [])].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function deleteOfflineUpload(id: string) {
  await withStore('readwrite', (store) => store.delete(id));
}

export async function countOfflineUploads() {
  return withStore<number>('readonly', (store) => store.count());
}
