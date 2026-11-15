export function applySpeakerCorrections(segments,corrections){
  return segments.map(segment=>{
    const correction=corrections.find(item=>{
      const start=Number(segment.start);
      return Number.isFinite(start)&&start>=item.start&&start<item.end;
    });
    return correction?{...segment,speaker:correction.speaker}:segment;
  });
}
