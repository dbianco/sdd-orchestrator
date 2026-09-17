import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Overview } from './Overview';

describe('Overview', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('renders feature counts, proposal counts and the checks with the most blockers', async () => {
    const payload = {
      features: [{ status: 'active', current_phase: 'verify', framework: 'spec-kit', track: 'default', count: 3 }],
      checks: [{ check: 'verify_evidence', blocker_count: 8, warning_count: 1 }],
      proposals: [{ status: 'pending', count: 17 }, { status: 'approved', count: 6 }],
      knowledge: [{ kind: 'framework_pack', memory_type: null, count: 44 }],
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(payload) }));
    render(<Overview />);
    expect(await screen.findByText('3')).toBeInTheDocument();
    expect(screen.getByText('active')).toBeInTheDocument();
    expect(screen.getByText('17 pending, 6 approved, 0 rejected')).toBeInTheDocument();
    expect(screen.getByText('verify_evidence')).toBeInTheDocument();
    expect(screen.getByText('framework_pack')).toBeInTheDocument();
    expect(screen.getByText('44')).toBeInTheDocument();
  });

  it('shows an empty state when there are no features yet', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ features: [], checks: [], proposals: [], knowledge: [] }) }));
    render(<Overview />);
    expect(await screen.findByText('No features yet.')).toBeInTheDocument();
    expect(screen.getByText('No knowledge items yet.')).toBeInTheDocument();
  });
});
