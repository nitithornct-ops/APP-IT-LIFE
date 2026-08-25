import { act, cleanup, render, waitFor } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TurnstileWidget, type TurnstileWidgetHandle } from './TurnstileWidget';

describe('TurnstileWidget', () => {
  afterEach(() => {
    cleanup();
    delete window.turnstile;
  });

  it('returns the token and resets the same rendered widget', async () => {
    let callback: ((token: string) => void) | undefined;
    const reset = vi.fn();
    const remove = vi.fn();
    window.turnstile = {
      render: vi.fn((_container, options) => {
        callback = options.callback;
        return 'login-widget';
      }),
      reset,
      remove,
    };
    const onTokenChange = vi.fn();
    const ref = createRef<TurnstileWidgetHandle>();

    const view = render(<TurnstileWidget ref={ref} action="login" onTokenChange={onTokenChange} />);
    await waitFor(() => expect(window.turnstile?.render).toHaveBeenCalledOnce());

    act(() => callback?.('verified-token'));
    expect(onTokenChange).toHaveBeenCalledWith('verified-token');

    act(() => ref.current?.reset());
    expect(reset).toHaveBeenCalledWith('login-widget');
    expect(onTokenChange).toHaveBeenLastCalledWith('');

    view.unmount();
    expect(remove).toHaveBeenCalledWith('login-widget');
  });
});
