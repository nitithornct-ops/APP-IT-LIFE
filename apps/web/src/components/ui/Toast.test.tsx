import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Toast } from './Toast';

afterEach(() => {
  vi.useRealTimers();
});

describe('Toast', () => {
  it('uses the shared LIFE surface even outside the application shell', () => {
    render(<Toast toast={{ tone: 'success', message: 'บันทึกข้อมูลเรียบร้อยแล้ว' }} onClose={() => undefined} />);

    const toast = screen.getByRole('status');
    expect(toast).toHaveClass('border', 'rounded-xl', 'bg-white', 'shadow-elevated');
    expect(toast).not.toHaveClass('shadow-none');
  });

  it('uses an alert role for errors', () => {
    render(<Toast toast={{ tone: 'error', message: 'บันทึกข้อมูลไม่สำเร็จ' }} onClose={() => undefined} />);

    expect(screen.getByRole('alert')).toHaveTextContent('บันทึกข้อมูลไม่สำเร็จ');
  });
});
