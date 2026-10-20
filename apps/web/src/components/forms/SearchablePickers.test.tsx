import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Modal } from '../ui/Modal';
import { SearchableSelect } from './SearchableSelect';
import { SearchableMultiSelect } from './SearchableMultiSelect';

const options = [
  { id: 'first', label: 'ฝ่ายการเงินและบัญชี' },
  { id: 'second', label: 'ฝ่ายเทคโนโลยีสารสนเทศ' },
];

afterEach(cleanup);

describe('searchable picker keyboard navigation', () => {
  it('selects the active result with arrows and Enter', () => {
    const onChange = vi.fn();
    render(<SearchableSelect label="หน่วยงาน" options={options} value="" onChange={onChange} />);
    const input = screen.getByRole('combobox', { name: 'หน่วยงาน' });
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    const active = screen.getByRole('option', { name: options[1].label });
    expect(input).toHaveAttribute('aria-activedescendant', active.id);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('second');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('closes the list before Escape closes its containing dialog', async () => {
    const onClose = vi.fn();
    render(<Modal title="เลือกหน่วยงาน" onClose={onClose}>
      <SearchableSelect label="หน่วยงาน" options={options} value="" onChange={vi.fn()} />
    </Modal>);
    const input = screen.getByRole('combobox', { name: 'หน่วยงาน' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'ปิดหน้าต่าง' })).toHaveFocus());
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('resets the active result after filtering and supports multiple selections', () => {
    function Example() {
      const [value, setValue] = useState<string[]>([]);
      return <SearchableMultiSelect label="ผู้เกี่ยวข้อง" options={options} value={value} onChange={setValue} />;
    }
    render(<Example />);
    const input = screen.getByRole('combobox', { name: 'ผู้เกี่ยวข้อง' });
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.change(input, { target: { value: 'การเงิน' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByRole('button', { name: `เอา ${options[0].label} ออก` })).toBeVisible();
    expect(screen.getByRole('listbox')).toHaveAttribute('aria-multiselectable', 'true');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.queryByRole('button', { name: `เอา ${options[0].label} ออก` })).not.toBeInTheDocument();
  });

  it('does not clear or open a disabled field', () => {
    const onChange = vi.fn();
    render(<SearchableSelect label="หน่วยงาน" options={options} value="first" onChange={onChange} disabled />);
    fireEvent.click(screen.getByRole('button', { name: 'ล้าง หน่วยงาน' }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('combobox')).toBeDisabled();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});
