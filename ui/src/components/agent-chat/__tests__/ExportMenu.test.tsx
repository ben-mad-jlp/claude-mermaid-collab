import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ExportMenu } from '../ExportMenu';

describe('ExportMenu', () => {
  it('opens menu on trigger click', () => {
    render(<ExportMenu onCopyTurn={() => {}} onExportTurn={() => {}} onExportSession={() => {}} />);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /export menu/i }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getByText('Copy turn')).toBeInTheDocument();
    expect(screen.getByText('Export turn')).toBeInTheDocument();
    expect(screen.getByText('Export session')).toBeInTheDocument();
  });

  it('calls onCopyTurn when Copy turn clicked', () => {
    const onCopyTurn = vi.fn();
    render(<ExportMenu onCopyTurn={onCopyTurn} />);
    fireEvent.click(screen.getByRole('button', { name: /export menu/i }));
    fireEvent.click(screen.getByText('Copy turn'));
    expect(onCopyTurn).toHaveBeenCalledTimes(1);
  });

  it('calls onExportTurn when Export turn clicked', () => {
    const onExportTurn = vi.fn();
    render(<ExportMenu onExportTurn={onExportTurn} />);
    fireEvent.click(screen.getByRole('button', { name: /export menu/i }));
    fireEvent.click(screen.getByText('Export turn'));
    expect(onExportTurn).toHaveBeenCalledTimes(1);
  });

  it('calls onExportSession when Export session clicked', () => {
    const onExportSession = vi.fn();
    render(<ExportMenu onExportSession={onExportSession} />);
    fireEvent.click(screen.getByRole('button', { name: /export menu/i }));
    fireEvent.click(screen.getByText('Export session'));
    expect(onExportSession).toHaveBeenCalledTimes(1);
  });

  it('disables items when handler missing', () => {
    render(<ExportMenu />);
    fireEvent.click(screen.getByRole('button', { name: /export menu/i }));
    expect(screen.getByText('Copy turn')).toBeDisabled();
    expect(screen.getByText('Export turn')).toBeDisabled();
    expect(screen.getByText('Export session')).toBeDisabled();
  });
});
