import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CommandPalette } from './CommandPalette';

describe('CommandPalette', () => {
  it('opens with Ctrl+K, filters, runs the highlighted command with Enter and closes with Escape', () => {
    const flow = vi.fn();
    const refresh = vi.fn();
    render(<CommandPalette commands={[{ id: 'go:flow', label: 'Go to Flow', hint: 'Section', run: flow }, { id: 'refresh', label: 'Refresh the current view', hint: 'Action', run: refresh }]} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    const input = screen.getByLabelText('Search commands');
    fireEvent.change(input, { target: { value: 'refr' } });
    expect(screen.queryByText('Go to Flow')).toBeNull();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(refresh).toHaveBeenCalledOnce();
    expect(flow).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
