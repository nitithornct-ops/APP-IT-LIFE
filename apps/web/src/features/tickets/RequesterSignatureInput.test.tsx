import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RequesterSignatureInput } from './RequesterSignatureInput';

afterEach(cleanup);

describe('RequesterSignatureInput', () => {
  it('reserves space for the clear action before drawing to avoid moving the signature pad', () => {
    render(<RequesterSignatureInput onChange={vi.fn()} />);

    const clearButton = screen.getByText(/ล้างลายเซ็น/).closest('button');

    expect(clearButton).toHaveClass('invisible');
    expect(clearButton).toBeDisabled();
  });

  it('accepts a PNG signature as an accessible alternative to drawing', () => {
    const onChange = vi.fn();
    render(<RequesterSignatureInput onChange={onChange} />);
    const file = new File(['png'], 'signature.png', { type: 'image/png' });

    fireEvent.change(screen.getByLabelText('ไฟล์ลายเซ็นผู้แจ้ง PNG'), { target: { files: [file] } });

    expect(onChange).toHaveBeenCalledWith(file);
    expect(screen.getByRole('button', { name: /ล้างลายเซ็น/ })).not.toHaveClass('invisible');
  });
});
