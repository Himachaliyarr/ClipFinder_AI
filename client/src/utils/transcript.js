export function formatTranscriptTimestamp(seconds) {
  const totalTenths = Math.round(seconds * 10);
  const totalSeconds = Math.floor(totalTenths / 10);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const wholeSeconds = totalSeconds % 60;
  const time = hours
    ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(wholeSeconds).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(wholeSeconds).padStart(2, '0')}`;
  return `${time}.${totalTenths % 10}`;
}

export function formatClipTimecode(seconds) {
  const totalTenths = Math.round(Number(seconds) * 10);
  const totalSeconds = Math.floor(totalTenths / 10);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const wholeSeconds = totalSeconds % 60;
  const tenths = totalTenths % 10;
  const timecode = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(wholeSeconds).padStart(2, '0')}`;
  return tenths ? `${timecode}.${tenths}` : timecode;
}

export function formatEditableTimestamp(seconds) {
  const totalMilliseconds = Math.max(0, Math.round(Number(seconds) * 1000));
  const hours = Math.floor(totalMilliseconds / 3_600_000);
  const minutes = Math.floor((totalMilliseconds % 3_600_000) / 60_000);
  const wholeSeconds = Math.floor((totalMilliseconds % 60_000) / 1000);
  const milliseconds = totalMilliseconds % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(wholeSeconds).padStart(2, '0')}.${String(milliseconds).padStart(3, '0')}`;
}

export function parseEditableTimestamp(value) {
  const match = /^(\d+):([0-5]\d):([0-5]\d)(?:\.(\d{1,3}))?$/.exec(String(value).trim());
  if (!match) return null;
  const [, hoursText, minutesText, secondsText, millisecondsText = '0'] = match;
  const hours = Number(hoursText);
  if (!Number.isSafeInteger(hours)) return null;
  return hours * 3600 + Number(minutesText) * 60 + Number(secondsText) + Number(`0.${millisecondsText}`);
}

export function parseClipTimecode(value) {
  const match = /^(\d+):([0-5]\d):([0-5]\d)(?:\.(\d))?$/.exec(String(value).trim());
  if (!match) return null;

  const [, hoursText, minutesText, secondsText, tenthsText = '0'] = match;
  const wholeSeconds = Number(hoursText) * 3600 + Number(minutesText) * 60 + Number(secondsText);
  if (!Number.isSafeInteger(wholeSeconds)) return null;
  return wholeSeconds + Number(`0.${tenthsText}`);
}

function formatSubtitleTimestamp(seconds, decimalSeparator) {
  const totalMilliseconds = Math.max(0, Math.round(Number(seconds) * 1000));
  const hours = Math.floor(totalMilliseconds / 3_600_000);
  const minutes = Math.floor((totalMilliseconds % 3_600_000) / 60_000);
  const wholeSeconds = Math.floor((totalMilliseconds % 60_000) / 1000);
  const milliseconds = totalMilliseconds % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(wholeSeconds).padStart(2, '0')}${decimalSeparator}${String(milliseconds).padStart(3, '0')}`;
}

export function formatTranscriptSrt(segments) {
  return getTranscriptLines(segments).map((line, index) => (
    `${index + 1}\n${formatSubtitleTimestamp(line.start, ',')} --> ${formatSubtitleTimestamp(line.end, ',')}\n${line.text}`
  )).join('\n\n');
}

export function formatTranscriptVtt(segments) {
  const cues = getTranscriptLines(segments).map(line => (
    `${formatSubtitleTimestamp(line.start, '.')} --> ${formatSubtitleTimestamp(line.end, '.')}\n${line.text}`
  ));
  return `WEBVTT\n\n${cues.join('\n\n')}`;
}

export function formatClipMetadataCsv(clips) {
  const quote = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const rows = [
    ['Title', 'Start (seconds)', 'End (seconds)', 'Hook', 'Caption', 'Status', 'Assigned editor'],
    ...clips.map(clip => [
      clip.title,
      clip.start,
      clip.end,
      clip.hook,
      clip.caption,
      clip.status,
      clip.assignedTo?.name,
    ]),
  ];
  return `\uFEFF${rows.map(row => row.map(quote).join(',')).join('\r\n')}`;
}

export function formatStoryMetadataCsv(stories) {
  const quote = value => {
    const text = String(value ?? '');
    const safeText = /^[\u0000-\u0020]*[=+\-@]/.test(text) ? `'${text}` : text;
    return `"${safeText.replace(/"/g, '""')}"`;
  };
  const rows = [
    ['Title', 'Start (seconds)', 'End (seconds)', 'Summary', 'Excerpt', 'Exact transcript', 'Reason', 'Score'],
    ...stories.map(story => [
      story.title,
      story.start,
      story.end,
      story.summary,
      story.excerpt,
      story.script || 'Unavailable for this time range.',
      story.reason,
      story.score,
    ]),
  ];
  return `\uFEFF${rows.map(row => row.map(quote).join(',')).join('\r\n')}`;
}

