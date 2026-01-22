import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Wizard, WizardStep } from '../Wizard';
import { describe, it, expect, vi } from 'vitest';

describe('Wizard Component', () => {
  const mockSteps: WizardStep[] = [
    {
      id: 'step-1',
      title: 'Step 1',
      description: 'First step description',
      content: <div>Step 1 Content</div>,
    },
    {
      id: 'step-2',
      title: 'Step 2',
      description: 'Second step description',
      content: <div>Step 2 Content</div>,
      optional: true,
    },
    {
      id: 'step-3',
      title: 'Step 3',
      content: <div>Step 3 Content</div>,
    },
  ];

  it('should render the first step by default', () => {
    render(<Wizard steps={mockSteps} />);

    expect(screen.getByText('Step 1')).toBeInTheDocument();
    expect(screen.getByText('First step description')).toBeInTheDocument();
    expect(screen.getByText('Step 1 Content')).toBeInTheDocument();
  });

  it('should display progress indicator when showProgress is true', () => {
    render(<Wizard steps={mockSteps} showProgress={true} />);

    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    expect(screen.getByText('Step 1 of 3')).toBeInTheDocument();
  });

  it('should not display progress indicator when showProgress is false', () => {
    const { container } = render(<Wizard steps={mockSteps} showProgress={false} />);

    const progressBars = container.querySelectorAll('[role="progressbar"]');
    expect(progressBars).toHaveLength(0);
  });

  it('should navigate to next step when Next button is clicked', async () => {
    const user = userEvent.setup();
    render(<Wizard steps={mockSteps} />);

    const nextButton = screen.getByRole('button', { name: /next/i });
    await user.click(nextButton);

    expect(screen.getByText('Step 2')).toBeInTheDocument();
    expect(screen.getByText('Step 2 Content')).toBeInTheDocument();
  });

  it('should navigate to previous step when Back button is clicked', async () => {
    const user = userEvent.setup();
    render(<Wizard steps={mockSteps} currentStep={1} allowBack={true} />);

    const backButton = screen.getByLabelText('Go to previous step');
    await user.click(backButton);

    expect(screen.getByText('Step 1')).toBeInTheDocument();
  });

  it('should not show Back button on first step', () => {
    render(<Wizard steps={mockSteps} currentStep={0} allowBack={true} />);

    const backButtons = screen.queryAllByLabelText('Go to previous step');
    expect(backButtons).toHaveLength(0);
  });

  it('should show Skip button for optional steps', () => {
    render(<Wizard steps={mockSteps} currentStep={1} allowSkip={true} />);

    const skipButton = screen.getByRole('button', { name: /skip/i });
    expect(skipButton).toBeInTheDocument();
  });

  it('should not show Skip button for required steps', () => {
    render(<Wizard steps={mockSteps} currentStep={0} allowSkip={true} />);

    const skipButtons = screen.queryAllByRole('button', { name: /skip/i });
    expect(skipButtons).toHaveLength(0);
  });

  it('should call onStepChange when step changes', async () => {
    const user = userEvent.setup();
    const onStepChange = vi.fn();
    render(<Wizard steps={mockSteps} onStepChange={onStepChange} />);

    const nextButton = screen.getByRole('button', { name: /next/i });
    await user.click(nextButton);

    expect(onStepChange).toHaveBeenCalledWith(1);
  });

  it('should call onComplete when last step is completed', async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    render(
      <Wizard
        steps={mockSteps}
        currentStep={mockSteps.length - 1}
        onComplete={onComplete}
      />
    );

    const completeButton = screen.getByRole('button', { name: /complete/i });
    await user.click(completeButton);

    expect(onComplete).toHaveBeenCalled();
  });

  it('should show "Complete" button on last step', () => {
    render(
      <Wizard steps={mockSteps} currentStep={mockSteps.length - 1} />
    );

    const completeButton = screen.getByRole('button', { name: /complete/i });
    expect(completeButton).toBeInTheDocument();
  });

  it('should update progress bar when step changes', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Wizard steps={mockSteps} currentStep={0} showProgress={true} />);

    let progressBar = screen.getByRole('progressbar');
    const initialValue = parseFloat(progressBar.getAttribute('aria-valuenow') || '0');
    expect(initialValue).toBeCloseTo(33.33, 1);

    const nextButton = screen.getByRole('button', { name: /next/i });
    await user.click(nextButton);

    rerender(<Wizard steps={mockSteps} currentStep={1} showProgress={true} />);
    progressBar = screen.getByRole('progressbar');
    const updatedValue = parseFloat(progressBar.getAttribute('aria-valuenow') || '0');
    expect(updatedValue).toBeCloseTo(66.67, 1);
  });

  it('should handle allowBack=false', async () => {
    const user = userEvent.setup();
    render(
      <Wizard
        steps={mockSteps}
        currentStep={1}
        allowBack={false}
      />
    );

    const backButtons = screen.queryAllByRole('button', { name: /back/i });
    expect(backButtons).toHaveLength(0);
  });

  it('should display step description when provided', () => {
    render(<Wizard steps={mockSteps} currentStep={1} />);

    expect(screen.getByText('Second step description')).toBeInTheDocument();
  });

  it('should not display step description when not provided', () => {
    render(<Wizard steps={mockSteps} currentStep={2} />);

    const descriptions = screen.queryAllByText(/description/i);
    expect(descriptions).toHaveLength(0);
  });
});
