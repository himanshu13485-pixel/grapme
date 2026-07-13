/** Hero animation: a slowly rotating ring of avatar bubbles behind the panel. */
export function OrbitAvatars() {
  const colors = ['#4f46e5', '#0fb894', '#f59e0b', '#ff6159', '#5b6bff', '#00c39a', '#7c66ff', '#ff8a3d'];
  const radius = 275;

  return (
    <div className="orbit-ring pointer-events-none absolute left-1/2 top-1/2 -z-10 h-[560px] w-[560px] -translate-x-1/2 -translate-y-1/2">
      {/* ring guide */}
      <div className="absolute inset-0 rounded-full border-2 border-dashed border-brand/25" />
      {colors.map((c, i) => {
        const ang = (i / colors.length) * 360;
        return (
          <span
            key={i}
            className="absolute left-1/2 top-1/2"
            style={{ transform: `rotate(${ang}deg) translateX(${radius}px) rotate(-${ang}deg)` }}
          >
            <span
              className="orbit-item -ml-6 -mt-6 block h-12 w-12 rounded-full border-[3px] border-paper shadow-card"
              style={{ background: `linear-gradient(135deg, ${c}, ${c}bb)` }}
            />
          </span>
        );
      })}
    </div>
  );
}
