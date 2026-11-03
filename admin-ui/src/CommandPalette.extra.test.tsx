import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { CommandPalette } from './CommandPalette';
import { InfoPanel } from './InfoPanel';

const commands = (...fns: ReturnType<typeof vi.fn>[]) => fns.map((run, i) => ({ id: `c${i}`, label: `Command ${i}`, hint: 'Action', run }));

describe('CommandPalette interactions', () => {
  it('moves with the arrow keys, runs on click and closes on the backdrop', () => {
    const a = vi.fn(); const b = vi.fn(); const c = vi.fn();
    render(<CommandPalette commands={commands(a, b, c)} />);
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    const input = screen.getByLabelText('Search commands');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' }); // stops at the last item
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(b).toHaveBeenCalledOnce();
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    fireEvent.mouseEnter(screen.getByText('Command 2').closest('li')!);
    fireEvent.click(screen.getByText('Command 2'));
    expect(c).toHaveBeenCalledOnce();
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    fireEvent.mouseDown(screen.getByRole('dialog')); // inside the panel: stays open
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole('dialog').parentElement!);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(a).not.toHaveBeenCalled();
  });

  it('says so when nothing matches and ignores Enter then', () => {
    const a = vi.fn();
    render(<CommandPalette commands={commands(a)} />);
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    const input = screen.getByLabelText('Search commands');
    fireEvent.change(input, { target: { value: 'zzz' } });
    expect(screen.getByText('No matches')).toBeInTheDocument();
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.keyDown(input, { key: 'a' });
    expect(a).not.toHaveBeenCalled();
  });
});

describe('InfoPanel without browser storage', () => {
  it('still opens and closes when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    render(<InfoPanel tab="flow" />);
    expect(screen.getByRole('region', { name: 'About Flow' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Hide page info/ }));
    expect(screen.queryByRole('region')).toBeNull();
    vi.restoreAllMocks();
  });

  it('renders a page without tips', async () => {
    const { PAGE_INFO } = await import('./pageInfo');
    const saved = PAGE_INFO.flow!.tips;
    delete PAGE_INFO.flow!.tips;
    render(<InfoPanel tab="flow" />);
    expect(screen.queryByText('Good to know')).toBeNull();
    PAGE_INFO.flow!.tips = saved;
  });
});
