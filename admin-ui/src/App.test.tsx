import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { App } from './App';

describe('App', () => {
  it('renders the tab navigation and switches between tabs', () => {
    render(<App />);
    expect(screen.getByText('Overview coming soon.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Flow' }));
    expect(screen.getByText('Flow coming soon.')).toBeInTheDocument();
  });
});
