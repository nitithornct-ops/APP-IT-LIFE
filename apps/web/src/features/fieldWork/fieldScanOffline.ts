export type FieldScanResult = 'found' | 'not_found' | 'wrong_location' | 'wrong_custodian';

export interface LocalFieldScanItem {
  clientRef: string;
  campaignId: string;
  assetId: string | null;
  assetCode: string;
  assetName: string;
  assetType: string | null;
  serialNumber: string | null;
  expectedLocation: string;
  actualLocation: string;
  expectedCustodianEmployeeId: string | null;
  expectedCustodianName: string | null;
  actualCustodianEmployeeId: string | null;
  result: FieldScanResult;
  note: string;
  scannedAt: string;
  photoDataUrl: string | null;
  serverId: string | null;
  syncState: 'pending' | 'synced';
  photoUploaded: boolean;
}

const DB_NAME = 'itlife-field-scan';
const STORE_NAME = 'verification-queue';

// Without IndexedDB the queue lives only in this tab's memory: scans still sync while
// the tab stays open, and custodian employee IDs never land in plain-text localStorage.
const memoryQueue = new Map<string, LocalFieldScanItem>();

function canUseIndexedDb(): boolean {
  return typeof indexedDB !== 'undefined';
}

function readFallback(): LocalFieldScanItem[] {
  return [...memoryQueue.values()].map((item) => ({ ...item }));
}

function writeFallback(items: LocalFieldScanItem[]): void {
  memoryQueue.clear();
  for (const item of items) memoryQueue.set(item.clientRef, item);
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: 'clientRef' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('เปิด offline queue ไม่สำเร็จ'));
  });
}

export async function readFieldScanQueue(campaignId: string): Promise<LocalFieldScanItem[]> {
  if (!canUseIndexedDb()) return readFallback().filter((item) => item.campaignId === campaignId);
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll();
      request.onsuccess = () => resolve((request.result as LocalFieldScanItem[]).filter((item) => item.campaignId === campaignId));
      request.onerror = () => reject(request.error ?? new Error('อ่าน offline queue ไม่สำเร็จ'));
    });
  } catch {
    return readFallback().filter((item) => item.campaignId === campaignId);
  }
}

export async function saveFieldScanItem(item: LocalFieldScanItem): Promise<void> {
  if (!canUseIndexedDb()) {
    const items = readFallback().filter((current) => current.clientRef !== item.clientRef);
    writeFallback([...items, item]);
    return;
  }
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const request = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put(item);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error ?? new Error('บันทึก offline queue ไม่สำเร็จ'));
    });
  } catch {
    const items = readFallback().filter((current) => current.clientRef !== item.clientRef);
    writeFallback([...items, item]);
  }
}

export async function removeFieldScanItem(clientRef: string): Promise<void> {
  if (!canUseIndexedDb()) {
    writeFallback(readFallback().filter((item) => item.clientRef !== clientRef));
    return;
  }
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const request = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).delete(clientRef);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error ?? new Error('ลบ offline queue ไม่สำเร็จ'));
    });
  } catch {
    writeFallback(readFallback().filter((item) => item.clientRef !== clientRef));
  }
}

/** ลดรูปภาพหลักฐานก่อนเก็บลง IndexedDB เพื่อไม่ให้ quota ของมือถือเต็มจากภาพต้นฉบับ */
export function compressEvidencePhoto(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('อ่านรูปหลักฐานไม่สำเร็จ'));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error('อ่านรูปหลักฐานไม่สำเร็จ'));
      image.onload = () => {
        const maxSide = 1280;
        const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.78));
      };
      image.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

export function dataUrlToFile(dataUrl: string, filename: string): File {
  const [header, data] = dataUrl.split(',', 2);
  const mime = /data:([^;]+)/.exec(header)?.[1] ?? 'image/jpeg';
  const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
  return new File([bytes], filename, { type: mime });
}
