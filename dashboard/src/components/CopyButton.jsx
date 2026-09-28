import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

export default function CopyButton({ text, label, className = 'btn btn-ghost btn-sm', onCopied }) {
  const [copied, setCopied] = useState(false);
  const copy = async (e) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(typeof text === 'function' ? text() : text);
      setCopied(true);
      onCopied?.();
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };
  return (
    <button type="button" className={className} onClick={copy} title={label || 'Copy'}>
      {copied ? <Check size={14} className="text-success" /> : <Copy size={14} />}
      {label && <span>{copied ? 'Copied' : label}</span>}
    </button>
  );
}
