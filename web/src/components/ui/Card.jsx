export default function Card({ className = '', children, ...props }) {
  return (
    <div className={`rounded-xl border border-slate-200 bg-white shadow-sm ${className}`} {...props}>
      {children}
    </div>
  );
}
