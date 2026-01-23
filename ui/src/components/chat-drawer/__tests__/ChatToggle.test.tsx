import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatToggle, type ChatToggleProps } from '../ChatToggle';

describe('ChatToggle Component', () => {
  const defaultProps: ChatToggleProps = {
    onClick: vi.fn(),
    unreadCount: 0,
    isOpen: false,
  };

  describe('Rendering', () => {
    it('should render the toggle button', () => {
      render(<ChatToggle {...defaultProps} />);
      const button = screen.getByRole('button');
      expect(button).toBeInTheDocument();
    });

    it('should render with correct positioning classes', () => {
      const { container } = render(<ChatToggle {...defaultProps} />);
      const wrapper = container.querySelector('.fixed');
      expect(wrapper).toHaveClass('top-4', 'left-4', 'z-40');
    });

    it('should have correct aria-label when closed', () => {
      render(<ChatToggle {...defaultProps} isOpen={false} />);
      const button = screen.getByRole('button');
      expect(button).toHaveAttribute('aria-label', 'Open chat');
    });

    it('should have correct aria-label when open', () => {
      render(<ChatToggle {...defaultProps} isOpen={true} />);
      const button = screen.getByRole('button');
      expect(button).toHaveAttribute('aria-label', 'Close chat');
    });
  });

  describe('Icon Display', () => {
    it('should display hamburger icon when closed', () => {
      const { container } = render(<ChatToggle {...defaultProps} isOpen={false} />);
      const svgs = container.querySelectorAll('svg');
      expect(svgs.length).toBeGreaterThan(0);
    });

    it('should display up arrow icon when open', () => {
      const { container } = render(<ChatToggle {...defaultProps} isOpen={true} />);
      const svgs = container.querySelectorAll('svg');
      expect(svgs.length).toBeGreaterThan(0);
    });
  });

  describe('Badge Display', () => {
    it('should not display badge when unreadCount is 0', () => {
      const { container } = render(
        <ChatToggle {...defaultProps} unreadCount={0} />
      );
      const badges = container.querySelectorAll('.bg-red-500');
      expect(badges.length).toBe(0);
    });

    it('should display badge when unreadCount > 0', () => {
      const { container } = render(
        <ChatToggle {...defaultProps} unreadCount={5} />
      );
      const badge = container.querySelector('.bg-red-500');
      expect(badge).toBeInTheDocument();
    });

    it('should show correct count in badge', () => {
      render(<ChatToggle {...defaultProps} unreadCount={3} />);
      const badge = screen.getByText('3');
      expect(badge).toBeInTheDocument();
    });

    it('should show 99+ for counts greater than 99', () => {
      render(<ChatToggle {...defaultProps} unreadCount={150} />);
      const badge = screen.getByText('99+');
      expect(badge).toBeInTheDocument();
    });

    it('should show single digit counts', () => {
      render(<ChatToggle {...defaultProps} unreadCount={1} />);
      const badge = screen.getByText('1');
      expect(badge).toBeInTheDocument();
    });

    it('should show two digit counts', () => {
      render(<ChatToggle {...defaultProps} unreadCount={42} />);
      const badge = screen.getByText('42');
      expect(badge).toBeInTheDocument();
    });

    it('should have correct badge styling', () => {
      const { container } = render(
        <ChatToggle {...defaultProps} unreadCount={5} />
      );
      const badge = container.querySelector('.bg-red-500');
      expect(badge).toHaveClass('absolute', 'top-0', 'right-0', 'w-5', 'h-5', 'rounded-full');
    });

    it('should position badge in top-right corner', () => {
      const { container } = render(
        <ChatToggle {...defaultProps} unreadCount={5} />
      );
      const badge = container.querySelector('.bg-red-500');
      expect(badge).toHaveClass('transform', 'translate-x-1/3', '-translate-y-1/3');
    });
  });

  describe('Styling Based on State', () => {
    it('should have blue background when open', () => {
      const { container } = render(<ChatToggle {...defaultProps} isOpen={true} />);
      const button = container.querySelector('button');
      expect(button).toHaveClass('bg-blue-600');
    });

    it('should have gray background when closed', () => {
      const { container } = render(<ChatToggle {...defaultProps} isOpen={false} />);
      const button = container.querySelector('button');
      expect(button).toHaveClass('bg-gray-200', 'dark:bg-gray-700');
    });

    it('should have white text when open', () => {
      const { container } = render(<ChatToggle {...defaultProps} isOpen={true} />);
      const button = container.querySelector('button');
      expect(button).toHaveClass('text-white');
    });

    it('should have dark text when closed', () => {
      const { container } = render(<ChatToggle {...defaultProps} isOpen={false} />);
      const button = container.querySelector('button');
      expect(button).toHaveClass('text-gray-900', 'dark:text-gray-100');
    });

    it('should have shadow when open', () => {
      const { container } = render(<ChatToggle {...defaultProps} isOpen={true} />);
      const button = container.querySelector('button');
      expect(button).toHaveClass('shadow-lg');
    });
  });

  describe('Click Handler', () => {
    it('should call onClick when button is clicked', async () => {
      const onClickMock = vi.fn();
      const user = userEvent.setup();

      render(
        <ChatToggle {...defaultProps} onClick={onClickMock} />
      );

      const button = screen.getByRole('button');
      await user.click(button);

      expect(onClickMock).toHaveBeenCalledTimes(1);
    });

    it('should call onClick handler multiple times', async () => {
      const onClickMock = vi.fn();
      const user = userEvent.setup();

      render(
        <ChatToggle {...defaultProps} onClick={onClickMock} />
      );

      const button = screen.getByRole('button');
      await user.click(button);
      await user.click(button);

      expect(onClickMock).toHaveBeenCalledTimes(2);
    });
  });

  describe('Title Attribute', () => {
    it('should show generic title when no unread messages', () => {
      render(<ChatToggle {...defaultProps} unreadCount={0} />);
      const button = screen.getByRole('button');
      expect(button).toHaveAttribute('title', 'Chat');
    });

    it('should show count in title when unread messages exist', () => {
      render(<ChatToggle {...defaultProps} unreadCount={3} />);
      const button = screen.getByRole('button');
      expect(button).toHaveAttribute('title', '3 unread messages');
    });

    it('should show plural form for title', () => {
      render(<ChatToggle {...defaultProps} unreadCount={5} />);
      const button = screen.getByRole('button');
      expect(button).toHaveAttribute('title', '5 unread messages');
    });
  });

  describe('Props Updates', () => {
    it('should update when unreadCount changes', () => {
      const { rerender } = render(
        <ChatToggle {...defaultProps} unreadCount={0} />
      );

      expect(screen.queryByText('5')).not.toBeInTheDocument();

      rerender(<ChatToggle {...defaultProps} unreadCount={5} />);

      expect(screen.getByText('5')).toBeInTheDocument();
    });

    it('should update when isOpen changes', () => {
      const { container, rerender } = render(
        <ChatToggle {...defaultProps} isOpen={false} />
      );

      let button = container.querySelector('button');
      expect(button).toHaveClass('bg-gray-200');

      rerender(<ChatToggle {...defaultProps} isOpen={true} />);

      button = container.querySelector('button');
      expect(button).toHaveClass('bg-blue-600');
    });

    it('should update onClick handler', async () => {
      const onClick1 = vi.fn();
      const onClick2 = vi.fn();
      const user = userEvent.setup();

      const { rerender } = render(
        <ChatToggle {...defaultProps} onClick={onClick1} />
      );

      let button = screen.getByRole('button');
      await user.click(button);
      expect(onClick1).toHaveBeenCalledTimes(1);

      rerender(
        <ChatToggle {...defaultProps} onClick={onClick2} />
      );

      button = screen.getByRole('button');
      await user.click(button);
      expect(onClick2).toHaveBeenCalledTimes(1);
    });
  });

  describe('Accessibility', () => {
    it('should be keyboard accessible', async () => {
      const onClickMock = vi.fn();
      const user = userEvent.setup();

      render(
        <ChatToggle {...defaultProps} onClick={onClickMock} />
      );

      const button = screen.getByRole('button');
      button.focus();
      expect(button).toHaveFocus();

      await user.keyboard('{Enter}');
      expect(onClickMock).toHaveBeenCalled();
    });

    it('should have proper button semantics', () => {
      render(<ChatToggle {...defaultProps} />);
      const button = screen.getByRole('button');
      expect(button.tagName).toBe('BUTTON');
    });
  });

  describe('Badge Text Color', () => {
    it('should have white text in badge', () => {
      const { container } = render(
        <ChatToggle {...defaultProps} unreadCount={5} />
      );
      const badge = container.querySelector('.bg-red-500');
      const badgeText = badge?.querySelector('span');
      expect(badgeText).toHaveClass('text-white');
    });

    it('should have bold text in badge', () => {
      const { container } = render(
        <ChatToggle {...defaultProps} unreadCount={5} />
      );
      const badge = container.querySelector('.bg-red-500');
      const badgeText = badge?.querySelector('span');
      expect(badgeText).toHaveClass('font-bold');
    });
  });
});
