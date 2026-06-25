/**
 * AddProjectDialog — Browse routes to the SELECTED server.
 *
 * The native OS folder picker only sees the local filesystem, so picking a
 * remote server and browsing must list the REMOTE box (via invokeOnServer →
 * /api/fs/list), not the local one. These tests pin that routing:
 * - remote server: Browse opens the in-app browser and lists via invokeOnServer
 *   (the local-only native picker is NOT used)
 * - local server: Browse uses the native picker
 * - create-new-folder on a remote server mkdir's via invokeOnServer
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ServerInfo } from '../../../contexts/ServerContext';
import { AddProjectDialog } from '../AddProjectDialog';

function mkServer(over: Partial<ServerInfo>): ServerInfo {
  return { id: 'id', label: 'srv', host: '127.0.0.1', port: 9002, status: 'online', source: 'manual', ...over };
}

const local = mkServer({ id: 'local', label: 'Local', source: 'local' });
const remote = mkServer({ id: 'vd', label: 'virtualdev', host: 'virtualdev', source: 'manual' });

afterEach(() => {
  delete (window as any).mc;
  vi.restoreAllMocks();
});

describe('AddProjectDialog remote browse', () => {
  it('remote server: Browse lists via invokeOnServer and skips the native picker', async () => {
    const pickFolder = vi.fn(async () => '/should/not/be/used');
    const invokeOnServer = vi.fn(async () => ({
      ok: true,
      status: 200,
      body: { path: '/home/jlp', parent: '/home', entries: [{ name: 'projects', path: '/home/jlp/projects' }] },
    }));
    (window as any).mc = { pickFolder, invokeOnServer };

    render(<AddProjectDialog servers={[local, remote]} defaultServerId="vd" onSubmit={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Browse…' }));

    await waitFor(() =>
      expect(invokeOnServer).toHaveBeenCalledWith('vd', { path: '/api/fs/list', method: 'GET', query: { path: '' } }),
    );
    expect(pickFolder).not.toHaveBeenCalled();
    // The remote listing is rendered in the in-app browser.
    expect(await screen.findByText('projects')).toBeInTheDocument();
    expect(screen.getByText(/Browsing/)).toHaveTextContent('virtualdev');
  });

  it('local server: Browse uses the native picker', async () => {
    const pickFolder = vi.fn(async () => '/Users/me/proj');
    const invokeOnServer = vi.fn();
    (window as any).mc = { pickFolder, invokeOnServer };

    render(<AddProjectDialog servers={[local, remote]} defaultServerId="local" onSubmit={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Browse…' }));

    await waitFor(() => expect(pickFolder).toHaveBeenCalled());
    expect(invokeOnServer).not.toHaveBeenCalled();
    expect((screen.getByLabelText('Project Path') as HTMLInputElement).value).toBe('/Users/me/proj');
  });

  it('remote server: create-new-folder mkdirs via invokeOnServer', async () => {
    const invokeOnServer = vi.fn(async () => ({ ok: true, status: 200, body: { path: '/home/jlp/new-proj' } }));
    const onSubmit = vi.fn(async () => {});
    (window as any).mc = { invokeOnServer };

    render(<AddProjectDialog servers={[local, remote]} defaultServerId="vd" onSubmit={onSubmit} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Project Path'), { target: { value: '/home/jlp' } });
    fireEvent.click(screen.getByLabelText(/Create a new folder/));
    fireEvent.change(screen.getByPlaceholderText('new-folder-name'), { target: { value: 'new-proj' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create & Add' }));

    await waitFor(() =>
      expect(invokeOnServer).toHaveBeenCalledWith('vd', { path: '/api/fs/mkdir', method: 'POST', body: { parent: '/home/jlp', name: 'new-proj' } }),
    );
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('vd', '/home/jlp/new-proj'));
  });
});
