import Swal from 'sweetalert2';

export interface ConfirmDestructiveOptions {
  title: string;
  text?: string;
  confirmText: string;
  cancelText: string;
}

/**
 * Shows a styled confirmation dialog for destructive actions.
 * Resolves to `true` only when the user explicitly confirms.
 */
export async function confirmDestructive({
  title,
  text,
  confirmText,
  cancelText,
}: ConfirmDestructiveOptions): Promise<boolean> {
  const result = await Swal.fire({
    title,
    text,
    icon: 'warning',
    showCancelButton: true,
    confirmButtonText: confirmText,
    cancelButtonText: cancelText,
    focusCancel: true,
    reverseButtons: true,
    buttonsStyling: false,
    customClass: {
      container: 'swalContainer',
      popup: 'swalPopup',
      title: 'swalTitle',
      htmlContainer: 'swalText',
      actions: 'swalActions',
      confirmButton: 'button swalConfirm',
      cancelButton: 'button',
    },
  });
  return result.isConfirmed;
}
