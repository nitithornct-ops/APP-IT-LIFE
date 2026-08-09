import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, PackageSearch, Plus, X } from 'lucide-react';
import { useState } from 'react';
import { RequirePermission } from '../../components/RequirePermission';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardBody, CardHeader, StatCard } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { ApiError, apiFetch } from '../../services/apiClient';
import type { PaginatedResult } from '../../types/admin';
import type { InventoryItem, InventoryTransaction } from '../../types/assets';
import { formatThaiDate } from '../../utils/date';

function CreateItemForm({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [itemName, setItemName] = useState('');
  const [category, setCategory] = useState('');
  const [unit, setUnit] = useState('');
  const [stockQty, setStockQty] = useState('0');
  const [minQty, setMinQty] = useState('0');
  const [location, setLocation] = useState('');
  const [unitPrice, setUnitPrice] = useState('');
  const [serverError, setServerError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      apiFetch('/api/v1/inventory-items', {
        method: 'POST',
        body: JSON.stringify({
          itemName,
          category: category || undefined,
          unit,
          stockQty: Number(stockQty) || 0,
          minQty: Number(minQty) || 0,
          location: location || undefined,
          unitPrice: unitPrice ? Number(unitPrice) : undefined,
        }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['inventory-items'] });
      onClose();
    },
    onError: (error) => setServerError(error instanceof ApiError ? error.message : 'เพิ่มรายการไม่สำเร็จ'),
  });

  return (
    <div className="mb-4 grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-3 dark:border-slate-700 dark:bg-slate-900/40">
      <div className="flex items-center justify-between sm:col-span-3">
        <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">เพิ่มรายการ Inventory</h3>
        <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="h-4 w-4" aria-hidden="true" /></button>
      </div>
      <div>
        <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">ชื่อรายการ</label>
        <input data-testid="inv-create-name" value={itemName} onChange={(e) => setItemName(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" />
      </div>
      <div>
        <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">หมวดหมู่</label>
        <input value={category} onChange={(e) => setCategory(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" />
      </div>
      <div>
        <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">หน่วยนับ</label>
        <input data-testid="inv-create-unit" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="ชิ้น / กล่อง / ม้วน" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" />
      </div>
      <div>
        <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">สต็อกเริ่มต้น</label>
        <input type="number" value={stockQty} onChange={(e) => setStockQty(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" />
      </div>
      <div>
        <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">สต็อกขั้นต่ำ</label>
        <input type="number" value={minQty} onChange={(e) => setMinQty(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" />
      </div>
      <div>
        <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">ราคา/หน่วย (บาท)</label>
        <input type="number" step="0.01" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" />
      </div>
      <div>
        <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">สถานที่จัดเก็บ</label>
        <input value={location} onChange={(e) => setLocation(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" />
      </div>
      {serverError && <p className="text-xs text-red-600 sm:col-span-3">{serverError}</p>}
      <div className="sm:col-span-3">
        <Button size="sm" isLoading={mutation.isPending} disabled={!itemName.trim() || !unit.trim()} data-testid="inv-create-submit" onClick={() => mutation.mutate()}>
          บันทึกรายการ
        </Button>
      </div>
    </div>
  );
}

function ItemActions({ item }: { item: InventoryItem }) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<null | 'in' | 'out' | 'adjust' | 'ledger'>(null);
  const [qty, setQty] = useState('');
  const [notes, setNotes] = useState('');
  const [counted, setCounted] = useState(String(item.stock_qty));

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['inventory-items'] });

  const txMutation = useMutation({
    mutationFn: (transactionType: 'IN' | 'OUT') =>
      apiFetch(`/api/v1/inventory-items/${item.id}/transactions`, { method: 'POST', body: JSON.stringify({ transactionType, qty: Number(qty), notes: notes || undefined }) }),
    onSuccess: () => { setMode(null); setQty(''); setNotes(''); invalidate(); },
  });
  const adjustMutation = useMutation({
    mutationFn: () => apiFetch(`/api/v1/inventory-items/${item.id}/adjust`, { method: 'POST', body: JSON.stringify({ counted: Number(counted), notes: notes || undefined }) }),
    onSuccess: () => { setMode(null); setNotes(''); invalidate(); },
  });
  const ledgerQuery = useQuery({
    queryKey: ['inventory-transactions', item.id],
    queryFn: () => apiFetch<InventoryTransaction[]>(`/api/v1/inventory-items/${item.id}/transactions`),
    enabled: mode === 'ledger',
  });

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <button type="button" data-testid={`inv-action-in-${item.id}`} onClick={() => setMode(mode === 'in' ? null : 'in')} className="rounded-full border border-slate-300 px-3 py-1 text-xs dark:border-slate-600">รับเข้า</button>
        <button type="button" data-testid={`inv-action-out-${item.id}`} onClick={() => setMode(mode === 'out' ? null : 'out')} className="rounded-full border border-slate-300 px-3 py-1 text-xs dark:border-slate-600">เบิกออก</button>
        <button type="button" data-testid={`inv-action-adjust-${item.id}`} onClick={() => setMode(mode === 'adjust' ? null : 'adjust')} className="rounded-full border border-slate-300 px-3 py-1 text-xs dark:border-slate-600">ตรวจนับ</button>
        <button type="button" data-testid={`inv-action-ledger-${item.id}`} onClick={() => setMode(mode === 'ledger' ? null : 'ledger')} className="rounded-full border border-slate-300 px-3 py-1 text-xs dark:border-slate-600">ประวัติ</button>
      </div>

      {(mode === 'in' || mode === 'out') && (
        <div className="mt-2 flex items-center gap-2">
          <input type="number" min="0" step="0.01" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="จำนวน" className="w-24 rounded-lg border border-slate-300 px-2 py-1 text-xs dark:border-slate-600 dark:bg-slate-900" />
          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="หมายเหตุ" className="rounded-lg border border-slate-300 px-2 py-1 text-xs dark:border-slate-600 dark:bg-slate-900" />
          <Button
            size="sm"
            isLoading={txMutation.isPending}
            disabled={!qty || Number(qty) <= 0}
            data-testid={`inv-tx-submit-${item.id}`}
            onClick={() => txMutation.mutate(mode === 'in' ? 'IN' : 'OUT')}
          >
            บันทึก
          </Button>
        </div>
      )}

      {mode === 'adjust' && (
        <div className="mt-2 flex items-center gap-2">
          <input type="number" min="0" value={counted} onChange={(e) => setCounted(e.target.value)} className="w-24 rounded-lg border border-slate-300 px-2 py-1 text-xs dark:border-slate-600 dark:bg-slate-900" />
          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="หมายเหตุ" className="rounded-lg border border-slate-300 px-2 py-1 text-xs dark:border-slate-600 dark:bg-slate-900" />
          <Button size="sm" isLoading={adjustMutation.isPending} data-testid={`inv-adjust-submit-${item.id}`} onClick={() => adjustMutation.mutate()}>
            บันทึกผลนับ
          </Button>
        </div>
      )}

      {mode === 'ledger' && (
        <div className="mt-2 max-h-48 overflow-y-auto text-xs">
          {ledgerQuery.isLoading && <Loader2 className="h-4 w-4 animate-spin text-slate-400" aria-hidden="true" />}
          {(ledgerQuery.data ?? []).map((tx) => (
            <div key={tx.id} className="flex items-center justify-between border-b border-slate-100 py-1 dark:border-slate-700">
              <span>{formatThaiDate(tx.created_at, 'd MMM yyyy HH:mm')}</span>
              <span>{tx.transaction_type} {tx.qty}</span>
              <span className="text-slate-400">คงเหลือ {tx.balance_after}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function InventoryPage() {
  const [showCreate, setShowCreate] = useState(false);
  const [search, setSearch] = useState('');
  const [lowStockOnly, setLowStockOnly] = useState(false);

  const itemsQuery = useQuery({
    queryKey: ['inventory-items', search, lowStockOnly],
    queryFn: () =>
      apiFetch<PaginatedResult<InventoryItem>>(
        `/api/v1/inventory-items?page=1&pageSize=50${search ? `&search=${encodeURIComponent(search)}` : ''}${lowStockOnly ? '&lowStockOnly=true' : ''}`,
      ),
  });

  const items = itemsQuery.data?.items ?? [];
  const lowCount = items.filter((i) => i.low).length;
  const totalValue = items.reduce((sum, i) => sum + i.value, 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Inventory — อะไหล่/วัสดุสิ้นเปลือง</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">เบิก-รับ-ตรวจนับสต็อกอะไหล่และวัสดุสิ้นเปลือง</p>
        </div>
        <RequirePermission permission="inventory.manage">
          <Button size="sm" onClick={() => setShowCreate((v) => !v)} data-testid="inv-create-toggle">
            <Plus className="h-4 w-4" aria-hidden="true" />
            เพิ่มรายการ
          </Button>
        </RequirePermission>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard icon={<PackageSearch className="h-5 w-5" aria-hidden="true" />} label="รายการทั้งหมด (หน้านี้)" value={items.length} tone="primary" />
        <StatCard icon={<PackageSearch className="h-5 w-5" aria-hidden="true" />} label="ใกล้หมด (หน้านี้)" value={lowCount} tone="amber" />
        <StatCard icon={<PackageSearch className="h-5 w-5" aria-hidden="true" />} label="มูลค่าสต็อก (หน้านี้)" value={totalValue.toLocaleString('th-TH')} tone="teal" />
      </div>

      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-2">
          <span>รายการ Inventory</span>
          <button
            type="button"
            onClick={() => setLowStockOnly((v) => !v)}
            className={`rounded-full px-3 py-1 text-xs ${lowStockOnly ? 'bg-primary-700 text-white' : 'border border-slate-300 text-slate-600 dark:border-slate-600 dark:text-slate-300'}`}
          >
            ใกล้หมดเท่านั้น
          </button>
        </CardHeader>
        <CardBody>
          {showCreate && <CreateItemForm onClose={() => setShowCreate(false)} />}

          <input
            type="search"
            placeholder="ค้นหาชื่อรายการ หรือหมวดหมู่..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="mb-3 w-full max-w-sm rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
          />

          {itemsQuery.isLoading && (
            <div className="flex justify-center py-8" role="status">
              <Loader2 className="h-5 w-5 animate-spin text-slate-400" aria-hidden="true" />
            </div>
          )}
          {itemsQuery.data && items.length === 0 && <EmptyState icon={<PackageSearch className="h-10 w-10" aria-hidden="true" />} title="ไม่พบรายการ" />}

          <div className="flex flex-col gap-2">
            {items.map((item) => (
              <div key={item.id} data-testid={`inv-row-${item.id}`} className="rounded-lg border border-slate-100 p-3 dark:border-slate-700">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-medium text-slate-800 dark:text-slate-200">
                      {item.item_name} {item.low && <Badge variant="warning">ใกล้หมด</Badge>}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {item.category ?? 'ไม่ระบุหมวดหมู่'} · คงเหลือ {item.stock_qty} {item.unit} (ขั้นต่ำ {item.min_qty})
                    </p>
                  </div>
                  <span className="text-sm text-slate-500 dark:text-slate-400">{item.value.toLocaleString('th-TH')} บาท</span>
                </div>
                <RequirePermission permission="inventory.manage">
                  <div className="mt-2">
                    <ItemActions item={item} />
                  </div>
                </RequirePermission>
              </div>
            ))}
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
