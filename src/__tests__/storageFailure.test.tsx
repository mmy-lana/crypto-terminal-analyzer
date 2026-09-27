/**
 * Persistence-failure gate.
 *
 * `useTerminalStorage` already detects a failed write — quota exhaustion, or
 * `localStorage` blocked by private browsing — and parks the reason in
 * `storageError`. Before this gate the string was simply never rendered: the
 * trade filled, the panels moved, the operator refreshed, and the paper ledger
 * was gone. A silent persistence failure is the worst kind, because the app
 * looks like it worked.
 *
 * The test drives a real fill through the real terminal and asserts the reason
 * reaches the notice banner the operator is already looking at.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

import App from '../App';
import { setViewportWidth } from '../test/matchMediaMock';

/** Makes every `localStorage` write fail the way an exhausted origin quota does. */
const blockStorageWrites = (name: string): void => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('The quota has been exceeded.', name);
  });
};

/** Opens the TRADE workspace and fills a 0.1 BTC market buy through the ticket. */
const executeARealFill = async (): Promise<void> => {
  render(<App />);

  act(() => {
    fireEvent.click(screen.getByRole('button', { name: /^TRADE/ }));
  });

  act(() => {
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '0.1' } });
  });
  act(() => {
    fireEvent.click(screen.getByRole('button', { name: /^BUY 0\.10 BTC @ MARKET$/ }));
  });

  // The storage failure is discovered by an effect that runs after the fill has
  // already been announced, so the WARN notice lands a commit or two after the
  // EXEC one. Drain that chain before asserting.
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) {
      await Promise.resolve();
    }
  });
};

const bodyText = (): string => document.body.textContent ?? '';

/**
 * The storage alarm, identified by its label.
 *
 * Several panels own a live region — the ledger's export status, the order
 * book's tick summary, the transient notice bar — so a role query alone is
 * ambiguous. The alarm is the one region rendered as an assertive alert.
 */
const storageAlarm = (): HTMLElement | null =>
  screen.queryAllByRole('alert').find((element) => /^STORAGE/.test((element.textContent ?? '').trim())) ?? null;

describe('storage failure surfacing', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setViewportWidth(1280);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('raises a standing alarm after a fill cannot be saved', async () => {
    blockStorageWrites('QuotaExceededError');
    await executeARealFill();

    const alarm = storageAlarm();
    expect(alarm).not.toBeNull();
    expect(alarm).toHaveTextContent('LOCAL STORAGE QUOTA EXCEEDED');
    expect(alarm).toHaveTextContent('SESSION-ONLY');
  });

  it('keeps the alarm up when the next action takes over the notice bar', async () => {
    blockStorageWrites('QuotaExceededError');
    await executeARealFill();

    // The fill announces itself over the notice bar. The persistence failure
    // must not be lost to that — it is the one message about data loss, and
    // the next trade would otherwise bury it for good.
    expect(screen.getAllByRole('status').some((el) => /FILLED/.test(el.textContent ?? ''))).toBe(true);
    expect(storageAlarm()).not.toBeNull();
  });

  it('reports a generically blocked write without inventing a cause', async () => {
    blockStorageWrites('SecurityError');
    await executeARealFill();

    const alarm = storageAlarm();
    expect(alarm).toHaveTextContent('LOCAL STORAGE WRITE BLOCKED');
    // A blocked write is not a quota problem; the copy must not claim one.
    expect(alarm).not.toHaveTextContent('QUOTA EXCEEDED');
  });

  it('stays quiet when persistence is working', async () => {
    await executeARealFill();

    // The fill itself is announced; the storage layer adds no second alarm.
    expect(storageAlarm()).toBeNull();
    expect(bodyText()).not.toContain('LOCAL STORAGE');
    expect(bodyText()).not.toContain('SESSION-ONLY');
  });
});
