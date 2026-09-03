// Íconos minimalistas (stroke currentColor) para la navegación.
type P = { className?: string };
const base = "h-[18px] w-[18px]";

export function IconInicio({ className }: P) {
  return (
    <svg className={className ?? base} viewBox="0 0 20 20" fill="none">
      <circle cx="10" cy="10" r="4.5" fill="currentColor" />
    </svg>
  );
}
export function IconPublicaciones({ className }: P) {
  return (
    <svg className={className ?? base} viewBox="0 0 20 20" fill="none">
      <rect x="3" y="4" width="14" height="2" rx="1" fill="currentColor" />
      <rect x="3" y="9" width="10" height="2" rx="1" fill="currentColor" />
      <rect x="3" y="14" width="12" height="2" rx="1" fill="currentColor" />
    </svg>
  );
}
export function IconStock({ className }: P) {
  return (
    <svg className={className ?? base} viewBox="0 0 20 20" fill="none">
      <rect
        x="3"
        y="3"
        width="14"
        height="14"
        rx="3"
        stroke="currentColor"
        strokeWidth="2"
      />
      <rect x="7" y="7" width="6" height="6" rx="1.5" fill="currentColor" />
    </svg>
  );
}
export function IconPedidos({ className }: P) {
  return (
    <svg className={className ?? base} viewBox="0 0 20 20" fill="none">
      <path
        d="M2.5 6.5 10 3l7.5 3.5L10 10 2.5 6.5Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M2.5 6.5v7L10 17l7.5-3.5v-7M10 10v7"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}
export function IconMetricas({ className }: P) {
  return (
    <svg className={className ?? base} viewBox="0 0 20 20" fill="none">
      <rect x="3" y="11" width="3.5" height="6" rx="1" fill="currentColor" />
      <rect x="8.25" y="5" width="3.5" height="12" rx="1" fill="currentColor" />
      <rect x="13.5" y="8" width="3.5" height="9" rx="1" fill="currentColor" />
    </svg>
  );
}
export function IconContenido({ className }: P) {
  return (
    <svg className={className ?? base} viewBox="0 0 20 20" fill="none">
      <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="2" />
      <circle cx="10" cy="10" r="2.5" fill="currentColor" />
    </svg>
  );
}
export function IconConfig({ className }: P) {
  return (
    <svg className={className ?? base} viewBox="0 0 20 20" fill="none">
      <circle cx="10" cy="10" r="2.5" stroke="currentColor" strokeWidth="2" />
      <path
        d="M10 2.5v2M10 15.5v2M17.5 10h-2M4.5 10h-2M15.3 4.7l-1.4 1.4M6.1 13.9l-1.4 1.4M15.3 15.3l-1.4-1.4M6.1 6.1L4.7 4.7"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
export function IconMenu({ className }: P) {
  return (
    <svg className={className ?? base} viewBox="0 0 20 20" fill="none">
      <path
        d="M3 6h14M3 10h14M3 14h14"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
