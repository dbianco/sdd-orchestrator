import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { Badge, BackButton, Empty, ErrorState, ExportCsv, Icon, Loading, PageHead, relativeTime, SortTh, SplitBar, Time, toneOf, useSort, useToast } from './ui';

describe('ui components', () => {
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('maps statuses to tones, with an override and a plain variant', () => {
    expect(toneOf('blocked')).toBe('red');
    expect(toneOf('something-else')).toBe('gray');
    const { container } = render(<><Badge value="active" /><Badge value="x" tone="amber" plain /></>);
    expect(container.querySelector('.badge-blue')).not.toBeNull();
    expect(container.querySelector('.badge-amber.badge-plain')).not.toBeNull();
  });

  it('formats relative times across every unit and keeps invalid input as is', () => {
    const now = Date.parse('2026-11-03T12:00:00Z');
    const ago = (s: number) => new Date(now - s * 1000).toISOString();
    expect(relativeTime(ago(10), now)).toBe('just now');
    expect(relativeTime(ago(120), now)).toBe('2m ago');
    expect(relativeTime(ago(3 * 3600), now)).toBe('3h ago');
    expect(relativeTime(ago(3 * 86400), now)).toBe('3d ago');
    expect(relativeTime(ago(90 * 86400), now)).toBe('3mo ago');
    expect(relativeTime(ago(800 * 86400), now)).toBe('2y ago');
    expect(relativeTime('not a date', now)).toBe('not a date');
    expect(relativeTime(ago(-60), now)).toBe('just now'); // a future timestamp is clamped
    render(<Time iso="2026-11-03T09:00:00Z" />);
    expect(document.querySelector('time')?.getAttribute('datetime')).toBe('2026-11-03T09:00:00Z');
  });

  it('renders the small building blocks', () => {
    const onRetry = vi.fn();
    const onBack = vi.fn();
    render(<>
      <Loading /><Empty title="Nothing" hint="Add some" /><ErrorState message="boom" onRetry={onRetry} /><ErrorState message="no retry" />
      <PageHead title="T" subtitle="S" actions={<button>act</button>} /><PageHead title="Only title" />
      <BackButton onClick={onBack} /><BackButton onClick={onBack} label="approvals" />
      <Icon name="overview" /><Icon name="unknown-icon" />
    </>);
    expect(screen.getByText('Add some')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByText('to approvals').closest('button')!);
    expect(onBack).toHaveBeenCalledOnce();
    expect(screen.getByText('act')).toBeInTheDocument();
  });

  it('draws a split bar and tolerates an all-zero total', () => {
    const { container } = render(<SplitBar parts={[{ label: 'A', value: 3, tone: 'green' }, { label: 'B', value: 1, tone: 'red' }, { label: 'C', value: 0, tone: 'gray' }]} />);
    expect(container.querySelectorAll('.bar > span')).toHaveLength(2);
    const zero = render(<SplitBar parts={[{ label: 'A', value: 0, tone: 'green' }]} />);
    expect(zero.container.querySelectorAll('.bar > span')).toHaveLength(0);
  });

  it('shows a toast and hides it after a few seconds', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useToast());
    expect(result.current.toast).toBeNull();
    act(() => result.current.show('Saved'));
    expect(result.current.toast).not.toBeNull();
    act(() => { vi.advanceTimersByTime(4000); });
    expect(result.current.toast).toBeNull();
  });

  it('sorts numbers, strings and missing values, and flips the direction on a second click', () => {
    const rows = [{ n: 2, s: 'b' }, { n: 10, s: null }, { n: 1, s: 'a' }];
    const { result } = renderHook(() => useSort(rows, { n: (r) => r.n, s: (r) => r.s }));
    expect(result.current.sorted).toBe(rows);
    act(() => result.current.toggle('n'));
    expect(result.current.sorted.map((r) => r.n)).toEqual([1, 2, 10]);
    act(() => result.current.toggle('n'));
    expect(result.current.sorted.map((r) => r.n)).toEqual([10, 2, 1]);
    act(() => result.current.toggle('s'));
    expect(result.current.sorted.map((r) => r.s)).toEqual(['a', 'b', null]); // missing sorts last
    act(() => result.current.toggle('s'));
    expect(result.current.sorted.map((r) => r.s)).toEqual(['b', 'a', null]);
    act(() => result.current.toggle('unknown'));
    expect(result.current.sorted).toBe(rows);
  });

  it('renders sortable headers with aria-sort', () => {
    const onSort = vi.fn();
    render(<table><thead><tr><SortTh id="a" label="A" sort={{ key: 'a', dir: 'asc' }} onSort={onSort} /><SortTh id="b" label="B" sort={{ key: 'a', dir: 'desc' }} onSort={onSort} /><SortTh id="a" label="A2" sort={{ key: 'a', dir: 'desc' }} onSort={onSort} /></tr></thead></table>);
    const headers = screen.getAllByRole('columnheader');
    expect(headers[0]!.getAttribute('aria-sort')).toBe('ascending');
    expect(headers[1]!.getAttribute('aria-sort')).toBe('none');
    expect(headers[2]!.getAttribute('aria-sort')).toBe('descending');
    fireEvent.click(screen.getByRole('button', { name: /^B/ }));
    expect(onSort).toHaveBeenCalledWith('b');
  });

  describe('ExportCsv', () => {
    beforeEach(() => {
      Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() });
    });

    it('downloads the rows as a CSV file', () => {
      const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
      render(<ExportCsv filename="rows.csv" headers={['a']} rows={[['1'], ['2']]} />);
      fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
      expect(click).toHaveBeenCalledOnce();
      expect(URL.createObjectURL).toHaveBeenCalledOnce();
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:x');
    });
  });
});
