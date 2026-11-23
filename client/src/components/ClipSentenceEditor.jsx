import { useState } from 'react';
import {
  buildClipSentenceEditPatch,
  formatEditableTimestamp,
  mergeTimedRanges,
  parseEditableTimestamp,
  getTranscriptLinesOverlappingRange,
} from '../utils/transcript.js';

function getOriginalSentences(clip, transcriptSegments) {
  return getTranscriptLinesOverlappingRange(transcriptSegments, clip.start, clip.end)
    .map(line => {
      const timedWords = (transcriptSegments || [])
        .filter(segment => segment?.timingType === 'word'
          && Number(segment.start) >= line.start
          && Number(segment.end) <= line.end)
        .map(segment => ({
          start: Number(segment.start),
          end: Number(segment.end),
          text: String(segment.text || '').trim(),
        }))
        .filter(word => Number.isFinite(word.start) && Number.isFinite(word.end) && word.text);
      const fallbackText = String(line.text || '').trim();
      const fallbackWords = fallbackText ? fallbackText.split(/\s+/).filter(Boolean) : [];
      const durationPerWord = fallbackWords.length
        ? (line.end - line.start) / fallbackWords.length
        : 0;
      const words = timedWords.length
        ? timedWords
        : fallbackWords.map((text, index) => ({
            start: line.start + (durationPerWord * index),
            end: index === fallbackWords.length - 1
              ? line.end
              : line.start + (durationPerWord * (index + 1)),
            text,
          }));
      return {
        sentenceId: `${line.start}:${line.end}`,
        start: line.start,
        end: line.end,
        startValue: formatEditableTimestamp(line.start),
        endValue: formatEditableTimestamp(line.end),
        text: line.text,
        words,
      };
    });
}

function getSavedSentences(clip, originalSentences) {
  if (!clip.sentenceEdits?.length) return originalSentences;
  const keptRanges = clip.sentenceEdits.map(edit => ({
    start: Number(edit.start),
    end: Number(edit.end),
  }));
  return originalSentences
    .map(sentence => {
      const sentenceRanges = keptRanges.filter(edit => edit.start < sentence.end && edit.end > sentence.start);
      if (!sentenceRanges.length) return null;
      const words = sentence.words.map(word => ({
        ...word,
        removed: !sentenceRanges.some(range => word.start < range.end && word.end > range.start),
      }));
      const keptWordStarts = words.filter(word => !word.removed).map(word => word.start);
      const keptWordEnds = words.filter(word => !word.removed).map(word => word.end);
      const start = keptWordStarts.length ? Math.min(...keptWordStarts) : sentence.start;
      const end = keptWordEnds.length ? Math.max(...keptWordEnds) : sentence.end;
      return {
        ...sentence,
        words,
        start,
        end,
        startValue: formatEditableTimestamp(start),
        endValue: formatEditableTimestamp(end),
      };
    })
    .filter(Boolean);
}

