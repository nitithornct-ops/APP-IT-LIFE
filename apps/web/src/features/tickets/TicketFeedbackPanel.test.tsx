import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TICKET_RATING_CRITERIA } from '@itlife/shared';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TicketDetail } from '../../types/tickets';
import { TicketFeedbackPanel } from './TicketFeedbackPanel';
import { canSubmitTicketFeedback } from './ticketFeedback';

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));

vi.mock('../../services/apiClient', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../services/apiClient')>();
  return { ...original, apiFetch: apiFetchMock };
});

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <TicketFeedbackPanel ticketId="ticket-closed-1" />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('TicketFeedbackPanel', () => {
  it('allows only the requester to rate a closed, unrated Ticket', () => {
    const ticket = { requester_id: 'requester-1', status: 'ปิดงาน', rating: null } as TicketDetail;
    expect(canSubmitTicketFeedback(ticket, 'requester-1')).toBe(true);
    expect(canSubmitTicketFeedback({ ...ticket, status: 'เสร็จสิ้น' }, 'requester-1')).toBe(false);
    expect(canSubmitTicketFeedback({ ...ticket, rating: 5 }, 'requester-1')).toBe(false);
    expect(canSubmitTicketFeedback(ticket, 'another-user')).toBe(false);
  });

  it('requires an explicit 1–5 selection and submits the score with feedback', async () => {
    apiFetchMock.mockImplementation((path: string) => Promise.resolve(
      path === '/api/v1/ticket-rating-criteria'
        ? TICKET_RATING_CRITERIA.map((criterion, index) => ({ id: `criterion-${index}`, ...criterion, description: null, sort_order: (index + 1) * 10, status: 'active' }))
        : { rating: 4 },
    ));
    renderPanel();

    const submit = screen.getByRole('button', { name: 'ส่งแบบประเมิน' });
    expect(submit).toBeDisabled();
    expect(await screen.findByText('ให้คะแนนแล้ว 0/5 หัวข้อ')).toBeVisible();

    const chosenScores = [5, 4, 5, 4, 3];
    const chosenLabels = ['ยอดเยี่ยม', 'ดีมาก', 'ยอดเยี่ยม', 'ดีมาก', 'ดี'];
    ['ความรวดเร็ว', 'คุณภาพงานซ่อม', 'การบริการและมารยาท', 'ความรู้ความสามารถ', 'การสื่อสารและแจ้งความคืบหน้า']
      .forEach((criterion, index) => {
        fireEvent.click(within(screen.getByRole('radiogroup', { name: criterion })).getByRole('radio', { name: `${criterion} ${chosenScores[index]} คะแนน ${chosenLabels[index]}` }));
      });
    fireEvent.change(screen.getByRole('textbox', { name: 'ความคิดเห็นเพิ่มเติม (ไม่บังคับ)' }), {
      target: { value: 'แก้ไขรวดเร็วและแจ้งสถานะชัดเจน' },
    });
    fireEvent.click(submit);

    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledTimes(2));
    expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/tickets/ticket-closed-1/feedback', {
      method: 'POST',
      body: JSON.stringify({
        ratings: { responsiveness: 5, workQuality: 4, serviceManners: 5, expertise: 4, communication: 3 },
        feedback: 'แก้ไขรวดเร็วและแจ้งสถานะชัดเจน',
      }),
    });
    expect(await screen.findByText('ขอบคุณสำหรับการประเมิน')).toBeVisible();
  });
});
