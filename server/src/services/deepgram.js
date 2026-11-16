import fs from 'node:fs';
import path from 'node:path';
import {execFile, spawn} from 'node:child_process';
import {promisify} from 'node:util';
const execFileAsync=promisify(execFile);
const DEEPGRAM_URL='https://api.deepgram.com/v1/listen';
const SARVAM_URL='https://api.sarvam.ai/speech-to-text';
const ffmpegPath=process.env.FFMPEG_PATH||'ffmpeg';
const ffprobePath=process.env.FFPROBE_PATH||(path.isAbsolute(ffmpegPath)?path.join(path.dirname(ffmpegPath),process.platform==='win32'?'ffprobe.exe':'ffprobe'):'ffprobe');
const SAMPLE_RATE=16000;
const PCM_BYTES_PER_SECOND=SAMPLE_RATE*2;
const DEEPGRAM_CHUNK_SECONDS=120;
const OTHER_CHUNK_SECONDS=25;
const DEEPGRAM_CHUNK_OVERLAP_SECONDS=3;
const PROVIDER_TIMEOUT_MS=90000;

export async function splitAudio(inputPath,outDir,signal,chunkSeconds=getChunkSeconds()){
  // Chunk long recordings so provider limits and retries do not require re-uploading the full file.
  await fs.promises.mkdir(outDir,{recursive:true});
  const {stdout}=await execFileAsync(ffprobePath,['-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',inputPath],{signal});
  const duration=Number(stdout.trim()); if(!duration) throw new Error('Could not read audio duration; ensure ffmpeg/ffprobe is installed');
  const files=[];
  for(let start=0,index=0;start<duration;start+=chunkSeconds,index++){
    if(signal?.aborted) throw signal.reason || new Error('Audio splitting cancelled');
    const out=path.join(outDir,`chunk-${String(index).padStart(4,'0')}.mp3`);
    await execFileAsync(ffmpegPath,['-y','-ss',String(start),'-i',inputPath,'-t',String(chunkSeconds),'-vn','-ac','1','-ar',String(SAMPLE_RATE),'-b:a','48k',out],{signal});
    files.push({path:out,offset:start,index,duration:Math.min(chunkSeconds,duration-start)});
  }
  return {files,duration};
}
function getTranscriptionProvider(){
  const provider=(process.env.STT_PROVIDER||'deepgram').toLowerCase();
  if(!['deepgram','sarvam','both'].includes(provider)) throw new Error('STT_PROVIDER must be deepgram, sarvam, or both');
  return provider;
}
function getChunkSeconds(provider=getTranscriptionProvider()){
  return provider==='deepgram'?DEEPGRAM_CHUNK_SECONDS:OTHER_CHUNK_SECONDS;
}
function requireProviderKeys(){
  const provider=getTranscriptionProvider();
  if(provider!=='sarvam'&&!process.env.DEEPGRAM_API_KEY) throw new Error('DEEPGRAM_API_KEY is missing');
  if(provider!=='deepgram'&&!process.env.SARVAM_API_KEY) throw new Error('SARVAM_API_KEY is missing');
  return provider;
}
async function transcribeDeepgramAudio(audio,contentType,signal){
  const key=process.env.DEEPGRAM_API_KEY;
  const params=new URLSearchParams({model:process.env.DEEPGRAM_MODEL||'nova-3',language:'multi',smart_format:'true',diarize:'true'});
  let response;
  try {
    response=await fetch(`${DEEPGRAM_URL}?${params}`,{
      method:'POST',
      headers:{Authorization:`Token ${key}`,'Content-Type':contentType},
      signal,
      body:audio
    });
  } catch (error) {
    throw new Error(`Deepgram request failed before receiving a response: ${error.message}`, { cause: error });
  }
  const data=await response.json(); if(!response.ok) throw new Error(`Deepgram ${response.status}: ${JSON.stringify(data)}`);
  return data;
}
async function transcribeSarvamAudio(audio,fileName,contentType,signal){
  const form=new FormData();
  form.append('file',new Blob([audio],{type:contentType}),fileName);
  form.append('model','saaras:v4');
  form.append('mode',process.env.SARVAM_MODE||'codemix');
  form.append('with_timestamps','true');
  const response=await fetch(SARVAM_URL,{
    method:'POST',
    headers:{'api-subscription-key':process.env.SARVAM_API_KEY},
    signal,
    body:form
  });
  const data=await response.json();
  if(!response.ok) throw new Error(`Sarvam ${response.status}: ${JSON.stringify(data)}`);
  return data;
}
export function parseDeepgramResponse(data,offset=0,duration=Infinity){
  const channel=data?.results?.channels?.[0];
  const alternative=channel?.alternatives?.[0];
  const segments=(alternative?.words||[]).flatMap(word=>{
    const start=Number(word.start)+offset,end=Number(word.end)+offset;
    const text=(word.punctuated_word||word.word||'').trim();
    if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<=start||start>=duration||!text) return [];
    return [{start,end:Math.min(duration,end),text,speaker:word.speaker??null,language:word.language||null,timingType:'word'}];
  });
  return {transcript:alternative?.transcript||'',language:alternative?.languages?.join(',')||null,segments};
}
export function reconcileChunkSpeakerIds(previousSegments,currentSegments,overlapStart,overlapEnd,nextSpeakerId=0){
  // Match speaker labels only within overlapping audio, where the same voices can be compared.
  const pairScores=new Map();
  for(const current of currentSegments){
    if(current.speaker===null||current.speaker===undefined||current.start>=overlapEnd||current.end<=overlapStart) continue;
    for(const previous of previousSegments){
      if(previous.speaker===null||previous.speaker===undefined||previous.start>=overlapEnd||previous.end<=overlapStart) continue;
      const overlap=Math.min(current.end,previous.end,overlapEnd)-Math.max(current.start,previous.start,overlapStart);
      if(overlap<=0) continue;
      const currentKey=String(current.speaker);
      const previousKey=String(previous.speaker);
      const key=JSON.stringify([currentKey,previousKey]);
      pairScores.set(key,(pairScores.get(key)||0)+overlap);
    }
  }
  const pairs=[...pairScores].map(([key,score])=>({keys:JSON.parse(key),score}))
    .sort((a,b)=>b.score-a.score);
  const speakerMap=new Map();
  const assignedGlobalSpeakers=new Set();
  for(const {keys:[currentKey,previousKey]} of pairs){
    if(speakerMap.has(currentKey)||assignedGlobalSpeakers.has(previousKey)) continue;
    speakerMap.set(currentKey,previousSegments.find(segment=>String(segment.speaker)===previousKey).speaker);
    assignedGlobalSpeakers.add(previousKey);
  }
  const localSpeakers=[...new Map(currentSegments
    .filter(segment=>segment.speaker!==null&&segment.speaker!==undefined)
    .map(segment=>[String(segment.speaker),segment]))
    .entries()]
    .sort((a,b)=>a[1].start-b[1].start);
  for(const [speakerKey] of localSpeakers){
    if(!speakerMap.has(speakerKey)) speakerMap.set(speakerKey,nextSpeakerId++);
  }
  return {
    segments:currentSegments.map(segment=>({
      ...segment,
      speaker:segment.speaker===null||segment.speaker===undefined
        ? null
        : speakerMap.get(String(segment.speaker))
    })),
    nextSpeakerId
  };
}
export function removeTranscriptOverlap(previousTranscript,currentTranscript,maxOverlapWords=32){
  const previousWords=String(previousTranscript||'').trim().split(/\s+/).filter(Boolean);
  const currentWords=String(currentTranscript||'').trim().split(/\s+/).filter(Boolean);
  const normalize=word=>word.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
  const maxOverlap=Math.min(maxOverlapWords,previousWords.length,currentWords.length);
  for(let count=maxOverlap;count>0;count--){
    const previousTail=previousWords.slice(-count).map(normalize);
    const currentHead=currentWords.slice(0,count).map(normalize);
    if(previousTail.every((word,index)=>word&&word===currentHead[index])){
      return currentWords.slice(count).join(' ');
    }
  }
  return currentWords.join(' ');
}
export function parseSarvamResponse(data,offset=0,duration=Infinity){
  const transcript=String(data?.transcript||'').trim();
  const timestamps=data?.timestamps;
  const segments=[];
  if(Array.isArray(timestamps?.start_time_seconds)&&Array.isArray(timestamps?.end_time_seconds)){
    timestamps.start_time_seconds.forEach((value,index)=>{
      const start=Number(value)+offset,end=Number(timestamps.end_time_seconds[index])+offset;
      const text=String(timestamps.words?.[index]||timestamps.chunks?.[index]||'').trim();
      if(Number.isFinite(start)&&Number.isFinite(end)&&start>=0&&end>start&&start<duration&&text){
        segments.push({start,end:Math.min(duration,end),text,speaker:null,language:data?.language_code||null,timingType:'phrase'});
      }
    });
  }
  return {transcript,language:data?.language_code||null,segments};
}
export function groupTranscriptSegments(segments){
  const grouped=[];
  let current=null;
  const flush=()=>{
    if(current) grouped.push(current);
    current=null;
  };
  for(const segment of [...segments].sort((a,b)=>a.start-b.start)){
    const speakerChanged=current?.speaker!==null&&current?.speaker!==undefined
      &&segment.speaker!==null&&segment.speaker!==undefined
      &&current.speaker!==segment.speaker;
    if(speakerChanged) flush();
    if(!current){
      current={start:segment.start,end:segment.end,text:segment.text,speaker:segment.speaker??null,language:segment.language??null,timingType:'sentence'};
    }else{
      current.end=segment.end;
      current.text=`${current.text} ${segment.text}`;
      current.speaker??=segment.speaker??null;
      current.language??=segment.language??null;
    }
    if(/[.!?…\u0964\u0965]["'”’)\]}]*$/u.test(segment.text.trim())) flush();
  }
  flush();
  return grouped;
}
export async function transcribeAudioChunk(audio,offset,duration,contentType,fileName,signal,chunkDuration){
  if(signal?.aborted) throw signal.reason||new Error('Transcription cancelled');
  const provider=getTranscriptionProvider();
  const controller=new AbortController();
  const cancel=()=>controller.abort(signal.reason||new Error('Transcription cancelled'));
  signal?.addEventListener('abort',cancel,{once:true});
  const providerLabel=provider==='both'?'Deepgram and Sarvam':provider==='sarvam'?'Sarvam':'Deepgram';
  const timeout=setTimeout(()=>controller.abort(new Error(`${providerLabel} transcription timed out after 90 seconds`)),PROVIDER_TIMEOUT_MS);
  try{
    const [deepgramData,sarvamData]=await Promise.all([
      provider!=='sarvam'?transcribeDeepgramAudio(audio,contentType,controller.signal):Promise.resolve(null),
      provider!=='deepgram'?transcribeSarvamAudio(audio,fileName,contentType,controller.signal):Promise.resolve(null)
    ]);
    const deepgram=deepgramData?parseDeepgramResponse(deepgramData,offset,duration):null;
    const sarvam=sarvamData?parseSarvamResponse(sarvamData,offset,duration):null;
    if(deepgram&&!deepgram.segments.length&&deepgram.transcript){
      deepgram.segments.push({start:offset,end:Math.min(duration,offset+(chunkDuration??getChunkSeconds(provider))),text:deepgram.transcript,speaker:null,timingType:'chunk'});
    }
    if(sarvam&&!sarvam.segments.length&&sarvam.transcript){
      sarvam.segments.push({start:offset,end:Math.min(duration,offset+(chunkDuration??getChunkSeconds(provider))),text:sarvam.transcript,speaker:null,language:sarvam.language,timingType:'chunk'});
    }
    return {deepgram,sarvam};
  }catch(error){
    controller.abort(error);
    throw error;
  }finally{
    clearTimeout(timeout);
    signal?.removeEventListener('abort',cancel);
  }
}
function pcmToWav(pcm){
  const wav=Buffer.alloc(44+pcm.length);
  wav.write('RIFF',0);
  wav.writeUInt32LE(36+pcm.length,4);
  wav.write('WAVE',8);
  wav.write('fmt ',12);
  wav.writeUInt32LE(16,16);
  wav.writeUInt16LE(1,20);
  wav.writeUInt16LE(1,22);
  wav.writeUInt32LE(SAMPLE_RATE,24);
  wav.writeUInt32LE(PCM_BYTES_PER_SECOND,28);
  wav.writeUInt16LE(2,32);
  wav.writeUInt16LE(16,34);
  wav.write('data',36);
  wav.writeUInt32LE(pcm.length,40);
  pcm.copy(wav,44);
  return wav;
}
export function getPcmStreamProgress(chunksYielded,pendingBytes,bytesPerChunk){
  const chunkFraction=Math.min(pendingBytes/bytesPerChunk,1);
  return Math.min(90,20+chunksYielded*3+Math.floor(chunkFraction*2));
}
async function* streamPcmChunks(audioUrl,signal,chunkSeconds,overlapSeconds=0){
  const child=spawn(ffmpegPath,['-nostdin','-v','error','-rw_timeout','30000000','-i',audioUrl,'-vn','-ac','1','-ar',String(SAMPLE_RATE),'-f','s16le','-acodec','pcm_s16le','pipe:1'],{
    windowsHide:true,
    stdio:['ignore','pipe','ignore'],
    ...(signal?{signal}:{})
  });
  let processFailure=null;
  const closed=new Promise(resolve=>{
    child.once('error',error=>{processFailure=error;resolve();});
    child.once('close',code=>{
      if(code!==0) processFailure=new Error('YouTube audio stream conversion failed');
      resolve();
    });
  });
  const bytesPerChunk=PCM_BYTES_PER_SECOND*chunkSeconds;
  const overlapBytes=PCM_BYTES_PER_SECOND*overlapSeconds;
  let pending=Buffer.alloc(0);
  let chunkOffset=0;
  let chunksYielded=0;
  let lastReportedProgress=20;
  const reportProgress=async()=>{
    const progress=getPcmStreamProgress(chunksYielded,pending.length,bytesPerChunk);
    if(progress<=lastReportedProgress) return null;
    lastReportedProgress=progress;
    return {
      type:'progress',
      progress,
      message:`Streaming YouTube audio (${Math.floor(chunkOffset+pending.length/PCM_BYTES_PER_SECOND)} seconds received)`
    };
  };
  try{
    for await(const data of child.stdout){
      if(signal?.aborted) throw signal.reason||new Error('YouTube transcription cancelled');
      pending=Buffer.concat([pending,data]);
      while(pending.length>=bytesPerChunk){
        const progress=await reportProgress();
        if(progress) yield progress;
        yield {
          type:'chunk',
          pcm:pending.subarray(0,bytesPerChunk),
          offset:chunkOffset,
          uniqueStart:chunkOffset+(chunksYielded?overlapSeconds:0)
        };
        pending=pending.subarray(bytesPerChunk-overlapBytes);
        chunkOffset+=(bytesPerChunk-overlapBytes)/PCM_BYTES_PER_SECOND;
        chunksYielded++;
      }
      const progress=await reportProgress();
      if(progress) yield progress;
    }
    await closed;
    if(processFailure) throw processFailure;
    if(pending.length&&(!chunksYielded||pending.length>overlapBytes)){
      const progress=await reportProgress();
      if(progress) yield progress;
      yield {
        type:'chunk',
        pcm:pending,
        offset:chunkOffset,
        uniqueStart:chunkOffset+(chunksYielded?overlapSeconds:0)
      };
    }
  }catch(error){
    if(signal?.aborted) throw signal.reason||error;
    throw new Error('Could not stream audio from the YouTube link', {cause:error});
  }finally{
    if(child.exitCode===null&&child.signalCode===null) child.kill();
  }
}
function combineChunkResults(results,duration){
  const provider=getTranscriptionProvider();
  const deepgramResults=results.map(result=>result.deepgram).filter(Boolean);
  const sarvamResults=results.map(result=>result.sarvam).filter(Boolean);
  const deepgramTranscript=deepgramResults.map(result=>result.transcript).filter(Boolean).join(' ').trim();
  const sarvamTranscript=sarvamResults.map(result=>result.transcript).filter(Boolean).join(' ').trim();
  const deepgramSegments=groupTranscriptSegments(deepgramResults.flatMap(result=>result.segments));
  const sarvamSegments=sarvamResults.flatMap(result=>result.segments);
  return {
    transcript:deepgramTranscript||sarvamTranscript,
    deepgramTranscript,
    sarvamTranscript,
    sarvamSegments,
    segments:deepgramSegments.length?deepgramSegments:sarvamSegments,
    language:results.map(result=>result.deepgram?.language||result.sarvam?.language).find(Boolean)||null,
    duration,
    providers:provider==='both'?['deepgram','sarvam']:[provider],
    timingNote:provider==='sarvam'
      ? 'Sarvam provides phrase/chunk timing; word-level timestamps and speaker labels are not available.'
      : provider==='both'
        ? 'Deepgram word timings are grouped into sentence and speaker segments; Sarvam provides a separate transcript with phrase/chunk timing.'
        : 'Deepgram word timings are grouped into sentence and speaker segments.'
  };
}
export async function transcribeLongAudio(audioPath,workDir,signal){
  requireProviderKeys();
  const chunkSeconds=getChunkSeconds();
  const {files,duration}=await splitAudio(audioPath,path.join(workDir,'stt-chunks'),signal,chunkSeconds);
  const results=[];
  for(const chunk of files){
    if(signal?.aborted) throw signal.reason || new Error('Transcription cancelled');
    const audio=await fs.promises.readFile(chunk.path);
    results.push(await transcribeAudioChunk(audio,chunk.offset,duration,'audio/mpeg',path.basename(chunk.path),signal,chunk.duration));
  }
  return combineChunkResults(results,duration);
}
export async function transcribeYouTubeAudioStream(audioUrl,signal,onProgress){
  requireProviderKeys();
  const controller=new AbortController();
  const cancel=()=>controller.abort(signal.reason||new Error('YouTube transcription cancelled'));
  signal?.addEventListener('abort',cancel,{once:true});
  if(signal?.aborted) cancel();
  const provider=getTranscriptionProvider();
  const chunkSeconds=getChunkSeconds();
  const overlapSeconds=provider==='sarvam'?0:DEEPGRAM_CHUNK_OVERLAP_SECONDS;
  let requestFailure=null;
  try{
    await onProgress?.({progress:20,message:'Streaming YouTube audio'});
    const rawResults=[];
    let completedChunks=0;
    let duration=0;
    for await(const chunk of streamPcmChunks(audioUrl,controller.signal,chunkSeconds,overlapSeconds)){
      if(chunk.type==='progress'){
        await onProgress?.({progress:chunk.progress,message:chunk.message});
        continue;
      }
      if(controller.signal.aborted) throw controller.signal.reason||new Error('YouTube transcription cancelled');
      const {pcm,offset}=chunk;
      const chunkDuration=pcm.length/PCM_BYTES_PER_SECOND;
      duration=Math.max(duration,offset+chunkDuration);
      const audio=pcmToWav(pcm);
      let result;
      try{
        result=await transcribeAudioChunk(
          audio,
          offset,
          offset+chunkDuration,
          'audio/wav',
          `youtube-audio-${completedChunks}.wav`,
          controller.signal,
          chunkDuration
        );
      }catch(error){
        if(!requestFailure) requestFailure=error;
        controller.abort(error);
        throw error;
      }
      rawResults.push({chunk,result});
      completedChunks++;
      await onProgress?.({
        progress:Math.min(90,20+completedChunks*3),
        message:`Transcribed ${completedChunks} audio segments`
      });
    }
    if(!rawResults.length) throw new Error('No audio could be read from the YouTube link');

    const results=[];
    let previousOverlapSegments=[];
    let nextSpeakerId=0;
    let previousDeepgramTranscript='';
    let previousSarvamTranscript='';
    for(const {chunk,result} of rawResults){
      const {pcm,offset,uniqueStart}=chunk;
      const end=offset+pcm.length/PCM_BYTES_PER_SECOND;
      if(result.deepgram){
        const currentDeepgramTranscript=result.deepgram.transcript;
        const reconciled=reconcileChunkSpeakerIds(
          previousOverlapSegments,
          result.deepgram.segments,
          offset,
          uniqueStart,
          nextSpeakerId
        );
        nextSpeakerId=reconciled.nextSpeakerId;
        previousOverlapSegments=reconciled.segments.filter(segment=>segment.end>end-overlapSeconds);
        const hasWordTimings=reconciled.segments.some(segment=>segment.timingType==='word');
        result.deepgram.segments=reconciled.segments.filter(segment=>segment.start>=uniqueStart);
        if(hasWordTimings){
          result.deepgram.transcript=result.deepgram.segments.map(segment=>segment.text).join(' ');
        }else if(overlapSeconds){
          result.deepgram.transcript=removeTranscriptOverlap(previousDeepgramTranscript,currentDeepgramTranscript);
        }
        previousDeepgramTranscript=currentDeepgramTranscript;
      }
      if(result.sarvam&&overlapSeconds){
        const currentSarvamTranscript=result.sarvam.transcript;
        const hasPhraseTimings=result.sarvam.segments.some(segment=>segment.timingType==='phrase');
        result.sarvam.segments=result.sarvam.segments.filter(segment=>segment.start>=uniqueStart);
        result.sarvam.transcript=hasPhraseTimings
          ? result.sarvam.segments.map(segment=>segment.text).join(' ')
          : removeTranscriptOverlap(previousSarvamTranscript,currentSarvamTranscript);
        previousSarvamTranscript=currentSarvamTranscript;
      }
      results.push(result);
    }
    return combineChunkResults(results,duration);
  }catch(error){
    const failure=requestFailure||controller.signal.reason||error;
    controller.abort(failure);
    throw failure;
  }finally{
    signal?.removeEventListener('abort',cancel);
  }
}
