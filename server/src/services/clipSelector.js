import { getChatCompletionsUrl } from './openai.js';

export function formatTimedTranscript(segments){
  // Keep the source timestamps in compact windows so the model can choose grounded clip ranges.
  const windows=new Map();
  for(const segment of segments){
    const start=Number(segment.start),end=Number(segment.end),text=String(segment.text||'').trim();
    if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start||!text) continue;
    const windowStart=Math.floor(start/10)*10;
    const windowEnd=windowStart+10;
    const entry=windows.get(windowStart)||{end:windowEnd,text:[]};
    entry.end=Math.max(entry.end,Math.min(windowEnd,end));
    entry.text.push(text);
    windows.set(windowStart,entry);
  }
  return [...windows].map(([start,entry])=>`[${start.toFixed(1)}-${entry.end.toFixed(1)}s] ${entry.text.join(' ')}`).join('\n');
}

function parseClipResponse(raw,duration){
  const cleaned=raw.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
  let parsed;
  try {
    parsed=JSON.parse(cleaned);
  } catch (error) {
    const firstBrace=cleaned.indexOf('{'),lastBrace=cleaned.lastIndexOf('}');
    if(firstBrace<0||lastBrace<=firstBrace) throw new Error('Clip selection returned invalid JSON',{cause:error});
    try { parsed=JSON.parse(cleaned.slice(firstBrace,lastBrace+1)); }
    catch (parseError) { throw new Error('Clip selection returned invalid JSON',{cause:parseError}); }
  }
  if(!Array.isArray(parsed?.clips)) throw new Error('Clip selection response did not contain a clips array');
  // Model output is untrusted: discard malformed ranges before creating persisted clips.
  const clips=parsed.clips.flatMap(clip=>{
    if(!clip||typeof clip!=='object'||clip.start===undefined||clip.end===undefined) return [];
    const start=Number(clip.start),end=Number(clip.end);
    if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<=start||end>duration) return [];
    return [{...clip,start,end}];
  }).slice(0,25);
  if(parsed.clips.length&&!clips.length) throw new Error('Clip selection returned suggestions, but all timestamps were invalid or outside the source duration');
  return clips;
}

export async function selectClips(transcript,duration,examples=[],segments=[],signal){
  const key=process.env.LLM_API_KEY;
  if(!key) return {clips:[],warning:'LLM_API_KEY is not configured. Add it to enable automatic hook/clip selection.'};
  if(!transcript?.trim()) return {clips:[],warning:'No transcript text is available for clip selection.'};
  const examplesText=examples.length
    ? `\nExamples editors approved and performance-ranked (learn the style and qualities; do not copy them):\n${JSON.stringify(examples.slice(0,20).map(({title,hook,caption,reason,performance})=>({title,hook,caption,reason,views:performance?.views||0,watchTime:performance?.watchTime||0})))}\n`
    : '';
  const timedTranscript=formatTimedTranscript(segments);
  const sourceText=(timedTranscript||transcript).slice(0,100000);
  const prompt=`You are a short-form podcast editor. Select compelling standalone reel moments from this transcript. Aim for 15-25 clips when the source has enough distinct content; return fewer rather than inventing moments. Return ONLY JSON: {"clips":[{"start":number,"end":number,"hook":string,"title":string,"caption":string,"score":number,"reason":string}]}. Use seconds, keep clips between 20 and 90 seconds when the source duration allows, preserve context, and never exceed ${duration} seconds. The transcript lines include source-time ranges; choose start/end that match those ranges and do not invent timestamps. Prefer strong opinions, stories, surprises, and actionable insights.${examplesText}Transcript with source timings:\n${sourceText}`;
  const model=process.env.LLM_MODEL||'gpt-6-astra';
  const generationOptions=model==='gpt-6-astra'
    ? {reasoning_effort:process.env.LLM_REASONING_EFFORT||'low'}
    : {temperature:0.3};
  let r;
  try {
    r=await fetch(getChatCompletionsUrl(),{
      method:'POST',
      headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},
      signal,
      body:JSON.stringify({model,...generationOptions,response_format:{type:'json_object'},messages:[{role:'user',content:prompt}]})
    });
  } catch (error) {
    throw new Error(`Clip selection request failed before receiving a response: ${error.message}`, { cause: error });
  }
  const data=await r.json();
  if(!r.ok) throw new Error(`Clip selection LLM error: ${JSON.stringify(data)}`);
  const raw=data.choices?.[0]?.message?.content||'';
  return {clips:parseClipResponse(raw,duration)};
}
