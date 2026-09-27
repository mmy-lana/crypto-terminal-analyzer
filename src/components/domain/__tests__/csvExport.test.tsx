/**
 * CSV export safety gate (CWE-1236 / OWASP CSV injection).
 *
 * The ledger export writes user-shaped strings — order ids, symbols — into a
 * file that is, by design, opened in a spreadsheet. A cell starting with `=`,
 * `+`, `-`, `@`, tab or CR is *executed* by Excel, Numbers and Sheets rather
 * than displayed, so an unescaped `=HYPERLINK(...)` in an order id becomes a
 * live exfiltration vector on the operator's own machine.
 *
 * Both halves matter: the unit block pins the escaping rule itself, and the
 * integration block proves the rule is actually wired into the file the export
 * button downloads. A correct helper that nobody calls is still a vulnerability.
 */

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';

import { TransactionLedger, escapeCsvField } from '../TransactionLedger';
import { renderWithTerminal } from '../../../test/renderWithTerminal';
import { createInitialState, STORAGE_KEY } from '../../../hooks/useTerminalStorage';
import { TransactionRecord } from '../../../types/terminal';

/** A ledger row whose order id and symbol are both formula triggers. */
const HOSTILE: TransactionRecord = {
  id: 'TX-1',
  orderId: '=cmd|\' /C calc\'!A0',
  symbol: '@SUM(1+1)*cmd|calc',
  side: 'BUY',
  executionPrice: 100,
  amount: 2,
  totalValue: 200,
  fee: 0.2,
  timestamp: '2026-01-01T00:00:00.000Z',
};

describe('escapeCsvField', () => {
  it.each(['=1+1', '+1', '-1', '@SUM(A1)', '\tvalue', '\rvalue'])(
    'neutralises the formula trigger %j with a leading apostrophe',
    (value) => {
      const escaped = escapeCsvField(value);
      expect(escaped.startsWith("'")).toBe(true);
      // The apostrophe is prepended, never substituted: the data survives.
      expect(escaped).toContain(value);
    }
  );

  it('leaves ordinary values untouched', () => {
    expect(escapeCsvField('ORD-0f1c2b3c')).toBe('ORD-0f1c2b3c');
    expect(escapeCsvField('BTC')).toBe('BTC');
    expect(escapeCsvField('200')).toBe('200');
  });

  it('still quotes delimiters, and keeps the apostrophe ahead of the value', () => {
    expect(escapeCsvField('a,b')).toBe('"a,b"');
    expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvField('line\nbreak')).toBe('"line\nbreak"');

    // A formula trigger *and* a comma: the marker has to survive quoting as the
    // first character of the cell, or the cell re-reads as a formula once the
    // spreadsheet strips the surrounding quotes.
    expect(escapeCsvField('=1,1')).toBe(`"'=1,1"`);

    /** The cell value a spreadsheet actually reads, quotes removed. */
    const decode = (field: string): string =>
      field.startsWith('"') ? field.slice(1, -1).replace(/""/g, '"') : field;

    for (const hostile of ['=1,1', '=cmd,\'x\'', '@a"b', '\t=1']) {
      const decoded = decode(escapeCsvField(hostile));
      expect(decoded.startsWith("'")).toBe(true);
      expect(/^[=+\-@\t\r]/.test(decoded)).toBe(false);
    }
  });

  it('never leaves a decoded cell starting with a formula trigger', () => {
    for (const hostile of ['=1+1', '@x', '\t=cmd', '-2+3']) {
      expect(/^[=+\-@\t\r]/.test(escapeCsvField(hostile))).toBe(false);
    }
  });
});

describe('ledger CSV export', () => {
  /** Seeds a persisted account carrying one hostile row, then mounts the ledger. */
  const renderLedgerWith = (transactions: TransactionRecord[]): void => {
    const schema = { ...createInitialState(), transactions };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(schema));
    renderWithTerminal(<TransactionLedger />);
  };

  /** Clicks EXPORT CSV and returns the text the browser was handed. */
  const exportAndRead = async (): Promise<string> => {
    let captured: Blob | null = null;
    const createObjectURL = vi.fn((blob: Blob) => {
      captured = blob;
      return 'blob:test';
    });
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });

    fireEvent.click(screen.getByRole('button', { name: 'EXPORT CSV' }));
    vi.unstubAllGlobals();

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    return (captured as unknown as Blob).text();
  };

  it('writes the hostile row with every formula trigger neutralised', async () => {
    renderLedgerWith([HOSTILE]);
    const csv = await exportAndRead();

    const [header, row] = csv.trim().split('\n');
    expect(header).toBe('Timestamp,Order,Side,Symbol,Amount,Price,Notional,Fee');

    // Order id and symbol are the two operator-shaped fields; neither carries a
    // delimiter, so neither is quoted — but both must open with the apostrophe.
    const cells = (row ?? '').split(',');
    expect(cells[1]).toBe(`'${HOSTILE.orderId}`);
    expect(cells[3]).toBe(`'${HOSTILE.symbol}`);

    // The decisive assertion: no cell in the file begins with a live formula.
    for (const cell of cells) {
      expect(/^[=+\-@\t\r]/.test(cell)).toBe(false);
    }
  });

  it('exports a clean row byte-for-byte unaltered', async () => {
    const clean: TransactionRecord = { ...HOSTILE, orderId: 'ORD-abc123', symbol: 'BTC' };
    renderLedgerWith([clean]);
    const csv = await exportAndRead();

    const cells = csv.trim().split('\n')[1]?.split(',') ?? [];
    expect(cells[1]).toBe('ORD-abc123');
    expect(cells[3]).toBe('BTC');
    // Sanitising must not tax the common case with stray apostrophes.
    expect(csv).not.toContain("'");
  });
});