export default function ClipSentenceEditor({ clip, transcriptSegments, sourceDuration, onSave }) {
  const [open, setOpen] = useState(false);
  const [sentences, setSentences] = useState([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [timestampError, setTimestampError] = useState(false);
  const originalSentences = getOriginalSentences(clip, transcriptSegments);

  function openEditor() {
    setSentences(getSavedSentences(clip, originalSentences));
    setMessage('');
    setTimestampError(false);
    setOpen(true);
  }

  function updateTimestamp(index, field, value) {
    setSentences(current => current.map((sentence, sentenceIndex) => (
      sentenceIndex === index ? { ...sentence, [`${field}Value`]: value } : sentence
    )));
    setMessage('');
    setTimestampError(false);
  }

  function moveSentence(index, direction) {
    setSentences(current => {
      const next = [...current];
      const target = index + direction;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function removeSentence(index) {
    setSentences(current => current.filter((_, sentenceIndex) => sentenceIndex !== index));
  }

  function setWordRemoved(sentenceIndex, wordIndex, removed) {
    setSentences(current => current.map((sentence, index) => (
      index === sentenceIndex
        ? {
            ...sentence,
            words: sentence.words.map((word, indexWithinSentence) => (
              indexWithinSentence === wordIndex ? { ...word, removed } : word
            )),
          }
        : sentence
    )));
  }

  async function saveSentences() {
    if (!sentences.length) {
      setMessage('Keep at least one sentence in the clip.');
      return;
    }
    const parsedSentences = sentences.map(sentence => ({
      ...sentence,
      start: sentence.startValue === formatEditableTimestamp(sentence.start)
        ? sentence.start
        : parseEditableTimestamp(sentence.startValue),
      end: sentence.endValue === formatEditableTimestamp(sentence.end)
        ? sentence.end
        : parseEditableTimestamp(sentence.endValue),
    }));
    if (parsedSentences.some(sentence => (
      !Number.isFinite(sentence.start) || !Number.isFinite(sentence.end)
      || sentence.start < 0 || sentence.end <= sentence.start
      || (sourceDuration !== null && sourceDuration !== undefined
        && Number.isFinite(Number(sourceDuration)) && sentence.end > Number(sourceDuration) + 0.25)
    ))) {
      setTimestampError(true);
      setMessage('Enter valid Start/End times as HH:MM:SS.mmm; End must be after Start and within the source.');
      return;
    }
    const chronological = [...parsedSentences].sort((a, b) => a.start - b.start);
    if (chronological.some((sentence, index) => index > 0 && sentence.start < chronological[index - 1].end)) {
      setTimestampError(true);
      setMessage('Sentence timestamps cannot overlap.');
      return;
    }
    const wordRanges = parsedSentences.flatMap(sentence => (
      (sentence.words || [])
        .filter(word => !word.removed)
        .map(word => ({ start: word.start, end: word.end }))
    ));
    const hasWordLevelEdits = parsedSentences.some(sentence => sentence.words?.some(word => word.removed));
    if (hasWordLevelEdits && !wordRanges.length) {
      setMessage('Keep at least one word in the clip.');
      return;
    }
    setSaving(true);
    setMessage('');
    const basePatch = buildClipSentenceEditPatch(clip, parsedSentences, originalSentences);
    const hasWordEdits = parsedSentences.some(sentence => sentence.words?.some(word => word.removed));
    const patch = {
      ...basePatch,
      sentenceEdits: hasWordEdits
        ? mergeTimedRanges(wordRanges)
        : basePatch.sentenceEdits,
    };
    try {
      const saved = await onSave(clip._id, patch);
      setMessage(saved ? 'Sentence edits saved. Render the clip to apply them.' : 'Could not save sentence edits.');
    } finally {
      setSaving(false);
    }
  }

  if (!originalSentences.length) return null;

  return (
    <section className="clip-sentence-editor">
      {!open ? (
        <button className="secondary clip-sentence-edit-action" type="button" onClick={openEditor}>
          Edit words &amp; sentences
        </button>
      ) : (
        <>
          <div className="clip-sentence-editor-heading">
            <div>
              <strong>Clip words and sentences</strong>
              <p className="muted">Remove words or sentences from the generated reel. The matching audio and video ranges will be cut.</p>
              {sentences.some(sentence => sentence.start < Number(clip.start) || sentence.end > Number(clip.end)) && (
                <p className="muted">Saving will extend the clip trim to keep these sentences whole.</p>
              )}
            </div>
            <button className="secondary" type="button" onClick={() => setOpen(false)}>Close</button>
          </div>
          <ol className="clip-sentence-list" aria-label={`Sentences in ${clip.title}`}>
            {sentences.map((sentence, index) => (
              <li key={sentence.sentenceId}>
                <div className="clip-sentence-copy">
                  <div className="clip-sentence-times">
                    <label>
                      Start
                      <input
                        type="text"
                        value={sentence.startValue}
                        aria-label={`Start time for sentence ${index + 1}`}
                        aria-invalid={timestampError}
                        placeholder="HH:MM:SS.mmm"
                        onChange={event => updateTimestamp(index, 'start', event.target.value)}
                        disabled={saving}
                      />
                    </label>
                    <label>
                      End
                      <input
                        type="text"
                        value={sentence.endValue}
                        aria-label={`End time for sentence ${index + 1}`}
                        aria-invalid={timestampError}
                        placeholder="HH:MM:SS.mmm"
                        onChange={event => updateTimestamp(index, 'end', event.target.value)}
                        disabled={saving}
                      />
                    </label>
                  </div>
                  {sentence.words?.length ? (
                    <div className="clip-word-list" aria-label={`Words in sentence ${index + 1}`}>
                      {sentence.words.map((word, wordIndex) => (
                        <span className={word.removed ? 'clip-word removed' : 'clip-word'} key={`${word.start}-${word.end}-${wordIndex}`}>
                          {word.removed ? (
                            <>
                              <s>{word.text}</s>
                              <button
                                type="button"
                                aria-label={`Restore word ${word.text}`}
                                onClick={() => setWordRemoved(index, wordIndex, false)}
                                disabled={saving}
                              >
                                Restore
                              </button>
                            </>
                          ) : (
                            <>
                              <span>{word.text}</span>
                              <button
                                type="button"
                                aria-label={`Remove word ${word.text}`}
                                onClick={() => setWordRemoved(index, wordIndex, true)}
                                disabled={saving}
                              >
                                ×
                              </button>
                            </>
                          )}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span>{sentence.text}</span>
                  )}
                </div>
                <div className="clip-sentence-actions">
                  <button
                    className="secondary"
                    type="button"
                    aria-label={`Move sentence ${index + 1} up`}
                    onClick={() => moveSentence(index, -1)}
                    disabled={index === 0 || saving}
                  >
                    ↑
                  </button>
                  <button
                    className="secondary"
                    type="button"
                    aria-label={`Move sentence ${index + 1} down`}
                    onClick={() => moveSentence(index, 1)}
                    disabled={index === sentences.length - 1 || saving}
                  >
                    ↓
                  </button>
                  <button
                    className="reject"
                    type="button"
                    aria-label={`Remove sentence ${index + 1}`}
                    onClick={() => removeSentence(index)}
                    disabled={sentences.length <= 1 || saving}
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ol>
          <div className="clip-sentence-footer">
            <button className="secondary" type="button" onClick={() => setSentences(originalSentences)} disabled={saving}>
              Restore original order
            </button>
            <button type="button" onClick={saveSentences} disabled={saving}>
              {saving ? 'Saving…' : 'Save sentence edits'}
            </button>
            <small className="muted" role="status" aria-live="polite">{message}</small>
          </div>
        </>
      )}
    </section>
  );
}
