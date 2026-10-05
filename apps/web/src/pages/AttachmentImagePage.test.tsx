import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AttachmentImagePage } from './AttachmentImagePage';

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock('../services/apiClient', () => ({ apiFetch: fetchMock }));
afterEach(() => { cleanup(); fetchMock.mockReset(); });

function openImage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/files/image-1/view']}><Routes><Route path="/files/:id/view" element={<AttachmentImagePage />} /></Routes></MemoryRouter></QueryClientProvider>);
}

describe('attachment document links', () => {
  it('requests a fresh authorized URL and displays the image', async () => {
    fetchMock.mockResolvedValue({ url: 'https://storage.test/fresh.png' });
    openImage();
    expect(await screen.findByRole('img')).toHaveAttribute('src', 'https://storage.test/fresh.png');
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/files/image-1/signed-url');
    expect(screen.getByRole('link')).toHaveAttribute('rel', 'noopener noreferrer');
  });
  it('shows an access or missing-file error without a broken image', async () => {
    fetchMock.mockRejectedValue(new Error('not found'));
    openImage();
    expect(await screen.findByRole('alert')).toHaveTextContent('เปิดรูปภาพไม่ได้');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});
