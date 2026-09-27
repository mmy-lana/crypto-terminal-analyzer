import React, { ReactNode } from 'react';

export interface TabularTableProps {
  children: ReactNode;
  /** Accessible name of the data table, e.g. "Open positions". */
  label: string;
  className?: string;
  /** Removes the horizontal scroller for tables that are never wider than their panel. */
  contained?: boolean;
}

/**
 * ARIA container for a data table.
 *
 * `role="table"` must own the rows, so this — not the grid track — carries the
 * role and the accessible name. It also owns the horizontal scroller, so the
 * header row and the body rows always scroll together and stay aligned on a
 * 360px viewport. A body that needs its own vertical scroll belongs in a
 * `TabularRowGroup` inside this element.
 */
export const TabularTable: React.FC<TabularTableProps> = ({
  children,
  label,
  className = '',
  contained = true,
}) => (
  <div
    role="table"
    aria-label={label}
    className={`flex min-w-0 flex-col ${contained ? 'scrollbar-thin w-full overflow-x-auto' : ''} ${className}`}
  >
    {children}
  </div>
);

export interface TabularRowGroupProps {
  children: ReactNode;
  className?: string;
}

/**
 * Groups related rows, and is the only element permitted between a
 * `TabularTable` and a `TabularGrid`. Use it when the body scrolls vertically
 * inside the table's horizontal scroller.
 */
export const TabularRowGroup: React.FC<TabularRowGroupProps> = ({ children, className = '' }) => (
  <div role="rowgroup" className={className}>
    {children}
  </div>
);

export interface TabularGridProps {
  children: ReactNode;
  /** CSS grid template, e.g. "minmax(80px, 1fr) minmax(70px, 1fr)". */
  columns?: string;
  className?: string;
  /**
   * ARIA role of the track. A header or a single record is a `row`; a track
   * holding several `TabularRow`s is a `rowgroup`.
   */
  role?: 'row' | 'rowgroup';
}

/**
 * Zero-chrome grid track.
 *
 * Horizontal scrolling belongs to `TabularTable`; this keeps only an explicit
 * minimum width so columns never collapse below readability on a 360px
 * viewport. It renders no wrapper element, which keeps every `role="row"` a
 * direct child of the table or of a `TabularRowGroup`.
 */
export const TabularGrid: React.FC<TabularGridProps> = ({
  children,
  columns,
  className = '',
  role = 'row',
}) => (
  <div
    role={role}
    style={columns ? { gridTemplateColumns: columns } : undefined}
    className={`grid min-w-[360px] font-mono text-[11px] tabular-nums ${className}`}
  >
    {children}
  </div>
);

export interface TabularRowProps {
  children: ReactNode;
  className?: string;
}

/**
 * A single record inside a `rowgroup` track.
 *
 * `display: contents` lets the cells keep participating in the parent grid's
 * column template while still forming a valid `row` for assistive technology,
 * which a `rowgroup` may not contain directly.
 */
export const TabularRow: React.FC<TabularRowProps> = ({ children, className = '' }) => (
  <div role="row" className={`contents ${className}`}>
    {children}
  </div>
);

export interface TabularCellProps {
  children: ReactNode;
  align?: 'left' | 'center' | 'right';
  className?: string;
  /** Semantic column header cell. */
  header?: boolean;
  /** Marks the cell as the row's own label, for row-header navigation. */
  rowHeader?: boolean;
  /** Applies the alternating row wash. */
  striped?: boolean;
  /** Highlights the row (selected symbol, filled order, …). */
  active?: boolean;
  colSpan?: number;
  title?: string;
}

const ALIGN_CLASS = {
  left: 'justify-start text-left',
  center: 'justify-center text-center',
  right: 'justify-end text-right',
} as const;

export const TabularCell: React.FC<TabularCellProps> = ({
  children,
  align = 'left',
  className = '',
  header = false,
  rowHeader = false,
  striped = false,
  active = false,
  colSpan,
  title,
}) => {
  const base =
    header || active
      ? 'bg-[#181c24]'
      : striped
        ? 'bg-[#0e1116]'
        : '';

  const textTone = header
    ? 'text-amber-500/80 font-bold uppercase tracking-[0.1em]'
    : active
      ? 'text-neutral-100'
      : 'text-neutral-300';

  return (
    <div
      role={header ? 'columnheader' : rowHeader ? 'rowheader' : 'cell'}
      title={title}
      style={colSpan ? { gridColumn: `span ${colSpan}` } : undefined}
      className={`flex min-h-[34px] min-w-[70px] items-center px-2 py-1.5 ${ALIGN_CLASS[align]} ${
        header ? 'sticky top-0 z-10 h-[30px] min-h-[30px] border-b border-[#262c36]' : ''
      } ${base} ${textTone} ${className}`}
    >
      {children}
    </div>
  );
};

export default TabularGrid;
