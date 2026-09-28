import { useEffect } from 'react';
import { CheckCircle2, Info, X, XCircle } from 'lucide-react';

const ICON = { success: CheckCircle2, error: XCircle, info: Info };

function Toast({ toast, onClose }) {
  useEffect(() => {
    const t = setTimeout(() => onClose(toast.id), toast.type === 'error' ? 6000 : 3500);
    return () => clearTimeout(t);
  }, [toast.id, toast.type, onClose]);
  const Icon = ICON[toast.type] || Info;
  return (
    <div className={`toast toast-${toast.type}`} role="status">
      <Icon size={18} className="toast-icon" />
      <span className="toast-message">{toast.message}</span>
      <button type="button" className="toast-close" onClick={() => onClose(toast.id)} aria-label="Dismiss">
        <X size={14} />
      </button>
    </div>
  );
}

export default function Toasts({ toasts, onClose }) {
  return (
    <div className="toast-container" aria-live="polite">
      {toasts.map((t) => (
        <Toast key={t.id} toast={t} onClose={onClose} />
      ))}
    </div>
  );
}
