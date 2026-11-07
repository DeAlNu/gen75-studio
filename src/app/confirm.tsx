import { useEffect, useRef } from 'react';
import { create } from 'zustand';

interface ConfirmRequest {
  title: string;
  message: string;
  confirmLabel: string;
  danger: boolean;
  resolve: (ok: boolean) => void;
}

const useConfirmStore = create<{ request: ConfirmRequest | null }>(() => ({ request: null }));

export function askConfirm(opts: { title: string; message: string; confirmLabel: string; danger?: boolean }): Promise<boolean> {
  return new Promise((resolve) => {
    useConfirmStore.getState().request?.resolve(false);
    useConfirmStore.setState({ request: { ...opts, danger: opts.danger === true, resolve } });
  });
}

export function ConfirmHost() {
  const request = useConfirmStore((s) => s.request);
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (request && !d.open) d.showModal();
    if (!request && d.open) d.close();
  }, [request]);

  const finish = (ok: boolean): void => {
    const r = useConfirmStore.getState().request;
    useConfirmStore.setState({ request: null });
    r?.resolve(ok);
  };

  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby="dialog-title"
      onCancel={(e) => {
        e.preventDefault();
        finish(false);
      }}
    >
      {request && (
        <div>
          <h2 id="dialog-title">{request.title}</h2>
          <p>{request.message}</p>
          <div className="actions">
            <button type="button" className="btn" autoFocus={request.danger} onClick={() => finish(false)}>
              Batal
            </button>
            <button type="button" className={`btn ${request.danger ? 'danger' : 'primary'}`} autoFocus={!request.danger} onClick={() => finish(true)}>
              {request.confirmLabel}
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}
