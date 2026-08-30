export function Logo() {
  return (
    <div className="flex items-center gap-2 px-2.5">
      <div className="h-[26px] w-[26px] shrink-0 rounded-[7px] bg-accent" />
      <div className="font-display text-[19px] font-extrabold tracking-[-0.02em]">
        Indiggo<span className="text-accent">!</span>
      </div>
    </div>
  );
}
