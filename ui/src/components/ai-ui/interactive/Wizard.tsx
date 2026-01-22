import React, { useState, ReactNode } from 'react';

export interface WizardStep {
  id: string;
  title: string;
  description?: string;
  content: ReactNode;
  optional?: boolean;
}

export interface WizardProps {
  steps: WizardStep[];
  currentStep?: number;
  allowBack?: boolean;
  allowSkip?: boolean;
  showProgress?: boolean;
  onStepChange?: (stepIndex: number) => void;
  onComplete?: () => void;
  className?: string;
}

/**
 * Wizard Component
 * Multi-step form or process flow with navigation
 *
 * Features:
 * - Customizable steps with titles and descriptions
 * - Optional steps can be skipped
 * - Progress indicator
 * - Accessible keyboard navigation
 * - Dark mode support via Tailwind
 */
export const Wizard: React.FC<WizardProps> = ({
  steps,
  currentStep = 0,
  allowBack = true,
  allowSkip = true,
  showProgress = true,
  onStepChange,
  onComplete,
  className = '',
}) => {
  const [activeStep, setActiveStep] = useState(currentStep);

  const handleNext = () => {
    if (activeStep < steps.length - 1) {
      const nextStep = activeStep + 1;
      setActiveStep(nextStep);
      onStepChange?.(nextStep);
    } else {
      onComplete?.();
    }
  };

  const handleBack = () => {
    if (allowBack && activeStep > 0) {
      const prevStep = activeStep - 1;
      setActiveStep(prevStep);
      onStepChange?.(prevStep);
    }
  };

  const handleSkip = () => {
    const currentStepData = steps[activeStep];
    if (allowSkip && currentStepData.optional) {
      handleNext();
    }
  };

  const canGoBack = allowBack && activeStep > 0;
  const canSkip = allowSkip && steps[activeStep]?.optional;
  const isLastStep = activeStep === steps.length - 1;
  const completionPercentage = ((activeStep + 1) / steps.length) * 100;

  const step = steps[activeStep];

  return (
    <div className={`wizard w-full ${className}`}>
      {/* Progress Indicator */}
      {showProgress && (
        <div className="mb-8">
          {/* Progress Bar */}
          <div className="h-1 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden mb-4">
            <div
              className="h-full bg-blue-600 dark:bg-blue-500 transition-all duration-300"
              style={{ width: `${completionPercentage}%` }}
              role="progressbar"
              aria-valuenow={completionPercentage}
              aria-valuemin={0}
              aria-valuemax={100}
            />
          </div>

          {/* Step Indicators */}
          <div className="flex justify-between items-center">
            {steps.map((s, index) => (
              <div
                key={s.id}
                className={`flex items-center ${index < steps.length - 1 ? 'flex-1' : ''}`}
              >
                <div
                  className={`flex items-center justify-center w-8 h-8 rounded-full font-semibold text-sm transition-all ${
                    index <= activeStep
                      ? 'bg-blue-600 dark:bg-blue-500 text-white'
                      : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
                  }`}
                >
                  {index < activeStep ? '✓' : index + 1}
                </div>

                {/* Connecting Line */}
                {index < steps.length - 1 && (
                  <div
                    className={`flex-1 h-1 mx-2 ${
                      index < activeStep
                        ? 'bg-blue-600 dark:bg-blue-500'
                        : 'bg-gray-200 dark:bg-gray-700'
                    }`}
                  />
                )}
              </div>
            ))}
          </div>

          {/* Step Counter */}
          <div className="mt-2 text-sm text-gray-600 dark:text-gray-400">
            Step {activeStep + 1} of {steps.length}
          </div>
        </div>
      )}

      {/* Step Content */}
      <div className="mb-8">
        <div className="mb-6">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
            {step.title}
          </h2>
          {step.description && (
            <p className="text-gray-600 dark:text-gray-400">{step.description}</p>
          )}
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
          {step.content}
        </div>
      </div>

      {/* Navigation Buttons */}
      <div className="flex justify-between items-center gap-4">
        <div>
          {canGoBack && (
            <button
              onClick={handleBack}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-900 dark:text-white transition-colors"
              aria-label="Go to previous step"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Back
            </button>
          )}
        </div>

        <div className="flex gap-3">
          {canSkip && (
            <button
              onClick={handleSkip}
              className="px-4 py-2 rounded-lg bg-transparent border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              aria-label="Skip this step"
            >
              Skip
            </button>
          )}

          <button
            onClick={handleNext}
            className="inline-flex items-center gap-2 px-6 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 text-white transition-colors font-medium"
            aria-label={isLastStep ? 'Complete wizard' : 'Go to next step'}
          >
            {isLastStep ? 'Complete' : 'Next'}
            {!isLastStep && (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default Wizard;
