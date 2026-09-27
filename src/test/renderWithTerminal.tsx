/**
 * Render helpers for component tests.
 *
 * Components under test need the real provider stack, because the whole point
 * of most of these tests is the wiring between storage, the market feed and the
 * panels. This mounts exactly that stack — no bespoke doubles — so a test can
 * assert on the same tree the browser runs.
 */

import React from 'react';
import { RenderOptions, RenderResult, render } from '@testing-library/react';

import App from '../App';
import { TerminalProvider } from '../context/TerminalContext';

/** Renders a subtree inside the terminal provider. */
export function renderWithTerminal(ui: React.ReactElement, options?: Omit<RenderOptions, 'wrapper'>): RenderResult {
  const wrapper = ({ children }: { children?: React.ReactNode }): React.ReactElement => (
    <TerminalProvider>{children}</TerminalProvider>
  );

  return render(ui, { wrapper, ...options });
}

/** Renders the full application, providers, layout and palette included. */
export function renderApp(options?: Omit<RenderOptions, 'wrapper'>): RenderResult {
  return render(<App />, options);
}
