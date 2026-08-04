export function SystemAmbient() {
  return (
    <div className="system-ambient" aria-hidden="true">
      <span className="system-sweep system-sweep-a" />
      <span className="system-sweep system-sweep-b" />
      <span className="system-scanline" />
      <span className="system-axis system-axis-x" />
      <span className="system-axis system-axis-y" />
      <span className="system-node system-node-a" />
      <span className="system-node system-node-b" />
      <span className="system-node system-node-c" />
      <span className="system-node system-node-d" />
      <span className="system-data-rail">
        {Array.from({ length: 12 }, (_, index) => <i key={index} style={{ animationDelay: `${index * -0.32}s` }} />)}
      </span>
    </div>
  );
}
