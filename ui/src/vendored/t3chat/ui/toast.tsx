import * as React from 'react';
import { Toast as BaseToast } from '@base-ui/react/toast';
import { cn } from '../lib/utils';

export const ToastProvider = BaseToast.Provider;
export const ToastViewport = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof BaseToast.Viewport>
>(({ className, ...props }, ref) => (
  <BaseToast.Viewport
    ref={ref}
    className={cn('fixed bottom-4 right-4 z-50 flex flex-col gap-2', className)}
    {...props}
  />
));
ToastViewport.displayName = 'ToastViewport';

export const Toast = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof BaseToast.Root>
>(({ className, ...props }, ref) => (
  <BaseToast.Root
    ref={ref}
    className={cn(
      'rounded-md border bg-popover px-4 py-3 text-sm text-popover-foreground shadow-md',
      className
    )}
    {...props}
  />
));
Toast.displayName = 'Toast';

export const ToastTitle = BaseToast.Title;
export const ToastDescription = BaseToast.Description;
export const ToastClose = BaseToast.Close;
