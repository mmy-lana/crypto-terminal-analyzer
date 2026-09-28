# crypto-terminal-analyzer

A modernized Bloomberg-style financial terminal for cryptocurrency portfolio analysis and real-time paper trading execution. Built with React, Tailwind CSS, TypeScript, and Vite.

Live Demo: https://crypto-terminal-analyzer.vercel.app  
Repository: https://github.com/mmy-lana/crypto-terminal-analyzer

---

## Overview

`crypto-terminal-analyzer` delivers high-density financial analytics and simulated order execution without the cognitive overload of legacy terminals. Engineered to Tier-1 institutional standards, it combines real-time streaming market data, synthetic L2 order book depth, automated escrow margin management, and mathematical risk attribution into a unified, responsive interface.

---

## Key Capabilities

### 1. Paper Trading & Matching Engine
* Market and Limit order execution with automated slippage (0.05%) and commission modeling (0.10% taker / 0.05% maker).
* Active limit order collateral escrow (`reservedCash`), ensuring buy orders cannot over-commit unencumbered capital.
* Sub-satoshi precision handling down to `1e-11` units, eliminating position inventory dust deletion on partial exits.
* Safe full liquidation preset (`100%`) with precision alignment to prevent false insufficient balance rejections.

### 2. Quantitative Portfolio Analytics
* Real-time mark-to-market portfolio revaluation against streaming tick prices.
* Mathematical risk metrics derived by replaying settled execution ledgers:
  * Annualized Sharpe Ratio (365-day calendar basis with float residue variance gating).
  * Peak-to-Trough Maximum Drawdown curve.
  * Return Volatility (Standard Deviation of daily return intervals).
  * Profit Factor and Win/Loss distribution.
  * Pearson correlation matrix across sampled 24-hour return series.
  * Capital allocation breakdown.

### 3. Institutional Terminal UX & Usability
* High-density monospace typography (`ui-monospace`) with tabular numeric alignment (`tabular-nums`).
* Full keyboard workstation navigation (`1-4`, `B`, `S`, `/`, `ESC`).
* Educational `InfoTip` popovers and a dedicated Beginner Guide modal explaining financial indicators to non-traders.
* CRT aesthetic toggle (scanlines, vignette, phosphor sweep) for classic terminal atmosphere or clean modern readability.
* Strict mobile-first responsiveness (360px, 390px, 430px, 768px, 1024px+) with sticky table freeze panes and 44x44px touch targets.
* OWASP-compliant CSV ledger export with automatic formula injection (`=`, `+`, `-`, `@`) neutralization.

---

## Keyboard Shortcuts

| Shortcut | Action | Description |
| :--- | :--- | :--- |
| `1` | Workspace: Monitor | Switches desktop/mobile view to Market Watch and Order Book. |
| `2` | Workspace: Trade | Focuses Order Ticket, L2 Depth ladder, and Working Orders. |
| `3` | Workspace: Analytics | Loads Portfolio Risk Console, Drawdown, and Correlation Matrix. |
| `4` | Workspace: Ledger | Opens Settled Executions Ledger and System Event Log. |
| `B` | Arm Buy | Selects BUY side on the order ticket and focuses Amount input. |
| `S` | Arm Sell | Selects SELL side on the order ticket and focuses Amount input. |
| `/` or `F1` | Command Palette | Launches quick-command launcher modal (`BUY BTC 0.5`, `LIMIT SELL ETH 3500 1`). |
| `ESC` | Dismiss / Abort | Closes modals, command palette, or active tooltips. |

---

## Technical Stack

* Runtime & Framework: React (Latest), TypeScript (Latest)
* Build & Tooling: Vite (Latest)
* Styling & Tokens: Tailwind CSS (v4) with CSS `@theme` architecture
* Storage & Persistence: Reactive `localStorage` pipeline with strict schema migration and quota recovery
* Testing & QA: Vitest, React Testing Library, JSDOM
* Package Manager: pnpm

---

## Project Structure

```text
src/
├── __tests__/           # End-to-end audit suites (accessibility, layout, trade flow, budget)
├── components/
│   ├── primitives/      # Atomic UI units (ActionButton, TerminalInput, MetricCell, InfoTip)
│   ├── compound/        # Compound widgets (OrderBookWidget, DepthVisualizer, CommandPalette)
│   └── domain/          # Financial domain panels (ExecutionTerminal, HoldingsTable, Ledger)
├── context/             # TerminalContext (state coordinator, single-writer schema mirror)
├── hooks/               # useTerminalStorage, useOrderBook, useMediaQuery
├── layouts/             # TerminalLayout (responsive workstation shell), MobileNavOverlay
├── services/            # marketFeed (real-time random-walk simulation, L2 order book generator)
└── utils/               # finance math, matching engine, formatters, error copy
```

---

## Getting Started

### Prerequisites
* Node.js (v20+ recommended)
* pnpm (`corepack enable && corepack prepare pnpm@latest --activate`)

### Installation

1. Clone the repository:
```bash
git clone https://github.com/mmy-lana/crypto-terminal-analyzer.git
cd crypto-terminal-analyzer
```

2. Install dependencies:
```bash
pnpm install
```

3. Start development server:
```bash
pnpm run dev
```

4. Run verification and test suites:
```bash
pnpm run typecheck
pnpm test
```

5. Build for production:
```bash
pnpm run build
```

---

## Verification & Hardening Standards

The codebase has undergone defensive auditing and passes tests covering:
* 100% WCAG 2.1 touch target compliance (minimum 44x44px clickable bounds).
* Memory leak prevention and `ResizeObserver` lifecycle disposers on Canvas depth graphs.
* Division-by-zero resilience across all financial equations.
* Concurrent React state updater purity with zero asynchronous side-effects during render.
* Sanitized incident tracking tokens replacing raw stack trace disclosure in production.

---

## License

MIT License. Open-source for educational, personal, and professional portfolio inspection.
