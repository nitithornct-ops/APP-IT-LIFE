import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Task } from '../../types/tasks';
import { TaskActions } from './TasksPage';

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
    deletePending: false,
    onView: vi.fn(),
    onEdit: vi.fn(),
    onStatus: vi.fn(),
    onDelete: vi.fn(),
    ...overrides,
  };

  render(<MemoryRouter><TaskActions {...props} /></MemoryRouter>);
  return props;
}

afterEach(cleanup);

describe('TaskActions', () => {
  it('provides separate view and edit actions in a task row', () => {
    const props = renderActions();

    fireEvent.click(screen.getByRole('button', { name: 'ดู ตรวจสอบระบบ LINE' }));
    fireEvent.click(screen.getByRole('button', { name: 'แก้ไข ตรวจสอบระบบ LINE' }));

    expect(props.onView).toHaveBeenCalledOnce();
    expect(props.onEdit).toHaveBeenCalledOnce();
  });

  it('requires confirmation before soft-deleting a task', () => {
    const props = renderActions();

    fireEvent.click(screen.getByRole('button', { name: 'ลบ ตรวจสอบระบบ LINE' }));
    expect(props.onDelete).not.toHaveBeenCalled();
    expect(screen.getByText(/ระบบยังเก็บประวัติไว้/)).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'ลบข้อมูล' }));
    expect(props.onDelete).toHaveBeenCalledOnce();
  });

  it('does not offer delete again after the task is already cancelled', () => {
    renderActions({ task: { ...task, status: 'ยกเลิก' } });

    expect(screen.queryByRole('button', { name: 'ลบ ตรวจสอบระบบ LINE' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'แก้ไข ตรวจสอบระบบ LINE' })).toBeVisible();
  });
});
