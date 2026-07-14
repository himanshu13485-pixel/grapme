/** Decorative payment-method badges (trust signal). Not wired to any processor. */
export function PaymentLogos({ className = '' }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2 ${className}`} aria-label="Accepted payment methods">
      {/* Visa */}
      <span className="inline-grid h-6 w-10 place-items-center rounded border border-line bg-white">
        <svg viewBox="0 0 40 14" className="h-2.5 w-8">
          <text x="20" y="11" textAnchor="middle" fontSize="12" fontWeight="700" fontStyle="italic" fontFamily="Arial, sans-serif" fill="#1a1f71">VISA</text>
        </svg>
      </span>
      {/* Mastercard */}
      <span className="inline-grid h-6 w-10 place-items-center rounded border border-line bg-white">
        <svg viewBox="0 0 32 20" className="h-3.5">
          <circle cx="13" cy="10" r="8" fill="#eb001b" />
          <circle cx="19" cy="10" r="8" fill="#f79e1b" fillOpacity="0.85" />
        </svg>
      </span>
      {/* Amex */}
      <span className="inline-grid h-6 w-10 place-items-center rounded bg-[#2e77bc]">
        <svg viewBox="0 0 44 14" className="h-2.5 w-9">
          <text x="22" y="11" textAnchor="middle" fontSize="10" fontWeight="800" fontFamily="Arial, sans-serif" fill="#ffffff">AMEX</text>
        </svg>
      </span>
      {/* PayPal */}
      <span className="inline-grid h-6 w-10 place-items-center rounded border border-line bg-white">
        <svg viewBox="0 0 48 14" className="h-2.5 w-9">
          <text x="24" y="11" textAnchor="middle" fontSize="11" fontWeight="800" fontStyle="italic" fontFamily="Arial, sans-serif">
            <tspan fill="#003087">Pay</tspan><tspan fill="#009cde">Pal</tspan>
          </text>
        </svg>
      </span>
    </div>
  );
}
