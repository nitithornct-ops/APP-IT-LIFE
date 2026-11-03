import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { DeleteUserModal } from './DeleteUserModal';

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock('../../services/apiClient', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../services/apiClient')>(), apiFetch: mocks.apiFetch,
}));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

it('shows dependencies and requires a reason and explicit confirmation before retaining history', async () => {
  mocks.apiFetch.mockResolvedValueOnce({ hasDependencies: true, dependencies: [{ table: 'notifications', column: 'recipient_id', count: 2 }] }).mockResolvedValueOnce({ removed: true });
  const onClose = vi.fn();
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><DeleteUserModal userId="user-1" identity="somchai" onClose={onClose} /></QueryClientProvider>);
  await screen.findByText('การแจ้งเตือน: 2 รายการ');
  const submit = screen.getByRole('button', { name: 'ยืนยันลบบัญชี' });
  expect(submit).toBeDisabled();
  expect(screen.getByRole('radio', { name: /ลบถาวร/ })).toBeDisabled();
  fireEvent.change(screen.getByRole('textbox', { name: 'เหตุผลการลบ' }), { target: { value: 'พนักงานลาออก' } });
  expect(submit).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(submit);
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  expect(mocks.apiFetch).toHaveBeenLastCalledWith('/api/v1/users/user-1', { method: 'DELETE', body: JSON.stringify({ reason: 'พนักงานลาออก', mode: 'preserve-history' }) });
});

it('does not allow deletion when the preview fails', async () => {
  mocks.apiFetch.mockRejectedValue(new Error('offline'));
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><DeleteUserModal userId="user-2" identity="malee" onClose={vi.fn()} /></QueryClientProvider>);
  await screen.findByRole('alert');
  expect(screen.getByRole('button', { name: 'ยืนยันลบบัญชี' })).toBeDisabled();
  expect(mocks.apiFetch).toHaveBeenCalledTimes(1);
});
