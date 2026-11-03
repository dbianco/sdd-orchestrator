import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { InfoPanel } from './InfoPanel';
import { PAGE_INFO } from './pageInfo';

describe('InfoPanel', () => {
  beforeEach(() => { try { localStorage.clear(); } catch { /* ignore */ } });

  it('is open on first visit, collapses, and remembers the choice per page', () => {
    const { unmount } = render(<InfoPanel tab="approvals" />);
    expect(screen.getByRole('region', { name: 'About Approvals' })).toBeInTheDocument();
    expect(screen.getByText(/approver scope/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Hide page info/ }));
    expect(screen.queryByRole('region')).toBeNull();
    unmount();
    render(<InfoPanel tab="approvals" />);
    expect(screen.queryByRole('region')).toBeNull(); // stays closed
    fireEvent.click(screen.getByRole('button', { name: /About this page/ }));
    expect(screen.getByRole('region', { name: 'About Approvals' })).toBeInTheDocument();
    render(<InfoPanel tab="flow" />);
    expect(screen.getByRole('region', { name: 'About Flow' })).toBeInTheDocument(); // other pages unaffected
  });

  it('has content for every section of the app', () => {
    for (const tab of ['overview', 'week', 'apps', 'work', 'approvals', 'proposals', 'flow']) {
      expect(PAGE_INFO[tab]?.actions.length).toBeGreaterThan(0);
    }
  });

  it('renders nothing for an unknown page', () => {
    const { container } = render(<InfoPanel tab="nope" />);
    expect(container).toBeEmptyDOMElement();
  });
});