export function formatStoryMetadataText(stories) {
  return stories.map((story, index) => [
    `Story ${index + 1}: ${String(story.title || 'Untitled story')}`,
    `Time: ${formatTranscriptTimestamp(Number(story.start))} - ${formatTranscriptTimestamp(Number(story.end))}`,
    `Summary: ${String(story.summary || '')}`,
    ...(story.excerpt ? [`Excerpt: ${story.excerpt}`] : []),
    `Exact transcript:\n${String(story.script || 'Unavailable for this time range.')}`,
    ...(story.reason ? [`Why it stands out: ${story.reason}`] : []),
    `Score: ${String(story.score ?? '')}/10`,
  ].join('\n')).join('\n\n');
}

function endsSentence(text) {
  return /[.!?।॥]["'”’)\]]*$/.test(text);
}

export function getTranscriptLines(segments) {
  if (!Array.isArray(segments)) return [];
  const ordered = segments
    .map(segment => ({
      start: Number(segment?.start),
      end: Number(segment?.end),
      text: String(segment?.text || '').trim(),
      speaker: segment?.speaker ?? null,
      timingType: segment?.timingType,
    }))
    .filter(segment => Number.isFinite(segment.start) && Number.isFinite(segment.end) && segment.start >= 0 && segment.end > segment.start && segment.text)
    .sort((a, b) => a.start - b.start);

  const lines = [];
  let current = null;
  const flush = () => {
    if (!current) return;
    const { start, end, speaker, text } = current;
    lines.push({ start, end, speaker, text });
    current = null;
  };

  for (const segment of ordered) {
    if (segment.timingType !== 'word') {
      flush();
      lines.push({ start: segment.start, end: segment.end, speaker: segment.speaker, text: segment.text });
      continue;
    }

    if (current && (
      current.speaker !== segment.speaker
      || segment.start - current.end > 1
    )) flush();

    if (!current) {
      current = { start: segment.start, end: segment.end, speaker: segment.speaker, text: '' };
    }
    current.end = Math.max(current.end, segment.end);
    current.text = `${current.text}${current.text ? ' ' : ''}${segment.text}`;
    if (endsSentence(segment.text)) flush();
  }
  flush();
  return lines;
}

export function getTranscriptLinesInRange(segments, start, end) {
  const rangeStart = Number(start);
  const rangeEnd = Number(end);
  if (!Array.isArray(segments) || !Number.isFinite(rangeStart) || !Number.isFinite(rangeEnd) || rangeEnd <= rangeStart) {
    return [];
  }
  return getTranscriptLines(segments.filter(segment => (
    Number(segment?.start) < rangeEnd && Number(segment?.end) > rangeStart
  )));
}

export function getTranscriptLinesOverlappingRange(segments, start, end) {
  const rangeStart = Number(start);
  const rangeEnd = Number(end);
  if (!Number.isFinite(rangeStart) || !Number.isFinite(rangeEnd) || rangeEnd <= rangeStart) return [];
  return getTranscriptLines(segments).filter(line => line.start < rangeEnd && line.end > rangeStart);
}

export function buildClipSentenceEditPatch(clip, sentences, originalSentences) {
  const unchanged = sentences.length === originalSentences.length && sentences.every((sentence, index) => (
    sentence.sentenceId === originalSentences[index].sentenceId
    && sentence.start === originalSentences[index].start
    && sentence.end === originalSentences[index].end
  ));
  const start = unchanged ? Number(clip.start) : Math.min(Number(clip.start), ...sentences.map(sentence => sentence.start));
  const end = unchanged ? Number(clip.end) : Math.max(Number(clip.end), ...sentences.map(sentence => sentence.end));
  const startShift = Number(clip.start) - start;
  return {
    start,
    end,
    sentenceEdits: unchanged ? [] : sentences.map(({ sentenceId, start: sentenceStart, end: sentenceEnd }) => ({
      ...(sentenceId ? { sentenceId } : {}),
      start: sentenceStart,
      end: sentenceEnd,
    })),
    ...(startShift > 0 && clip.cameraSegments?.length ? {
      cameraSegments: clip.cameraSegments.map(segment => ({
        ...segment,
        start: segment.start + startShift,
        end: segment.end + startShift,
      })),
    } : {}),
  };
}

export function formatSpeaker(speaker) {
  if (speaker === null || speaker === undefined || speaker === '') return null;
  if (typeof speaker === 'number' && Number.isFinite(speaker)) return `Speaker ${speaker + 1}`;
  return String(speaker);
}

export function formatTranscriptForExport(transcript, segments) {
  const lines = getTranscriptLines(segments);
  if (!lines.length) return String(transcript || '').trim();
  return lines.map(line => {
    const speaker = formatSpeaker(line.speaker);
    const label = speaker ? ` ${speaker}:` : '';
    return `[${formatTranscriptTimestamp(line.start)} - ${formatTranscriptTimestamp(line.end)}]${label} ${line.text}`;
  }).join('\n');
}

export function formatTranscriptJson(title, transcript, segments) {
  return JSON.stringify({
    title: String(title || 'Transcript'),
    transcript: String(transcript || ''),
    segments: getTranscriptLines(segments),
  }, null, 2);
}
