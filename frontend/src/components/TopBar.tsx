export default function TopBar() {
  return (
    <div className="flex items-center gap-4 px-6 py-3.5 bg-[#161b22] border-b border-[#21262d] shrink-0">
      <span className="font-mono text-base font-bold text-white tracking-tight">
        PAVOIS<span className="text-[#58a6ff]">.</span>MAP
      </span>

      <span className="font-mono text-[10px] text-[#484f58] border border-[#21262d] px-3 py-1 tracking-widest uppercase">
        Drone Detection System
      </span>

      <div className="ml-auto flex items-center gap-3">
        {/* Status indicator */}
        <span className="inline-block w-2 h-2 rounded-full bg-yellow-500 animate-pulse" />
        <span className="font-mono text-[11px] text-[#484f58]">
          PLANNING MODE — no detection running
        </span>
      </div>
    </div>
  )
}
