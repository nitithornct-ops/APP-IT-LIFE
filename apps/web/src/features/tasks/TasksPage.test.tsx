import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Task } from '../../types/tasks';
import { TaskActions } from './TasksPage';

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn() }));

vi.mock('../../services/apiClient', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../services/apiClient')>();
  return { ...original, apiFetch: mocks.apiFetch };
});

const task = {
  id: 'task-1',
  task_no: 'TSK-0001',
  title: 'ตรวจสอบระบบ LINE',
  status: 'ต้องทำ',
} as Task;

function renderActions(overrides: Partial<React.ComponentProps<typeof TaskActions>> = {}) {
  const props: React.ComponentProps<typeof TaskActions> = {
    task,
    statusPending: false,
    onView: vi.fn(),
    onEdit: vi.fn(),
    onStatus: vi.fn(),
    ...overrides,
  };

  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={queryClient}><MemoryRouter><TaskActions {...props} /></MemoryRouter></QueryClientProvider>);
  return props;
}

afterEach(() => {
  cleanup();
  mocks.apiFetch.mockReset();
});

describe('TaskActions', () => {
  it('provides separate view and edit actions in a task row', () => {
    const props = renderActions();

    fireEvent.click(screen.getByRole('button', { name: 'ดู ตรวจสอบระบบ LINE' }));
    fireEvent.click(screen.getByRole('button', { name: 'แก้ไข ตรวจสอบระบบ LINE' }));

    expect(props.onView).toHaveBeenCalledOnce();
    expect(props.onEdit).toHaveBeenCalledOnce();
  });

  it('requires confirmation and a reason before permanently deleting a task', async () => {
    mocks.apiFetch.mockResolvedValueOnce({ id: 'task-1', mode: 'hard_delete' });
    renderActions();

    fireEvent.click(screen.getByRole('button', { name: 'ลบ ตรวจสอบระบบ LINE' }));
    expect(screen.getByText(/ไม่สามารถกู้คืนได้/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'ลบข้อมูล' })).toBeDisabled();

    fireEvent.change(screen.getByTestId('row-actions-reason'), { target: { value: 'งานนี้ไม่ใช้งานแล้ว' } });
    fireEvent.click(screen.getByRole('button', { name: 'ลบข้อมูล' }));
    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalledWith(
      '/api/v1/tasks/task-1',
      { method: 'DELETE', body: JSON.stringify({ reason: 'งานนี้ไม่ใช้งานแล้ว' }) },
    ));
  });

  it('keeps permanent delete available after a task was cancelled', () => {
    renderActions({ task: { ...task, status: 'ยกเลิก' } });

    expect(screen.getByRole('button', { name: 'ลบ ตรวจสอบระบบ LINE' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'แก้ไข ตรวจสอบระบบ LINE' })).toBeVisible();
  });
});
