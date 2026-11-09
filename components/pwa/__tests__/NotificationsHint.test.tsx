import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationsHint } from '../NotificationsHint';

const browser = vi.hoisted(() => ({
  pushSupport: vi.fn(),
  currentSubscription: vi.fn(),
}));

vi.mock('@/lib/notifications/browser', () => browser);
vi.mock('../InstallAppButton', () => ({
  InstallAppButton: () => <button type="button">Instalar o app no celular</button>,
}));

beforeEach(() => {
  browser.pushSupport.mockReset();
  browser.currentSubscription.mockReset();
});

describe('NotificationsHint', () => {
  it('no iPhone no navegador, leva ao tutorial de instalar', () => {
    browser.pushSupport.mockReturnValue('ios-install');

    render(<NotificationsHint onActivate={() => {}} />);

    expect(screen.getByText(/só chegam neste aparelho com o app instalado/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Instalar o app no celular' })).toBeInTheDocument();
  });

  it('sem notificações ligadas, "Ativar" abre os ajustes', async () => {
    browser.pushSupport.mockReturnValue('supported');
    browser.currentSubscription.mockResolvedValue(null);
    const onActivate = vi.fn();

    render(<NotificationsHint onActivate={onActivate} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Ativar' }));

    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it('com as notificações ligadas, não mostra nada', async () => {
    browser.pushSupport.mockReturnValue('supported');
    browser.currentSubscription.mockResolvedValue({ endpoint: 'https://push' });

    const { container } = render(<NotificationsHint onActivate={() => {}} />);
    await vi.waitFor(() => expect(browser.currentSubscription).toHaveBeenCalled());

    expect(container).toBeEmptyDOMElement();
  });

  it('num iPhone antigo, onde não dá para fazer nada, não mostra nada', () => {
    browser.pushSupport.mockReturnValue('ios-update');

    const { container } = render(<NotificationsHint onActivate={() => {}} />);

    expect(container).toBeEmptyDOMElement();
  });
});
